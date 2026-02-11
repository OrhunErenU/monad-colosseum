/**
 * Monad Colosseum - Arena Manager
 *
 * Manages arena lifecycle: creation, queueing agents,
 * launching matches via GameEngine, and tracking results.
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

const ARENA_DEFAULTS = {
  MIN_AGENTS: 2,
  MAX_AGENTS: 8,
  ENTRY_FEE: 100,
  COUNTDOWN_MS: 15000,    // 15s lobby countdown
  MAX_TURNS: 100,         // force-end after 100 turns
};

// ─── Tier Definitions (matches frontend & smart contract) ──────────────
const TIER_CONFIG = {
  bronze:   { name: '🥉 Bronz Arena',    entryFee: 1,    maxAgents: 8,  minAgents: 2, color: '#CD7F32' },
  silver:   { name: '🥈 Gümüş Arena',    entryFee: 10,   maxAgents: 6,  minAgents: 2, color: '#C0C0C0' },
  gold:     { name: '🥇 Altın Arena',     entryFee: 100,  maxAgents: 4,  minAgents: 2, color: '#FFD700' },
  platinum: { name: '💎 Platin Arena',    entryFee: 50,   maxAgents: 4,  minAgents: 2, color: '#E5E4E2' },
  diamond:  { name: '💠 Elmas Arena',     entryFee: 250,  maxAgents: 2,  minAgents: 2, color: '#B9F2FF' },
};

class ArenaManager extends EventEmitter {
  /**
   * @param {import('./GameEngine').GameEngine} gameEngine
   * @param {object} [config]
   */
  constructor(gameEngine, config = {}) {
    super();
    this.engine = gameEngine;
    this.config = { ...ARENA_DEFAULTS, ...config };
    this.arenas = new Map();     // arenaId → arena
    this.lobbies = new Map();    // arenaId → { agents[], timer }
    this.results = new Map();    // matchId → result

    // Auto-create one arena per tier on startup
    this._initTierPools();
  }

  /**
   * Create one open arena per tier so there's always something to join.
   */
  _initTierPools() {
    for (const [tier, cfg] of Object.entries(TIER_CONFIG)) {
      const existing = [...this.arenas.values()].find(a => a.tier === tier && a.status === 'open');
      if (!existing) {
        this.createArena({ tier, name: cfg.name, entryFee: cfg.entryFee, maxAgents: cfg.maxAgents, minAgents: cfg.minAgents });
      }
    }
  }

  // ─── Arena CRUD ────────────────────────────────────────────────────────

  createArena(options = {}) {
    // Resolve tier config if tier specified
    const tierCfg = options.tier ? TIER_CONFIG[options.tier] : null;

    const arena = {
      arenaId: options.arenaId || `arena_${uuidv4().slice(0, 8)}`,
      name: options.name || tierCfg?.name || 'Unnamed Arena',
      tier: options.tier || null,
      entryFee: options.entryFee ?? tierCfg?.entryFee ?? this.config.ENTRY_FEE,
      maxAgents: options.maxAgents ?? tierCfg?.maxAgents ?? this.config.MAX_AGENTS,
      minAgents: options.minAgents ?? tierCfg?.minAgents ?? this.config.MIN_AGENTS,
      prizePool: 0,
      status: 'open',       // open → lobby → in_progress → completed
      createdAt: new Date(),
      matchId: null,
    };
    this.arenas.set(arena.arenaId, arena);
    this.lobbies.set(arena.arenaId, { agents: [], timer: null });
    this.emit('arenaCreated', arena);
    return arena;
  }

  getArena(arenaId) {
    return this.arenas.get(arenaId) || null;
  }

  listArenas(statusFilter) {
    const all = [...this.arenas.values()];
    return statusFilter ? all.filter((a) => a.status === statusFilter) : all;
  }

  // ─── Agent Queueing ───────────────────────────────────────────────────

  joinArena(arenaId, agent) {
    const arena = this.arenas.get(arenaId);
    if (!arena) throw new Error(`Arena ${arenaId} not found`);
    if (arena.status !== 'open' && arena.status !== 'lobby') {
      throw new Error(`Arena ${arenaId} is not accepting agents (status: ${arena.status})`);
    }

    const lobby = this.lobbies.get(arenaId);
    if (lobby.agents.find((a) => a.id === agent.id)) {
      throw new Error(`Agent ${agent.id} already in arena ${arenaId}`);
    }
    if (lobby.agents.length >= arena.maxAgents) {
      throw new Error(`Arena ${arenaId} is full`);
    }

    lobby.agents.push(agent);

    // External agents join fee-free; normal agents contribute to prize pool
    const isExternal = agent.isExternal === true || (agent.id && agent.id.startsWith('ext_'));
    if (!isExternal) {
      arena.prizePool += arena.entryFee;
    }

    this.emit('agentJoined', { arenaId, agentId: agent.id, lobbySize: lobby.agents.length, isExternal });

    // Start countdown when minimum reached
    if (lobby.agents.length >= arena.minAgents && arena.status === 'open') {
      arena.status = 'lobby';
      this._startCountdown(arenaId);
    }

    // Auto-start when full
    if (lobby.agents.length >= arena.maxAgents) {
      this._cancelCountdown(arenaId);
      this._launchMatch(arenaId);
    }

    return { arenaId, lobbySize: lobby.agents.length, status: arena.status };
  }

  leaveArena(arenaId, agentId) {
    const arena = this.arenas.get(arenaId);
    if (!arena) throw new Error(`Arena ${arenaId} not found`);
    if (arena.status === 'in_progress') throw new Error('Cannot leave during a match');

    const lobby = this.lobbies.get(arenaId);
    const idx = lobby.agents.findIndex((a) => a.id === agentId);
    if (idx === -1) throw new Error(`Agent ${agentId} not in arena`);

    lobby.agents.splice(idx, 1);
    arena.prizePool = Math.max(0, arena.prizePool - arena.entryFee);

    // Reset to open if below minimum
    if (lobby.agents.length < arena.minAgents && arena.status === 'lobby') {
      arena.status = 'open';
      this._cancelCountdown(arenaId);
    }

    this.emit('agentLeft', { arenaId, agentId, lobbySize: lobby.agents.length });
    return { arenaId, lobbySize: lobby.agents.length };
  }

  // ─── Match Launching ──────────────────────────────────────────────────

  async _launchMatch(arenaId) {
    const arena = this.arenas.get(arenaId);
    const lobby = this.lobbies.get(arenaId);
    if (!arena || !lobby) return;

    arena.status = 'in_progress';
    this.emit('matchLaunching', { arenaId, agentCount: lobby.agents.length });

    try {
      const match = await this.engine.startMatch(
        { arenaId, prizePool: arena.prizePool },
        lobby.agents,
      );
      arena.matchId = match.matchId;

      // Run turns until complete or max turns
      const result = await this._runMatch(match);
      arena.status = 'completed';
      this.results.set(match.matchId, result);
      this.emit('matchCompleted', { arenaId, matchId: match.matchId, result });

      // Auto-replenish: create a new arena for this tier
      if (arena.tier && TIER_CONFIG[arena.tier]) {
        const cfg = TIER_CONFIG[arena.tier];
        this.createArena({ tier: arena.tier, name: cfg.name, entryFee: cfg.entryFee, maxAgents: cfg.maxAgents, minAgents: cfg.minAgents });
      }

      return result;
    } catch (err) {
      arena.status = 'error';
      this.emit('matchError', { arenaId, error: err.message });
      throw err;
    }
  }

  async _runMatch(match) {
    let turnCount = 0;
    while (match.status === 'active' && turnCount < this.config.MAX_TURNS) {
      const turnResult = await this.engine.executeTurn(match);
      this.emit('turnCompleted', {
        matchId: match.matchId,
        turn: turnResult.turn,
        events: turnResult.events,
      });
      turnCount++;
    }

    // Force-end if max turns reached
    if (match.status === 'active') {
      match.status = 'completed';
      match.endedAt = new Date();
      const alive = this.engine.getAliveAgents(match);
      // Most HP wins
      const winner = alive.sort((a, b) => b.hp - a.hp)[0] || null;
      if (winner) {
        this.engine.distributePrize(match, winner);
      }
    }

    return {
      matchId: match.matchId,
      totalTurns: match.history.length,
      winner: match.agents.find((a) => a.alive) || null,
      status: match.status,
    };
  }

  // ─── Countdown Timer ──────────────────────────────────────────────────

  _startCountdown(arenaId) {
    const lobby = this.lobbies.get(arenaId);
    if (lobby.timer) return;

    this.emit('countdownStarted', { arenaId, duration: this.config.COUNTDOWN_MS });

    lobby.timer = setTimeout(() => {
      lobby.timer = null;
      this._launchMatch(arenaId);
    }, this.config.COUNTDOWN_MS);
  }

  _cancelCountdown(arenaId) {
    const lobby = this.lobbies.get(arenaId);
    if (lobby && lobby.timer) {
      clearTimeout(lobby.timer);
      lobby.timer = null;
    }
  }

  // ─── Queries ──────────────────────────────────────────────────────────

  getLobby(arenaId) {
    const lobby = this.lobbies.get(arenaId);
    if (!lobby) return null;
    return {
      arenaId,
      agents: lobby.agents.map((a) => ({ id: a.id, owner: a.owner })),
      count: lobby.agents.length,
    };
  }

  getResult(matchId) {
    return this.results.get(matchId) || null;
  }
}

module.exports = { ArenaManager, ARENA_DEFAULTS, TIER_CONFIG };
