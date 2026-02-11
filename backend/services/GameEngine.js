/**
 * Monad Colosseum - Game Engine
 *
 * Manages match lifecycle, turn execution, combat resolution,
 * alliance mechanics, and prize distribution.
 */

const crypto = require('crypto');
const EventEmitter = require('events');

// ─── Constants ───────────────────────────────────────────────────────────────
const DEFAULTS = {
  STARTING_HP: 100,
  MAX_HP: 105,
  ATTACK_DAMAGE: 20,
  DEFENDED_DAMAGE: 10,
  HP_RECOVERY: 5,
  DECISION_TIMEOUT: 30000, // 30 seconds
  MIN_AGENTS: 2,
  MAX_AGENTS: 16,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function uid(prefix = '') {
  return `${prefix}${crypto.randomBytes(8).toString('hex')}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ─── GameEngine ──────────────────────────────────────────────────────────────
class GameEngine extends EventEmitter {
  /**
   * @param {object} [config] - Override default parameters
   */
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULTS, ...config };
    this.matches = new Map();          // matchId → match
    this.pendingProposals = new Map();  // matchId → [proposal, …]
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  Match Lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Initialise and return a new match.
   *
   * @param {object} arena   - { arenaId, prizePool, … }
   * @param {Array}  agents  - Array of raw agent descriptors
   * @returns {object} match
   */
  async startMatch(arena, agents) {
    if (!agents || agents.length < this.config.MIN_AGENTS) {
      throw new Error(`At least ${this.config.MIN_AGENTS} agents are required to start a match`);
    }
    if (agents.length > this.config.MAX_AGENTS) {
      throw new Error(`Maximum ${this.config.MAX_AGENTS} agents allowed per match`);
    }

    const matchAgents = agents.map((a) => {
      // Resolve active buffs (from agent.buffs if available)
      const buffs = a.buffs || { health: 0, armor: 0, attack: 0, speed: 0 };
      const hpBuff = Math.floor((buffs.health || 0) / 10); // 100 pts → +10 HP

      return {
        id: a.id || uid('agent_'),
        owner: a.owner || null,
        wallet: a.wallet || null,
        hp: this.config.STARTING_HP + hpBuff,
        alive: true,
        strategyCode: a.strategyCode || {},
        lastAction: null,
        turnsAlive: 0,
        _buffs: buffs, // carry buffs through the match
      };
    });

    const match = {
      matchId: uid('match_'),
      arenaId: arena.arenaId || uid('arena_'),
      agents: matchAgents,
      prizePool: arena.prizePool || 0,
      currentTurn: 1,
      status: 'active',
      activeAlliances: [],
      history: [],
      createdAt: new Date(),
      endedAt: null,
    };

    this.matches.set(match.matchId, match);
    this.pendingProposals.set(match.matchId, []);
    this.emit('matchStarted', { matchId: match.matchId, agentCount: matchAgents.length });

    return match;
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  Turn Execution  (the heart of the engine)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Execute a single turn for the given match.
   *
   * Turn order:
   *   1. Mark defences
   *   2. Queue alliance proposals
   *   3. Process accept / reject
   *   4. Apply attacks
   *   5. Process betrayals
   *   6. HP recovery (+5)
   *   7. Mark dead agents
   *   8. Check match end
   *
   * @param {object} match
   * @returns {object} turnResult
   */
  async executeTurn(match) {
    if (match.status !== 'active') {
      throw new Error(`Match ${match.matchId} is not active (status: ${match.status})`);
    }

    // Collect decisions from all alive agents
    const decisions = await this.collectDecisions(match);

    const turnRecord = {
      turn: match.currentTurn,
      decisions: { ...decisions },
      events: [],
    };

    // 1. Mark defences
    const defending = new Set();
    for (const [agentId, dec] of Object.entries(decisions)) {
      if (dec && dec.action === 'defend') {
        defending.add(agentId);
        turnRecord.events.push({ type: 'defend', agentId });
      }
    }

    // 2. Queue alliance proposals
    for (const [agentId, dec] of Object.entries(decisions)) {
      if (dec && dec.action === 'propose_alliance') {
        this._queueProposal(match, agentId, dec);
        turnRecord.events.push({
          type: 'propose_alliance',
          from: agentId,
          to: dec.target,
          terms: dec.terms,
        });
      }
    }

    // 3. Accept / Reject alliances
    for (const [agentId, dec] of Object.entries(decisions)) {
      if (dec && dec.action === 'accept_alliance') {
        const formed = this.handleAlliance(match, agentId, dec);
        if (formed) {
          turnRecord.events.push({ type: 'alliance_formed', alliance: formed });
        }
      }
    }

    // 4. Apply attacks
    for (const [agentId, dec] of Object.entries(decisions)) {
      if (dec && dec.action === 'attack') {
        const dmgResult = this.applyDamage(match.agents, agentId, dec.target, decisions);
        if (dmgResult) {
          turnRecord.events.push({ type: 'attack', ...dmgResult });
        }
      }
    }

    // 5. Process betrayals
    for (const [agentId, dec] of Object.entries(decisions)) {
      if (dec && dec.action === 'betray_alliance') {
        const betrayResult = this._processBetrayal(match, agentId, dec, decisions);
        if (betrayResult) {
          turnRecord.events.push({ type: 'betrayal', ...betrayResult });
        }
      }
    }

    // 6. HP recovery
    this.applyRecovery(match.agents);
    turnRecord.events.push({ type: 'recovery', amount: this.config.HP_RECOVERY });

    // 7. Mark dead agents
    for (const agent of match.agents) {
      if (agent.hp <= 0 && agent.alive) {
        agent.alive = false;
        agent.hp = 0;
        turnRecord.events.push({ type: 'death', agentId: agent.id });
        this.emit('agentDied', {
          matchId: match.matchId,
          agentId: agent.id,
          turn: match.currentTurn,
        });
      }
    }

    // Increment turnsAlive for survivors
    for (const agent of match.agents) {
      if (agent.alive) {
        agent.turnsAlive++;
      }
    }

    // Record turn history
    match.history.push(turnRecord);

    // 8. Check match end
    const endResult = this.checkMatchEnd(match);
    if (endResult.ended) {
      match.status = 'completed';
      match.endedAt = new Date();
      if (endResult.winner) {
        const prizeResult = this.distributePrize(match, endResult.winner);
        turnRecord.events.push({
          type: 'match_end',
          winner: endResult.winner.id,
          prize: prizeResult,
        });
      } else {
        turnRecord.events.push({ type: 'match_end', winner: null, reason: 'draw' });
      }
      this.emit('matchEnded', {
        matchId: match.matchId,
        winner: endResult.winner,
        turn: match.currentTurn,
      });
    } else {
      match.currentTurn++;
    }

    return turnRecord;
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  Decision Collection
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Collect decisions from every alive agent within the timeout window.
   * Falls back to "defend" for agents that don't respond in time.
   *
   * @param {object} match
   * @returns {object} { agentId: decision, … }
   */
  async collectDecisions(match) {
    const decisions = {};
    const aliveAgents = match.agents.filter((a) => a.alive);

    const promises = aliveAgents.map(async (agent) => {
      try {
        const decision = await this._getAgentDecision(match, agent);
        decisions[agent.id] = decision;
        agent.lastAction = decision;
      } catch {
        // Timeout or error → default to defend
        decisions[agent.id] = { action: 'defend' };
        agent.lastAction = { action: 'defend' };
      }
    });

    await Promise.all(promises);
    return decisions;
  }

  /**
   * Build a sanitised game state visible to a specific agent.
   *
   * @param {object} match
   * @param {object} agent
   * @returns {object} gameState
   */
  buildGameState(match, agent) {
    return {
      matchId: match.matchId,
      currentTurn: match.currentTurn,
      you: {
        id: agent.id,
        hp: agent.hp,
        alive: agent.alive,
        turnsAlive: agent.turnsAlive,
        lastAction: agent.lastAction,
      },
      opponents: match.agents
        .filter((a) => a.id !== agent.id)
        .map((a) => ({
          id: a.id,
          hp: a.hp,
          alive: a.alive,
          turnsAlive: a.turnsAlive,
          lastAction: a.lastAction,
        })),
      alliances: match.activeAlliances.map((al) => ({
        id: al.id,
        members: al.members,
        prizeShare: al.prizeShare,
      })),
      prizePool: match.prizePool,
      history: match.history.slice(-5), // last 5 turns
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  Combat
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Apply damage from attacker to defender considering defences.
   *
   * @param {Array}  agents      - all agents in match
   * @param {string} attackerId
   * @param {string} defenderId
   * @param {object} decisions   - all turn decisions (to check defend status)
   * @returns {object|null} { attackerId, defenderId, damage, defended }
   */
  applyDamage(agents, attackerId, defenderId, decisions) {
    const attacker = agents.find((a) => a.id === attackerId);
    const defender = agents.find((a) => a.id === defenderId);

    if (!attacker || !defender) return null;
    if (!attacker.alive || !defender.alive) return null;

    const isDefending =
      decisions[defenderId] && decisions[defenderId].action === 'defend';

    // Base damage
    let baseDamage = isDefending
      ? this.config.DEFENDED_DAMAGE
      : this.config.ATTACK_DAMAGE;

    // Apply attacker's ATTACK buff (adds to damage)
    const attackBuff = attacker._buffs?.attack || 0;
    baseDamage += Math.floor(attackBuff / 10); // 100 buff pts → +10 damage

    // Apply defender's ARMOR buff (reduces damage)
    const armorBuff = defender._buffs?.armor || 0;
    const damageReduction = Math.floor(armorBuff / 10);
    const damage = Math.max(1, baseDamage - damageReduction);

    defender.hp -= damage;

    return {
      attackerId,
      defenderId,
      damage,
      defended: isDefending,
      remainingHp: defender.hp,
    };
  }

  /**
   * Restore HP to all living agents (capped at MAX_HP).
   *
   * @param {Array} agents
   */
  applyRecovery(agents) {
    for (const agent of agents) {
      if (agent.alive && agent.hp > 0) {
        agent.hp = clamp(
          agent.hp + this.config.HP_RECOVERY,
          0,
          this.config.MAX_HP,
        );
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  Alliance Mechanics
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Handle accept_alliance decisions.
   *
   * @param {object} match
   * @param {string} agentId   - the accepting agent
   * @param {object} decision  - { action: 'accept_alliance', proposer: '…' }
   * @returns {object|null} newly formed alliance or null
   */
  handleAlliance(match, agentId, decision) {
    const proposals = this.pendingProposals.get(match.matchId) || [];
    const idx = proposals.findIndex(
      (p) => p.from === decision.proposer && p.to === agentId,
    );

    if (idx === -1) return null;

    const proposal = proposals.splice(idx, 1)[0];
    this.pendingProposals.set(match.matchId, proposals);

    const alliance = {
      id: uid('alliance_'),
      members: [proposal.from, agentId],
      prizeShare: proposal.terms?.prizeShare
        ? {
            [proposal.from]: proposal.terms.prizeShare,
            [agentId]: 100 - proposal.terms.prizeShare,
          }
        : { [proposal.from]: 50, [agentId]: 50 },
    };

    match.activeAlliances.push(alliance);
    this.emit('allianceFormed', { matchId: match.matchId, alliance });

    return alliance;
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  Prize Distribution
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Distribute the prize pool to the winner (or their alliance).
   *
   * Reward rules:
   * - Normal winner  → 100% of prize pool
   * - External winner → 50% to winner, 50% redistributed to normal (non-external) agents
   * - Alliance winner → alliance share split, then external cut applied per member
   *
   * @param {object} match
   * @param {object} winner - the winning agent object
   * @returns {object} { distributions: [{ agentId, amount }] }
   */
  distributePrize(match, winner) {
    const pool = match.prizePool;
    if (pool <= 0) return { distributions: [] };

    const isExternal = (agent) => agent.isExternal === true || (agent.id && agent.id.startsWith('ext_'));

    // Check if winner is in an active alliance
    const alliance = match.activeAlliances.find((a) =>
      a.members.includes(winner.id),
    );

    let rawDistributions = [];

    if (alliance) {
      // Split according to alliance terms
      rawDistributions = alliance.members.map((memberId) => {
        const sharePercent = alliance.prizeShare[memberId] || 0;
        const agent = match.agents.find(a => a.id === memberId);
        return {
          agentId: memberId,
          amount: Math.floor((pool * sharePercent) / 100),
          isExternal: agent ? isExternal(agent) : false,
        };
      });
    } else {
      // Solo winner
      rawDistributions = [{
        agentId: winner.id,
        amount: pool,
        isExternal: isExternal(winner),
      }];
    }

    // Apply external agent 50% cut
    let redistributionPool = 0;
    const distributions = rawDistributions.map(d => {
      if (d.isExternal) {
        const cut = Math.floor(d.amount * 0.5);
        redistributionPool += cut;
        return { agentId: d.agentId, amount: d.amount - cut };
      }
      return { agentId: d.agentId, amount: d.amount };
    });

    // Redistribute the external cut to normal (non-external) agents in the match
    if (redistributionPool > 0) {
      const normalAgents = match.agents.filter(a => !isExternal(a) && a.id !== winner.id);
      if (normalAgents.length > 0) {
        const share = Math.floor(redistributionPool / normalAgents.length);
        for (const agent of normalAgents) {
          const existing = distributions.find(d => d.agentId === agent.id);
          if (existing) {
            existing.amount += share;
          } else {
            distributions.push({ agentId: agent.id, amount: share });
          }
        }
      }
      // If no normal agents, the cut goes to platform (not distributed)
    }

    this.emit('prizeDistributed', { matchId: match.matchId, distributions, redistributionPool });
    return { distributions };
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  End Condition
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Determine if the match should end.
   *
   * @param {object} match
   * @returns {object} { ended: boolean, winner: agent|null }
   */
  checkMatchEnd(match) {
    const alive = match.agents.filter((a) => a.alive);

    if (alive.length === 1) {
      return { ended: true, winner: alive[0] };
    }
    if (alive.length === 0) {
      return { ended: true, winner: null }; // draw
    }
    return { ended: false, winner: null };
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  Private Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Retrieve a single agent's decision with timeout.
   * @private
   */
  async _getAgentDecision(match, agent) {
    const gameState = this.buildGameState(match, agent);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Agent ${agent.id} decision timeout`));
      }, this.config.DECISION_TIMEOUT);

      try {
        // If the agent has a `decide` function in its strategy, call it
        if (
          agent.strategyCode &&
          typeof agent.strategyCode.decide === 'function'
        ) {
          const result = agent.strategyCode.decide(gameState);
          // Support both sync and async strategies
          if (result && typeof result.then === 'function') {
            result
              .then((decision) => {
                clearTimeout(timer);
                resolve(decision);
              })
              .catch((err) => {
                clearTimeout(timer);
                reject(err);
              });
          } else {
            clearTimeout(timer);
            resolve(result);
          }
        } else {
          // No strategy → default defend
          clearTimeout(timer);
          resolve({ action: 'defend' });
        }
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /**
   * Queue an alliance proposal.
   * @private
   */
  _queueProposal(match, agentId, decision) {
    const proposals = this.pendingProposals.get(match.matchId) || [];
    proposals.push({
      from: agentId,
      to: decision.target,
      terms: decision.terms || { prizeShare: 50 },
    });
    this.pendingProposals.set(match.matchId, proposals);
  }

  /**
   * Process a betrayal action.
   * @private
   */
  _processBetrayal(match, agentId, decision, decisions) {
    const allianceIdx = match.activeAlliances.findIndex(
      (a) => a.id === decision.allianceId,
    );
    if (allianceIdx === -1) return null;

    const alliance = match.activeAlliances[allianceIdx];
    if (!alliance.members.includes(agentId)) return null;

    // Remove the alliance
    match.activeAlliances.splice(allianceIdx, 1);

    // Apply betrayal attack (full damage, ignoring defend)
    const target = match.agents.find((a) => a.id === decision.attackTarget);
    if (target && target.alive) {
      const damage = this.config.ATTACK_DAMAGE;
      target.hp -= damage;

      this.emit('betrayal', {
        matchId: match.matchId,
        betrayer: agentId,
        victim: decision.attackTarget,
        allianceId: decision.allianceId,
      });

      return {
        betrayer: agentId,
        victim: decision.attackTarget,
        allianceId: decision.allianceId,
        damage,
        remainingHp: target.hp,
      };
    }

    return null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  Utilities
  // ──────────────────────────────────────────────────────────────────────────

  getMatch(matchId) {
    return this.matches.get(matchId) || null;
  }

  getAliveAgents(match) {
    return match.agents.filter((a) => a.alive);
  }

  getMatchStatus(match) {
    const alive = this.getAliveAgents(match);
    return {
      matchId: match.matchId,
      status: match.status,
      currentTurn: match.currentTurn,
      aliveCount: alive.length,
      totalAgents: match.agents.length,
      prizePool: match.prizePool,
      alliances: match.activeAlliances.length,
    };
  }
}

module.exports = { GameEngine, DEFAULTS, uid, clamp };
