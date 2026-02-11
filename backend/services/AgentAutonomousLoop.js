/**
 * AgentAutonomousLoop - Autonomous Agent Decision Engine
 *
 * Periodically scans open arenas and auto-joins agents based on:
 * - Agent's risk tolerance vs arena entry fee
 * - Agent's budget availability
 * - Agent's current status (must be ACTIVE)
 * - Arena tier matching (ELO-based)
 * - Cooldown between matches
 *
 * @author Monad Colosseum Team
 */

const EventEmitter = require('events');

const LOOP_DEFAULTS = {
    SCAN_INTERVAL_MS: 10000,        // Scan every 10 seconds
    MATCH_COOLDOWN_MS: 30000,       // 30s cooldown between matches
    MIN_BUDGET_RATIO: 2,            // Must have 2x entry fee in budget
    MAX_CONCURRENT_MATCHES: 1,      // One match at a time per agent
};

class AgentAutonomousLoop extends EventEmitter {
    /**
     * @param {import('./ArenaManager').ArenaManager} arenaManager
     * @param {object} agents - Reference to in-memory agents store
     * @param {object} leaderboard - Reference to in-memory leaderboard store
     * @param {object} [config]
     */
    constructor(arenaManager, agents, leaderboard, config = {}) {
        super();
        this.arenaManager = arenaManager;
        this.agents = agents;           // server.js agents object
        this.leaderboard = leaderboard; // server.js leaderboard object
        this.config = { ...LOOP_DEFAULTS, ...config };
        this.checkProfitWithdraw = config.checkProfitWithdraw || null; // injected from server.js

        this.timer = null;
        this.running = false;

        // Track agent states
        this.agentStates = new Map(); // agentId → { lastMatchTime, inMatch, matchCount }
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────

    start() {
        if (this.running) return;
        this.running = true;
        console.log('[AutonomousLoop] Started - scanning every', this.config.SCAN_INTERVAL_MS, 'ms');
        this.timer = setInterval(() => this._scan(), this.config.SCAN_INTERVAL_MS);
        // Run first scan immediately
        this._scan();
    }

    stop() {
        if (!this.running) return;
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        console.log('[AutonomousLoop] Stopped');
    }

    // ─── Core Scan Logic ─────────────────────────────────────────────────

    async _scan() {
        try {
            const openArenas = this.arenaManager.listArenas('open');
            const lobbyArenas = this.arenaManager.listArenas('lobby');
            const availableArenas = [...openArenas, ...lobbyArenas];

            if (availableArenas.length === 0) return;

            // Get all autonomous agents that are activated (status === 'searching') and have strategyCode
            const autonomousAgents = Object.values(this.agents).filter(agent =>
                agent.strategyCode?.decide &&
                (agent.status === 'searching' || agent.status === 'idle_searching') &&
                this._isAgentAvailable(agent.id)
            );

            if (autonomousAgents.length === 0) return;

            for (const agent of autonomousAgents) {
                const bestArena = this._evaluateBestArena(agent, availableArenas);
                if (bestArena) {
                    await this._joinArena(agent, bestArena);
                }
            }
        } catch (error) {
            console.error('[AutonomousLoop] Scan error:', error.message);
        }
    }

    /**
     * Check if agent is available for a new match
     */
    _isAgentAvailable(agentId) {
        const state = this.agentStates.get(agentId);
        if (!state) return true;

        // Check cooldown
        if (state.lastMatchTime) {
            const elapsed = Date.now() - state.lastMatchTime;
            if (elapsed < this.config.MATCH_COOLDOWN_MS) return false;
        }

        // Check concurrent matches
        if (state.inMatch) return false;

        return true;
    }

    /**
     * Evaluate which arena is best for this agent
     * based on risk tolerance, budget, and ELO matching
     */
    _evaluateBestArena(agent, arenas) {
        const params = agent.strategyParams || {};
        const riskTolerance = (params.riskTolerance ?? 50) / 100; // 0-1
        const agentElo = this.leaderboard[agent.id]?.elo || 1000;

        let bestArena = null;
        let bestScore = -Infinity;

        for (const arena of arenas) {
            const score = this._scoreArena(agent, arena, riskTolerance, agentElo);
            if (score > bestScore && score > 0) {
                bestScore = score;
                bestArena = arena;
            }
        }

        return bestArena;
    }

    /**
     * Score an arena for a given agent (higher = more attractive)
     *
     * Tier-gated by riskTolerance:
     *   0–30  → Bronze   (0.1–0.5 MON)   maxFee = 0.5
     *  30–50  → Silver   (0.5–2 MON)     maxFee = 2
     *  50–70  → Gold     (2–10 MON)      maxFee = 10
     *  70–85  → Platinum (10–50 MON)     maxFee = 50
     *  85–100 → Diamond  (50–250 MON)    maxFee = 250
     *
     * Budget rule: entryFee must be ≤ 50 % of agent's total earnings.
     */
    _scoreArena(agent, arena, riskTolerance, agentElo) {
        const entryFee = arena.entryFee || 0;

        // ── Tier gate based on risk tolerance ────────────────────────────
        const rt = riskTolerance * 100; // back to 0-100 scale
        let maxAllowedFee;
        if (rt >= 85)      maxAllowedFee = 250;  // Diamond
        else if (rt >= 70) maxAllowedFee = 50;   // Platinum
        else if (rt >= 50) maxAllowedFee = 10;   // Gold
        else if (rt >= 30) maxAllowedFee = 2;    // Silver
        else               maxAllowedFee = 0.5;  // Bronze

        if (entryFee > maxAllowedFee) return -1;

        // ── 50 % budget cap ─────────────────────────────────────────────
        const stats = agent.stats || {};
        const totalEarnings = stats.earnings ?? stats.balance ?? 0;
        // Agents with zero earnings can still enter free / bronze (fee ≤ 1)
        if (totalEarnings > 0 && entryFee > totalEarnings * 0.5) return -1;

        // Check if agent is already in this arena
        const lobby = this.arenaManager.getLobby(arena.arenaId);
        if (lobby && lobby.agents.some(a => a.id === agent.id)) return -1;

        // Risk assessment: higher entry fee = riskier
        let riskScore = 1;
        if (entryFee > 50) {
            riskScore = riskTolerance;
        } else if (entryFee > 10) {
            riskScore = 0.5 + riskTolerance * 0.5;
        }

        // Prize pool attractiveness
        const prizeAttractiveness = Math.log(arena.prizePool + entryFee + 1);

        // Lobby size factor: prefer arenas close to starting
        const lobbyCount = lobby?.count || 0;
        const lobbyFactor = 1 + (lobbyCount / (arena.maxAgents || 8));

        // Aggressiveness bonus
        const aggressiveness = (agent.strategyParams?.aggressiveness ?? 50) / 100;
        const aggressionBonus = 0.5 + aggressiveness * 0.5;

        return riskScore * prizeAttractiveness * lobbyFactor * aggressionBonus;
    }

    /**
     * Join an arena with the agent
     */
    async _joinArena(agent, arena) {
        try {
            // Mark agent as joining
            this._initAgentState(agent.id);
            const state = this.agentStates.get(agent.id);
            state.inMatch = true;

            // Update agent status to fighting
            agent.status = 'fighting';
            agent._currentArenaId = arena.arenaId;
            agent._currentArenaName = arena.name || arena.arenaId;

            const result = this.arenaManager.joinArena(arena.arenaId, {
                id: agent.id,
                name: agent.name,
                owner: agent.ownerAddress || 'autonomous',
                strategyCode: agent.strategyCode,
                buffs: agent.buffs || { health: 0, armor: 0, attack: 0, speed: 0 },
            });

            console.log(`[AutonomousLoop] ${agent.name} auto-joined ${arena.name || arena.arenaId} (lobby: ${result.lobbySize})`);

            this.emit('agentAutoJoined', {
                agentId: agent.id,
                agentName: agent.name,
                arenaId: arena.arenaId,
                arenaName: arena.name,
                lobbySize: result.lobbySize,
                status: 'fighting',
            });

            // Set cooldown & listen for match completion
            state.lastMatchTime = Date.now();

            // Release inMatch after the arena completes, update status
            const onComplete = (data) => {
                if (data.arenaId === arena.arenaId) {
                    state.inMatch = false;
                    state.lastMatchTime = Date.now();
                    state.matchCount = (state.matchCount || 0) + 1;
                    
                    // Determine win/loss
                    const isWinner = data.winner?.id === agent.id;
                    agent.status = isWinner ? 'won' : 'lost';
                    agent._lastResult = isWinner
                        ? `Kazandı! +${data.prizePool || 0} MON`
                        : 'Kaybetti';
                    
                    // Decrement buff matches
                    if (agent.buffs && agent.buffs.matchesLeft > 0) {
                        agent.buffs.matchesLeft--;
                        if (agent.buffs.matchesLeft <= 0) {
                            agent.buffs = { health: 0, armor: 0, attack: 0, speed: 0, expiresAt: 0, matchesLeft: 0 };
                        }
                    }
                    
                    this.emit('agentMatchResult', {
                        agentId: agent.id,
                        status: agent.status,
                        result: agent._lastResult,
                    });
                    
                    // Check profit target auto-withdraw after each match
                    if (this.checkProfitWithdraw) {
                        this.checkProfitWithdraw(agent.id).catch(err => {
                            console.error(`[AutonomousLoop] Auto-withdraw check failed for ${agent.name}:`, err.message);
                        });
                    }
                    
                    // Auto-resume searching after cooldown
                    setTimeout(() => {
                        if (agent.status === 'won' || agent.status === 'lost') {
                            agent.status = 'searching';
                        }
                    }, this.config.MATCH_COOLDOWN_MS);
                    
                    this.arenaManager.removeListener('matchCompleted', onComplete);
                }
            };
            this.arenaManager.on('matchCompleted', onComplete);

        } catch (error) {
            // Failed to join (full, already in, etc.) - just release lock
            const state = this.agentStates.get(agent.id);
            if (state) state.inMatch = false;

            // Don't log "already in arena" errors as they're expected
            if (!error.message.includes('already in arena')) {
                console.error(`[AutonomousLoop] ${agent.name} join failed:`, error.message);
            }
        }
    }

    _initAgentState(agentId) {
        if (!this.agentStates.has(agentId)) {
            this.agentStates.set(agentId, {
                lastMatchTime: 0,
                inMatch: false,
                matchCount: 0,
            });
        }
    }

    // ─── Stats ───────────────────────────────────────────────────────────

    getStats() {
        return {
            running: this.running,
            totalAgents: Object.keys(this.agents).length,
            autonomousAgents: Object.values(this.agents).filter(a => a.strategyCode?.decide).length,
            agentStates: Object.fromEntries(this.agentStates),
        };
    }
}

module.exports = { AgentAutonomousLoop, LOOP_DEFAULTS };
