/**
 * Monad Colosseum - Unified Backend Server
 * 
 * Combines Claude API for agent creation + GameEngine for live battles + WebSocket broadcasting
 */

require('dotenv').config();
// Also try loading from root .env if backend/.env has placeholder values
const path = require('path');
if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY === 'senin_private_keyin') {
    require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), override: true });
    console.log('[Config] Loaded root .env (backend/.env had placeholder PRIVATE_KEY)');
}

const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { ethers } = require('ethers');

// Services
const { GameEngine } = require('./services/GameEngine');
const { ArenaManager } = require('./services/ArenaManager');
const { AgentAutonomousLoop } = require('./services/AgentAutonomousLoop');
const createRoutes = require('./routes/api');
const strategies = require('./templates/strategies');

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const MONAD_RPC = process.env.MONAD_TESTNET_RPC || 'https://testnet-rpc.monad.xyz';
const PLATFORM_PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// ─── Blockchain Provider ─────────────────────────────────────────────────────
let provider, platformSigner;
console.log('[Chain] RPC URL:', MONAD_RPC);
console.log('[Chain] PRIVATE_KEY set:', PLATFORM_PRIVATE_KEY ? (PLATFORM_PRIVATE_KEY === 'senin_private_keyin' ? '⚠️ PLACEHOLDER (senin_private_keyin)' : `✅ ${PLATFORM_PRIVATE_KEY.slice(0,6)}...${PLATFORM_PRIVATE_KEY.slice(-4)}`) : '❌ NOT SET');
try {
    provider = new ethers.JsonRpcProvider(MONAD_RPC);
    // Verify provider actually connects to the network
    provider.getNetwork().then(network => {
        console.log(`[Chain] ✅ Connected to network: chainId=${network.chainId}, name=${network.name}`);
    }).catch(err => {
        console.error(`[Chain] ❌ Provider getNetwork() FAILED:`, err.message);
        console.error('[Chain] ❌ Balance queries and transactions will FAIL!');
    });
    if (PLATFORM_PRIVATE_KEY && PLATFORM_PRIVATE_KEY !== 'senin_private_keyin') {
        platformSigner = new ethers.Wallet(PLATFORM_PRIVATE_KEY, provider);
        console.log('[Chain] ✅ Platform signer:', platformSigner.address);
    } else {
        console.warn('[Chain] ⚠️ No valid PRIVATE_KEY — platformSigner NOT created. Contract calls will be skipped.');
        console.warn('[Chain] ⚠️ Set a real PRIVATE_KEY in backend/.env to enable on-chain operations.');
    }
} catch (e) {
    console.error('[Chain] ❌ Provider init FAILED:', e.message);
}

// AgentRegistry ABI (minimal for registerAgent)
const AGENT_REGISTRY_ABI = [
    'function registerAgent(address agentWallet, string name, string strategyDescription, tuple(uint8 aggressiveness, uint8 riskTolerance, uint8 briberyPolicy, uint256 profitTarget, uint256 withdrawThreshold, uint8 allianceTendency, uint8 betrayalChance) params) payable returns (uint256)',
    'function getAgent(uint256 agentId) view returns (tuple(address owner, address agentWallet, string name, string strategyDescription, tuple(uint8,uint8,uint8,uint256,uint256,uint8,uint8) params, uint8 status, uint256 budget, uint256 totalEarnings, uint256 totalLosses, uint256 matchesPlayed, uint256 matchesWon, int256 eloRating, uint256 createdAt, bool isExternal))',
    'function creationFee() view returns (uint256)',
    'function depositBudget(uint256 agentId) payable',
];

// BuffOracle ABI (minimal)
const BUFF_ORACLE_ABI = [
    'function applyBuff(address agent, uint8 buffType) payable',
    'function getActiveBuffs(address agent) view returns (uint16 healthBuff, uint16 armorBuff, uint16 attackBuff, uint16 speedBuff)',
    'function agentTotalBurned(address) view returns (uint256)',
];

let registryContract, buffOracleContract;
if (platformSigner) {
    if (process.env.AGENT_REGISTRY_ADDRESS) {
        registryContract = new ethers.Contract(process.env.AGENT_REGISTRY_ADDRESS, AGENT_REGISTRY_ABI, platformSigner);
    }
    if (process.env.BUFF_ORACLE_ADDRESS) {
        buffOracleContract = new ethers.Contract(process.env.BUFF_ORACLE_ADDRESS, BUFF_ORACLE_ABI, platformSigner);
    }
}

// ─── Service Instances ───────────────────────────────────────────────────────
const gameEngine = new GameEngine();
const arenaManager = new ArenaManager(gameEngine);

// ─── In-memory Storage ───────────────────────────────────────────────────────
const thoughts = {};
const agents = {};
const leaderboard = {};  // agentId → { elo, wins, losses, draws, earnings, betrayals, bribes, streak, maxStreak, lastMatch }
const transferHistory = {}; // agentId → [{ type, amount, txHash, from, to, timestamp }]

function initLeaderboardEntry(agentId) {
    if (!leaderboard[agentId]) {
        leaderboard[agentId] = {
            agentId,
            elo: 1000,
            wins: 0,
            losses: 0,
            draws: 0,
            earnings: 0,
            betrayals: 0,
            bribes: 0,
            streak: 0,
            maxStreak: 0,
            lastMatch: null,
        };
    }
    return leaderboard[agentId];
}

// ─── Express App ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json());

// Security headers
app.use(helmet({ contentSecurityPolicy: false }));

// Rate limiters
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { error: 'Çok fazla istek, lütfen daha sonra deneyin.' },
    standardHeaders: true,
    legacyHeaders: false
});

const agentLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: { error: 'Rate limit aşıldı.' }
});

app.use('/api/', apiLimiter);
app.use('/api/agents/external', agentLimiter);

// Request logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// ─── Health Check Endpoint ───────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
    const health = {
        ok: true,
        timestamp: Date.now(),
        provider: !!provider,
        platformSigner: !!platformSigner,
        registryContract: !!registryContract,
        buffOracleContract: !!buffOracleContract,
        rpcUrl: MONAD_RPC,
        agentCount: Object.keys(agents).length,
    };
    if (provider) {
        try {
            const network = await provider.getNetwork();
            const blockNum = await provider.getBlockNumber();
            health.chainId = Number(network.chainId);
            health.blockNumber = blockNum;
            health.providerConnected = true;
        } catch (err) {
            health.providerConnected = false;
            health.providerError = err.message;
        }
    }
    if (platformSigner) {
        try {
            const bal = await provider.getBalance(platformSigner.address);
            health.platformSignerAddress = platformSigner.address;
            health.platformSignerBalance = ethers.formatEther(bal) + ' MON';
        } catch { /* ignore */ }
    }
    res.json(health);
});

// ─── Claude API Routes ───────────────────────────────────────────────────────

// POST /api/claude - Generate strategy with Claude
app.post('/api/claude', async (req, res) => {
    try {
        const { prompt, traits } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        if (!process.env.ANTHROPIC_API_KEY) {
            return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
        }

        const systemPrompt = `You are a game strategy coder for Monad Colosseum, a gladiator AI battle arena on Monad blockchain.
The agent has these traits: ${traits || 'balanced'}

Write a JavaScript function called "decide" that takes one parameter "gameState" with this shape:
{
  matchId: string,
  currentTurn: number,
  you: { id, hp, alive, turnsAlive, lastAction },
  opponents: [{ id, hp, alive, turnsAlive, lastAction }],
  alliances: [{ id, members: [string], prizeShare: {agentId: number} }],
  prizePool: number,
  history: [last 5 turn records]
}

Available actions the function MUST return as { action, target?, terms?, allianceId?, attackTarget? }:
- { action: 'attack', target: opponentId } — Deal damage to target
- { action: 'defend' } — Reduce incoming damage, recover HP
- { action: 'propose_alliance', target: opponentId, terms: { prizeShare: 50 } } — Propose alliance (prizeShare = your share %)
- { action: 'accept_alliance', proposer: agentId } — Accept pending alliance
- { action: 'betray_alliance', allianceId: string, attackTarget: agentId } — Betray your ally for bonus damage
- { action: 'bribe', target: opponentId, amount: number } — [Future] Bribe opponent not to attack you

Strategy tips:
- Low HP → defend or flee
- Allied → coordinate attacks on weakest non-ally
- Betrayal deals full damage ignoring defense, but breaks alliance
- Last one standing wins the prize pool

Consider the agent's personality traits deeply when making decisions.
Return ONLY the raw function code. No markdown backticks, no explanation.`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 800,
                system: systemPrompt,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        const data = await response.json();

        if (data.error) {
            return res.status(500).json({ error: data.error.message });
        }

        const code = data.content[0].text;
        res.json({ code });
    } catch (error) {
        console.error('Claude API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/agent/create - Full agent creation from natural language
// Takes a single text description → Claude parses into params + strategy code
app.post('/api/agent/create', async (req, res) => {
    try {
        const { description, ownerAddress } = req.body;

        if (!description) {
            return res.status(400).json({ error: 'description is required' });
        }

        if (!process.env.ANTHROPIC_API_KEY) {
            return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
        }

        const systemPrompt = `You are the AI agent creator for Monad Colosseum — a gladiator AI battle arena on the Monad blockchain.

The user will describe their agent in natural language. Your job is to:
1. Extract a catchy agent name
2. Determine character traits
3. Parse strategy parameters (0-100 scale)
4. Generate battle strategy code

ARENA RULES:
- Agents fight in turn-based combat. Actions: attack, defend, propose_alliance, accept_alliance, betray_alliance, bribe
- ATTACK deals damage to a target. DEFEND reduces incoming damage and recovers HP.
- Alliances let agents cooperate, but betrayal deals bonus damage ignoring defense.
- Last one standing wins the prize pool.
- Outlaws (low reputation) deal 30% less damage.
- HP starts at 100, attack damage is ~20, defended damage is ~10, recovery is +5 HP.

STRATEGY ARCHETYPES:
- Berserker: High aggression, low alliance, attacks weakest
- Diplomat: High alliance tendency, low betrayal, proposes alliances
- Schemer: Medium aggression, high betrayal chance, forms alliances then betrays
- Tank: Defends often, waits for opponents to weaken each other
- Opportunist: Adapts based on game state, attacks when advantageous

PARAMETER RANGES (0-100):
- aggressiveness: How often to attack vs defend (0=always defend, 100=always attack)
- riskTolerance: Willingness to join expensive arenas (0=only cheap, 100=any)
- allianceTendency: Likelihood of forming alliances (0=never, 100=always)
- betrayalChance: Probability of betraying an alliance (0=loyal, 100=always betray)
- briberyPolicy: "accept" | "reject" | "conditional"
- profitTarget: Target earnings before auto-withdraw (in MON, integer)
- withdrawThreshold: Auto-send to owner when balance exceeds (in MON, integer)

You MUST respond with ONLY a valid JSON object (no markdown, no backticks, no explanation):
{
  "name": "Agent Name",
  "traits": ["aggressive", "loyal", "briber", "ambusher", "balanced"],
  "strategyDescription": "Brief description of the strategy",
  "params": {
    "aggressiveness": 0-100,
    "riskTolerance": 0-100,
    "allianceTendency": 0-100,
    "betrayalChance": 0-100,
    "briberyPolicy": "accept" | "reject" | "conditional",
    "profitTarget": integer,
    "withdrawThreshold": integer
  },
  "strategyCode": "function decide(gameState) { ... full code ... }"
}`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 2000,
                system: systemPrompt,
                messages: [{ role: 'user', content: description }]
            })
        });

        const data = await response.json();

        if (data.error) {
            return res.status(500).json({ error: data.error.message });
        }

        const rawText = data.content[0].text;
        
        // Parse JSON response
        let parsed;
        try {
            // Try to extract JSON from potential markdown wrapping
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
        } catch (parseErr) {
            return res.status(500).json({ error: 'Failed to parse Claude response', raw: rawText });
        }

        // Validate and clamp params
        const params = parsed.params || {};
        const clamp = (v, min, max) => Math.max(min, Math.min(max, parseInt(v) || 50));
        
        const validatedParams = {
            aggressiveness: clamp(params.aggressiveness, 0, 100),
            riskTolerance: clamp(params.riskTolerance, 0, 100),
            allianceTendency: clamp(params.allianceTendency, 0, 100),
            betrayalChance: clamp(params.betrayalChance, 0, 100),
            briberyPolicy: ['accept', 'reject', 'conditional'].includes(params.briberyPolicy) ? params.briberyPolicy : 'conditional',
            profitTarget: Math.max(0, parseInt(params.profitTarget) || 200),
            withdrawThreshold: Math.max(0, parseInt(params.withdrawThreshold) || 10),
        };

        // Create the agent
        const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // ── Create autonomous wallet for the agent ──────────────────────
        const agentWallet = ethers.Wallet.createRandom();
        const agentWalletAddress = agentWallet.address;
        const agentPrivateKey = agentWallet.privateKey;

        let strategyCode = {};
        if (parsed.strategyCode) {
            try {
                const fn = new Function('return ' + parsed.strategyCode)();
                strategyCode = { decide: fn };
            } catch (e) {
                console.error('Strategy parse error:', e);
            }
        }

        agents[agentId] = {
            id: agentId,
            name: parsed.name || 'Unnamed Gladiator',
            traits: parsed.traits || [],
            strategy: parsed.strategyCode || '',
            strategyCode,
            strategyParams: validatedParams,
            strategyDescription: parsed.strategyDescription || '',
            ownerAddress: ownerAddress || null,
            agentWalletAddress,
            agentPrivateKey, // stored server-side only, never sent to frontend
            createdAt: Date.now(),
            status: 'idle', // idle | searching | fighting | won | lost
            onchainId: null,
            stats: { wins: 0, losses: 0, earnings: 0, betrayals: 0, bribes: 0 },
            financial: { initialDeposit: 0, totalDeposited: 0, totalWithdrawn: 0 },
            buffs: { health: 0, armor: 0, attack: 0, speed: 0, expiresAt: 0, matchesLeft: 0 },
        };

        transferHistory[agentId] = [];
        initLeaderboardEntry(agentId);

        // Onchain registration will be done by frontend via user's wallet (wagmi writeContract)
        // Backend only prepares the agent wallet + Claude data

        res.json({
            success: true,
            agent: {
                ...agents[agentId],
                agentPrivateKey: undefined, // never expose private key
            },
            agentWalletAddress,
            parsed: {
                name: parsed.name,
                traits: parsed.traits,
                strategyDescription: parsed.strategyDescription,
                params: validatedParams,
                hasCode: !!parsed.strategyCode,
            }
        });
    } catch (error) {
        console.error('Agent create error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/agents - Create a new agent (legacy endpoint)
app.post('/api/agents', async (req, res) => {
    try {
        const { name, traits, strategy, ownerAddress, strategyParams } = req.body;
        
        const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // ── Create REAL autonomous wallet for the agent ──────────────
        const agentWallet = ethers.Wallet.createRandom();
        const agentWalletAddress = agentWallet.address;
        const agentPrivateKey = agentWallet.privateKey;
        console.log(`[Chain] Legacy agent wallet created: ${agentWalletAddress}`);
        
        // Parse strategy code into executable function
        let strategyCode = {};
        if (strategy) {
            try {
                const fn = new Function('return ' + strategy)();
                strategyCode = { decide: fn };
            } catch (e) {
                console.error('Strategy parse error:', e);
            }
        }
        
        // Default strategy params
        const defaultParams = {
            aggressiveness: 50,
            riskTolerance: 50,
            briberyPolicy: 'conditional',
            profitTarget: 200,
            withdrawThreshold: 10,
            allianceTendency: 50,
            betrayalChance: 20,
        };

        agents[agentId] = {
            id: agentId,
            name,
            traits,
            strategy,
            strategyCode,
            strategyParams: { ...defaultParams, ...strategyParams },
            ownerAddress,
            agentWalletAddress,
            agentPrivateKey, // stored server-side only
            createdAt: Date.now(),
            status: 'idle',
            stats: { wins: 0, losses: 0, earnings: 0, betrayals: 0, bribes: 0 },
            financial: { initialDeposit: 0, totalDeposited: 0, totalWithdrawn: 0 },
            buffs: { health: 0, armor: 0, attack: 0, speed: 0, expiresAt: 0, matchesLeft: 0 },
        };

        transferHistory[agentId] = [];
        // Initialize leaderboard entry
        initLeaderboardEntry(agentId);
        
        res.json({ success: true, agent: { ...agents[agentId], agentPrivateKey: undefined } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/agents/:owner - Get agents by owner
app.get('/api/agents/:owner', (req, res) => {
    const { owner } = req.params;
    const userAgents = Object.values(agents)
        .filter(a => a.ownerAddress?.toLowerCase() === owner.toLowerCase())
        .map(({ agentPrivateKey, ...safe }) => safe); // NEVER expose private key
    res.json(userAgents);
});

// GET /api/templates - Return preset strategies
app.get('/api/templates', (req, res) => {
    res.json(strategies);
});

// POST /api/agents/external - Register an external agent
app.post('/api/agents/external', async (req, res) => {
    try {
        const { walletAddress, name, platformOrigin, callbackUrl } = req.body;
        
        if (!walletAddress || !name) {
            return res.status(400).json({ error: 'walletAddress and name are required' });
        }

        const agentId = `ext_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Generate REAL managed wallet for external agent (platform-side)
        const managedWalletObj = ethers.Wallet.createRandom();
        const managedWallet = managedWalletObj.address;
        const managedWalletPrivateKey = managedWalletObj.privateKey;
        console.log(`[Chain] External agent real wallet created: ${managedWallet}`);
        
        const defaultParams = {
            aggressiveness: 50,
            riskTolerance: 50,
            briberyPolicy: 'conditional',
            profitTarget: 0,
            withdrawThreshold: 0,
            allianceTendency: 50,
            betrayalChance: 20,
        };

        agents[agentId] = {
            id: agentId,
            name,
            traits: [],
            strategy: null,
            strategyCode: {},
            strategyParams: defaultParams,
            ownerAddress: walletAddress,
            agentWalletAddress: managedWallet,
            agentPrivateKey: managedWalletPrivateKey, // stored server-side only
            managedWallet,
            createdAt: Date.now(),
            isExternal: true,
            callbackUrl: callbackUrl || null,
            platformOrigin: platformOrigin || 'unknown',
            stats: { wins: 0, losses: 0, earnings: 0, betrayals: 0, bribes: 0 },
            financial: { initialDeposit: 0, totalDeposited: 0, totalWithdrawn: 0 },
            buffs: { health: 0, armor: 0, attack: 0, speed: 0, expiresAt: 0, matchesLeft: 0 },
        };

        // If callbackUrl provided, create a webhook-based strategy
        if (callbackUrl) {
            agents[agentId].strategyCode = {
                decide: async (gameState) => {
                    try {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
                        const resp = await fetch(callbackUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ gameState, agentId }),
                            signal: controller.signal
                        });
                        clearTimeout(timeout);
                        const data = await resp.json();
                        return data.action ? data : { action: 'defend' };
                    } catch (err) {
                        console.warn(`[Webhook] ${agentId} timeout/error, defaulting to defend:`, err.message);
                        return { action: 'defend' };
                    }
                }
            };
        }

        initLeaderboardEntry(agentId);
        transferHistory[agentId] = [];
        
        const { agentPrivateKey: _pk, ...safeAgent } = agents[agentId];
        res.json({ 
            success: true, 
            agent: safeAgent,
            managedWallet,
            note: callbackUrl ? 'Webhook-based decisions enabled (5s timeout, fallback: defend)' : 'No callbackUrl — agent will use default defend strategy'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/heartbeat - Store agent thoughts (for spectate mode)
app.post('/api/heartbeat', async (req, res) => {
    try {
        const { agent, thought, action, arena, round } = req.body;

        const arenaId = arena || 'default';
        if (!thoughts[arenaId]) {
            thoughts[arenaId] = [];
        }

        thoughts[arenaId].push({
            agent,
            thought,
            action,
            round,
            timestamp: Date.now()
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Heartbeat error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/thoughts/:arenaId - Get thoughts for an arena
app.get('/api/thoughts/:arenaId', (req, res) => {
    const { arenaId } = req.params;
    res.json(thoughts[arenaId] || []);
});

// ─── Leaderboard API Routes ──────────────────────────────────────────────────

// GET /api/leaderboard - Get sorted leaderboard
app.get('/api/leaderboard', (req, res) => {
    const sortBy = req.query.sort || 'elo';
    const limit = parseInt(req.query.limit) || 50;
    
    let entries = Object.values(leaderboard);
    
    // Enrich with agent names
    entries = entries.map(e => ({
        ...e,
        name: agents[e.agentId]?.name || 'Unknown',
        traits: agents[e.agentId]?.traits || '',
        owner: agents[e.agentId]?.ownerAddress || null,
    }));
    
    // Sort
    switch (sortBy) {
        case 'wins': entries.sort((a, b) => b.wins - a.wins); break;
        case 'earnings': entries.sort((a, b) => b.earnings - a.earnings); break;
        case 'betrayals': entries.sort((a, b) => b.betrayals - a.betrayals); break;
        case 'streak': entries.sort((a, b) => b.maxStreak - a.maxStreak); break;
        case 'elo':
        default: entries.sort((a, b) => b.elo - a.elo); break;
    }
    
    res.json({ ok: true, leaderboard: entries.slice(0, limit) });
});

// GET /api/leaderboard/:agentId - Get single agent leaderboard entry
app.get('/api/leaderboard/:agentId', (req, res) => {
    const entry = leaderboard[req.params.agentId];
    if (!entry) return res.status(404).json({ ok: false, error: 'Agent not on leaderboard' });
    
    const agent = agents[req.params.agentId];
    res.json({
        ok: true,
        entry: {
            ...entry,
            name: agent?.name || 'Unknown',
            traits: agent?.traits || '',
            owner: agent?.ownerAddress || null,
        }
    });
});

// POST /api/leaderboard/record - Record match result (internal use or testing)
app.post('/api/leaderboard/record', (req, res) => {
    try {
        const { winnerId, loserIds, prizeAmount, betrayals, bribes } = req.body;
        
        // Update winner
        if (winnerId) {
            const w = initLeaderboardEntry(winnerId);
            w.wins++;
            w.streak++;
            w.maxStreak = Math.max(w.maxStreak, w.streak);
            w.earnings += prizeAmount || 0;
            w.lastMatch = Date.now();
            // ELO calculation (simplified K=32)
            const avgLoserElo = loserIds?.length > 0
                ? loserIds.reduce((s, id) => s + (leaderboard[id]?.elo || 1000), 0) / loserIds.length
                : 1000;
            const expected = 1 / (1 + Math.pow(10, (avgLoserElo - w.elo) / 400));
            w.elo = Math.round(w.elo + 32 * (1 - expected));
            
            if (agents[winnerId]) agents[winnerId].stats.wins++;
        }
        
        // Update losers
        if (loserIds) {
            for (const loserId of loserIds) {
                const l = initLeaderboardEntry(loserId);
                l.losses++;
                l.streak = 0;
                l.lastMatch = Date.now();
                const winnerElo = winnerId ? (leaderboard[winnerId]?.elo || 1000) : 1000;
                const expected = 1 / (1 + Math.pow(10, (winnerElo - l.elo) / 400));
                l.elo = Math.max(100, Math.round(l.elo + 32 * (0 - expected)));
                
                if (agents[loserId]) agents[loserId].stats.losses++;
            }
        }
        
        // Record betrayals & bribes
        if (betrayals) {
            for (const { agentId } of betrayals) {
                const e = initLeaderboardEntry(agentId);
                e.betrayals++;
                if (agents[agentId]) agents[agentId].stats.betrayals = (agents[agentId].stats.betrayals || 0) + 1;
            }
        }
        if (bribes) {
            for (const { agentId } of bribes) {
                const e = initLeaderboardEntry(agentId);
                e.bribes++;
                if (agents[agentId]) agents[agentId].stats.bribes = (agents[agentId].stats.bribes || 0) + 1;
            }
        }
        
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ─── GameEngine API Routes ───────────────────────────────────────────────────
app.use('/api', createRoutes(arenaManager, gameEngine));

// ─── HTTP Server ─────────────────────────────────────────────────────────────
const server = http.createServer(app);

// ─── WebSocket Server ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

// Track client subscriptions: ws → Set<arenaId>
const subscriptions = new Map();

wss.on('connection', (ws) => {
    subscriptions.set(ws, new Set());
    console.log(`[WS] Client connected (total: ${wss.clients.size})`);

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            handleWsMessage(ws, msg);
        } catch {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }
    });

    ws.on('close', () => {
        subscriptions.delete(ws);
        console.log(`[WS] Client disconnected (total: ${wss.clients.size})`);
    });

    // Welcome message
    ws.send(JSON.stringify({
        type: 'welcome',
        timestamp: Date.now(),
        openArenas: arenaManager.listArenas('open').map((a) => a.arenaId),
    }));
});

function handleWsMessage(ws, msg) {
    switch (msg.type) {
        case 'subscribe': {
            const subs = subscriptions.get(ws);
            if (msg.arenaId) subs.add(msg.arenaId);
            ws.send(JSON.stringify({ type: 'subscribed', arenaId: msg.arenaId }));
            break;
        }
        case 'unsubscribe': {
            const subs = subscriptions.get(ws);
            if (msg.arenaId) subs.delete(msg.arenaId);
            ws.send(JSON.stringify({ type: 'unsubscribed', arenaId: msg.arenaId }));
            break;
        }
        case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
        default:
            ws.send(JSON.stringify({ type: 'error', message: `Unknown type: ${msg.type}` }));
    }
}

/**
 * Broadcast an event to all clients subscribed to a specific arena.
 */
function broadcastToArena(arenaId, event) {
    const payload = JSON.stringify(event);
    for (const [ws, subs] of subscriptions) {
        if (ws.readyState === WebSocket.OPEN && subs.has(arenaId)) {
            ws.send(payload);
        }
    }
}

/**
 * Broadcast to ALL connected clients.
 */
function broadcastAll(event) {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    }
}

// ─── Wire Events → WebSocket ─────────────────────────────────────────────────

arenaManager.on('arenaCreated', (arena) => {
    broadcastAll({ type: 'arena:created', arena });
});

arenaManager.on('agentJoined', (data) => {
    broadcastToArena(data.arenaId, { type: 'arena:agentJoined', ...data });
});

arenaManager.on('agentLeft', (data) => {
    broadcastToArena(data.arenaId, { type: 'arena:agentLeft', ...data });
});

arenaManager.on('countdownStarted', (data) => {
    broadcastToArena(data.arenaId, { type: 'arena:countdown', ...data });
});

arenaManager.on('matchLaunching', (data) => {
    broadcastToArena(data.arenaId, { type: 'match:launching', ...data });
});

arenaManager.on('turnCompleted', (data) => {
    // Find arenaId from matchId
    for (const [arenaId, arena] of arenaManager.arenas) {
        if (arena.matchId === data.matchId) {
            broadcastToArena(arenaId, { type: 'match:turn', ...data });
            break;
        }
    }
});

arenaManager.on('matchCompleted', (data) => {
    broadcastToArena(data.arenaId, { type: 'match:completed', ...data });
});

arenaManager.on('matchError', (data) => {
    broadcastToArena(data.arenaId, { type: 'match:error', ...data });
});

gameEngine.on('agentDied', (data) => {
    broadcastAll({ type: 'agent:died', ...data });
});

gameEngine.on('allianceFormed', (data) => {
    broadcastAll({ type: 'alliance:formed', ...data });
});

gameEngine.on('betrayal', (data) => {
    broadcastAll({ type: 'alliance:betrayal', ...data });
    // Auto-update leaderboard betrayal count
    const e = initLeaderboardEntry(data.betrayer);
    e.betrayals++;
});

// Auto-record match results on matchEnded
gameEngine.on('matchEnded', (data) => {
    const match = gameEngine.getMatch(data.matchId);
    if (!match) return;
    
    const winnerId = data.winner?.id || null;
    const loserIds = match.agents.filter(a => a.id !== winnerId).map(a => a.id);
    
    if (winnerId) {
        const w = initLeaderboardEntry(winnerId);
        w.wins++;
        w.streak++;
        w.maxStreak = Math.max(w.maxStreak, w.streak);
        w.earnings += match.prizePool || 0;
        w.lastMatch = Date.now();
        const avgLoserElo = loserIds.length > 0
            ? loserIds.reduce((s, id) => s + (leaderboard[id]?.elo || 1000), 0) / loserIds.length
            : 1000;
        const expected = 1 / (1 + Math.pow(10, (avgLoserElo - w.elo) / 400));
        w.elo = Math.round(w.elo + 32 * (1 - expected));
        if (agents[winnerId]) agents[winnerId].stats.wins++;
    }
    
    for (const loserId of loserIds) {
        const l = initLeaderboardEntry(loserId);
        l.losses++;
        l.streak = 0;
        l.lastMatch = Date.now();
        const winnerElo = winnerId ? (leaderboard[winnerId]?.elo || 1000) : 1000;
        const expected = 1 / (1 + Math.pow(10, (winnerElo - l.elo) / 400));
        l.elo = Math.max(100, Math.round(l.elo + 32 * (0 - expected)));
        if (agents[loserId]) agents[loserId].stats.losses++;
    }
});

// ─── Autonomous Agent Loop ───────────────────────────────────────────────────
const autonomousLoop = new AgentAutonomousLoop(arenaManager, agents, leaderboard, {
    SCAN_INTERVAL_MS: parseInt(process.env.AUTONOMOUS_SCAN_INTERVAL || '10000'),
    MATCH_COOLDOWN_MS: parseInt(process.env.AUTONOMOUS_COOLDOWN || '30000'),
    checkProfitWithdraw, // injected for auto-withdraw after matches
});

// Wire autonomous loop events to WebSocket
autonomousLoop.on('agentAutoJoined', (data) => {
    broadcastAll({ type: 'autonomous:joined', ...data });
});

// API: start/stop/status autonomous loop
app.post('/api/autonomous/start', (req, res) => {
    autonomousLoop.start();
    res.json({ ok: true, status: 'running' });
});

app.post('/api/autonomous/stop', (req, res) => {
    autonomousLoop.stop();
    res.json({ ok: true, status: 'stopped' });
});

app.get('/api/autonomous/status', (req, res) => {
    res.json({ ok: true, ...autonomousLoop.getStats() });
});

// ─── Agent Activate / Deactivate / Status ────────────────────────────────────

// POST /api/agent/:id/activate - Start autonomous loop for this agent
app.post('/api/agent/:id/activate', (req, res) => {
    const agent = agents[req.params.id];
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    
    agent.status = 'searching';
    
    // Ensure autonomous loop is running
    if (!autonomousLoop.running) {
        autonomousLoop.start();
    }
    
    // Broadcast status change
    broadcastAll({ type: 'agent:statusChanged', agentId: agent.id, status: 'searching' });
    
    res.json({ ok: true, status: 'searching', message: `${agent.name} aktifleştirildi. Arena arıyor...` });
});

// POST /api/agent/:id/deactivate - Stop autonomous loop for this agent
app.post('/api/agent/:id/deactivate', (req, res) => {
    const agent = agents[req.params.id];
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    
    agent.status = 'idle';
    
    // Remove from autonomous loop state
    const state = autonomousLoop.agentStates.get(agent.id);
    if (state) {
        state.inMatch = false;
    }
    
    broadcastAll({ type: 'agent:statusChanged', agentId: agent.id, status: 'idle' });
    
    res.json({ ok: true, status: 'idle', message: `${agent.name} durduruldu.` });
});

// GET /api/agent/:id/status - Get agent's current status
app.get('/api/agent/:id/status', (req, res) => {
    const agent = agents[req.params.id];
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    
    const lb = leaderboard[agent.id] || {};
    res.json({
        ok: true,
        agentId: agent.id,
        name: agent.name,
        status: agent.status || 'idle',
        agentWalletAddress: agent.agentWalletAddress || null,
        stats: agent.stats,
        buffs: agent.buffs || {},
        elo: lb.elo || 1000,
        earnings: lb.earnings || 0,
    });
});

// ─── Buff / Burn Endpoints ───────────────────────────────────────────────────

// POST /api/agent/:id/buff - Apply a buff by burning MON
app.post('/api/agent/:id/buff', async (req, res) => {
    try {
        const agent = agents[req.params.id];
        if (!agent) return res.status(404).json({ error: 'Agent not found' });
        
        const { buffType, amount } = req.body;
        // buffType: 'health' | 'armor' | 'attack' | 'speed'
        // amount: MON amount as number (e.g. 0.5)
        
        if (!['health', 'armor', 'attack', 'speed'].includes(buffType)) {
            return res.status(400).json({ error: 'Invalid buffType. Use: health, armor, attack, speed' });
        }
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'amount must be > 0' });
        }

        const buffTypeMap = { health: 0, armor: 1, attack: 2, speed: 3 };
        
        // Calculate magnitude: 0.1 MON → 10 pts, 1 MON → 100 pts, 5 MON → 500 (cap)
        const rawMagnitude = Math.round(amount * 100); // 0.1→10, 1→100, 5→500
        const magnitude = Math.min(rawMagnitude, 500);
        
        // Apply buff in-memory
        if (!agent.buffs) {
            agent.buffs = { health: 0, armor: 0, attack: 0, speed: 0, expiresAt: 0, matchesLeft: 0 };
        }
        agent.buffs[buffType] += magnitude;
        agent.buffs.matchesLeft = 3;
        agent.buffs.expiresAt = Date.now() + 3600_000; // 1 hour
        
        // On-chain buff (if available)
        let txHash = null;
        if (buffOracleContract && platformSigner && agent.agentWalletAddress) {
            try {
                const tx = await buffOracleContract.applyBuff(
                    agent.agentWalletAddress,
                    buffTypeMap[buffType],
                    { value: ethers.parseEther(String(amount)) }
                );
                console.log(`[Chain] ⏳ Buff TX submitted: ${tx.hash} — waiting for confirmation...`);
                const receipt = await tx.wait();
                txHash = tx.hash;
                console.log(`[Chain] ✅ Buff confirmed: ${tx.hash} (block: ${receipt.blockNumber}, gas: ${receipt.gasUsed.toString()})`);
            } catch (chainErr) {
                console.error('[Chain] Buff tx failed:', chainErr.message);
            }
        }
        
        broadcastAll({ type: 'agent:buffed', agentId: agent.id, buffType, magnitude, amount });
        
        res.json({
            ok: true,
            buffType,
            magnitude,
            totalBuffs: agent.buffs,
            txHash,
            message: `${agent.name} +${magnitude} ${buffType} buff aldı! (${amount} MON yakıldı)`,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/agent/:id/confirm-onchain - Confirm onchain registration tx
app.post('/api/agent/:id/confirm-onchain', (req, res) => {
    const agent = agents[req.params.id];
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    
    const { txHash, onchainId } = req.body;
    if (txHash) agent.onchainTxHash = txHash;
    if (onchainId) agent.onchainId = onchainId;
    agent.onchainRegistered = true;
    
    console.log(`[Chain] Agent ${agent.id} onchain confirmed: ${txHash}`);
    res.json({ ok: true, message: 'Onchain registration confirmed' });
});

// GET /api/agent/:id/balance - Get real-time wallet balance
app.get('/api/agent/:id/balance', async (req, res) => {
    try {
        const agent = agents[req.params.id];
        if (!agent) return res.status(404).json({ error: 'Agent not found' });
        if (!agent.agentWalletAddress) {
            console.log('[Balance] ❌ No wallet address for', req.params.id);
            return res.status(400).json({ ok: false, error: 'Agent has no wallet address', balanceMON: 0 });
        }
        if (!provider) {
            console.error('[Balance] ❌ Provider not initialized! MONAD_RPC:', MONAD_RPC);
            return res.status(503).json({ ok: false, error: 'Blockchain provider not ready', balanceMON: 0 });
        }
        const bal = await provider.getBalance(agent.agentWalletAddress);
        const balMON = parseFloat(ethers.formatEther(bal));
        console.log(`[Balance] ${agent.name} (${agent.agentWalletAddress}): ${balMON} MON (${bal} wei)`);
        res.json({ ok: true, balance: bal.toString(), balanceMON: Math.round(balMON * 10000) / 10000 });
    } catch (err) {
        console.error('[Balance] Error for', req.params.id, ':', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/agent/:id/transfers - Get transfer history
app.get('/api/agent/:id/transfers', (req, res) => {
    const agent = agents[req.params.id];
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const history = transferHistory[agent.id] || [];
    const financial = agent.financial || { initialDeposit: 0, totalDeposited: 0, totalWithdrawn: 0 };
    res.json({ ok: true, transfers: history, financial });
});

// POST /api/agent/:id/record-deposit - Record a deposit (called after frontend tx)
app.post('/api/agent/:id/record-deposit', (req, res) => {
    const agent = agents[req.params.id];
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const { amount, txHash } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    
    if (!agent.financial) agent.financial = { initialDeposit: 0, totalDeposited: 0, totalWithdrawn: 0 };
    if (!transferHistory[agent.id]) transferHistory[agent.id] = [];
    
    agent.financial.totalDeposited += amount;
    if (agent.financial.initialDeposit === 0) agent.financial.initialDeposit = amount;
    
    transferHistory[agent.id].push({
        type: 'deposit',
        amount,
        txHash: txHash || null,
        from: agent.ownerAddress,
        to: agent.agentWalletAddress,
        timestamp: Date.now(),
    });
    
    broadcastAll({ type: 'agent:deposit', agentId: agent.id, amount });
    res.json({ ok: true, financial: agent.financial });
});

// POST /api/agent/:id/settings - Update agent's profit/withdraw settings
app.post('/api/agent/:id/settings', (req, res) => {
    const agent = agents[req.params.id];
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    
    const { profitTarget, withdrawThreshold } = req.body;
    if (!agent.strategyParams) agent.strategyParams = {};
    
    if (profitTarget !== undefined) {
        agent.strategyParams.profitTarget = Math.max(0, parseFloat(profitTarget) || 0);
    }
    if (withdrawThreshold !== undefined) {
        agent.strategyParams.withdrawThreshold = Math.max(0, parseFloat(withdrawThreshold) || 0);
    }
    
    console.log(`[Settings] ${agent.name}: profitTarget=${agent.strategyParams.profitTarget}, withdrawThreshold=${agent.strategyParams.withdrawThreshold}`);
    
    res.json({
        ok: true,
        profitTarget: agent.strategyParams.profitTarget,
        withdrawThreshold: agent.strategyParams.withdrawThreshold,
        message: 'Ayarlar güncellendi',
    });
});

// POST /api/agent/:id/withdraw - Manual withdraw MON to owner wallet
app.post('/api/agent/:id/withdraw', async (req, res) => {
    try {
        const agent = agents[req.params.id];
        if (!agent) return res.status(404).json({ error: 'Agent not found' });
        if (!agent.agentPrivateKey || !agent.agentWalletAddress || !provider) {
            return res.status(400).json({ error: 'Agent wallet not available or provider not ready' });
        }
        if (!agent.ownerAddress) {
            return res.status(400).json({ error: 'Owner address not set' });
        }
        
        const { amount, withdrawAll } = req.body;
        const bal = await provider.getBalance(agent.agentWalletAddress);
        const balMON = parseFloat(ethers.formatEther(bal));
        const gasReserve = 0.01; // keep some for gas
        
        let withdrawMON;
        if (withdrawAll) {
            withdrawMON = Math.max(0, balMON - gasReserve);
        } else {
            withdrawMON = parseFloat(amount) || 0;
        }
        
        if (withdrawMON <= 0) {
            return res.status(400).json({ error: 'Yetersiz bakiye (gas için 0.01 MON gerekli)' });
        }
        if (withdrawMON > balMON - gasReserve) {
            return res.status(400).json({ error: `Maksimum çekim: ${(balMON - gasReserve).toFixed(4)} MON (gas: ${gasReserve})` });
        }
        
        const isActive = agent.status === 'searching' || agent.status === 'fighting';
        
        const agentSigner = new ethers.Wallet(agent.agentPrivateKey, provider);
        console.log(`[Withdraw] Sending tx: ${withdrawMON.toFixed(6)} MON from ${agent.agentWalletAddress} → ${agent.ownerAddress}`);
        const tx = await agentSigner.sendTransaction({
            to: agent.ownerAddress,
            value: ethers.parseEther(String(withdrawMON.toFixed(6))),
        });
        console.log(`[Withdraw] ⏳ TX submitted: ${tx.hash} — waiting for confirmation...`);
        const receipt = await tx.wait();
        console.log(`[Withdraw] ✅ TX confirmed: ${tx.hash} (block: ${receipt.blockNumber}, gas: ${receipt.gasUsed.toString()})`);
        
        if (!agent.financial) agent.financial = { initialDeposit: 0, totalDeposited: 0, totalWithdrawn: 0 };
        agent.financial.totalWithdrawn += withdrawMON;
        
        if (!transferHistory[agent.id]) transferHistory[agent.id] = [];
        transferHistory[agent.id].push({
            type: 'manual_withdraw',
            amount: withdrawMON,
            txHash: tx.hash,
            from: agent.agentWalletAddress,
            to: agent.ownerAddress,
            timestamp: Date.now(),
        });
        
        broadcastAll({
            type: 'agent:withdraw',
            agentId: agent.id,
            amount: withdrawMON,
            txHash: tx.hash,
            ownerAddress: agent.ownerAddress,
        });
        
        res.json({
            ok: true,
            amount: withdrawMON,
            txHash: tx.hash,
            wasActive: isActive,
            message: `${withdrawMON.toFixed(4)} MON çekildi`,
        });
    } catch (err) {
        console.error('[Withdraw] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/agent/:id/buffs - Get agent's active buffs
app.get('/api/agent/:id/buffs', (req, res) => {
    const agent = agents[req.params.id];
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    
    const buffs = agent.buffs || { health: 0, armor: 0, attack: 0, speed: 0, expiresAt: 0, matchesLeft: 0 };
    
    // Check expiry
    const now = Date.now();
    const expired = buffs.expiresAt > 0 && now > buffs.expiresAt;
    const matchesExpired = buffs.matchesLeft <= 0 && buffs.expiresAt > 0;
    
    if (expired || matchesExpired) {
        agent.buffs = { health: 0, armor: 0, attack: 0, speed: 0, expiresAt: 0, matchesLeft: 0 };
    }
    
    res.json({ ok: true, buffs: agent.buffs });
});

// ─── Profit Target Auto-Withdraw Helper ──────────────────────────────────────
async function checkProfitWithdraw(agentId) {
    const agent = agents[agentId];
    if (!agent || !agent.agentPrivateKey || !agent.agentWalletAddress || !provider) {
        console.log(`[AutoWithdraw] Skipped ${agentId}: missing wallet/provider`);
        return;
    }
    
    const params = agent.strategyParams || {};
    const profitTarget = parseFloat(params.profitTarget) || 0;
    const withdrawThreshold = parseFloat(params.withdrawThreshold) || 0;
    if (profitTarget <= 0 || withdrawThreshold <= 0) {
        console.log(`[AutoWithdraw] ${agent.name}: no profitTarget(${profitTarget}) or withdrawThreshold(${withdrawThreshold})`);
        return;
    }
    if (!agent.ownerAddress) return;
    if (!agent.financial) agent.financial = { initialDeposit: 0, totalDeposited: 0, totalWithdrawn: 0 };
    if (!transferHistory[agentId]) transferHistory[agentId] = [];
    
    try {
        const bal = await provider.getBalance(agent.agentWalletAddress);
        const balMON = parseFloat(ethers.formatEther(bal));
        const initialDeposit = agent.financial.initialDeposit || 0;
        const profit = balMON - initialDeposit;
        
        console.log(`[AutoWithdraw] ${agent.name}: balance=${balMON} MON, initial=${initialDeposit}, profit=${profit.toFixed(4)}, target=${profitTarget}`);
        
        if (profit >= profitTarget) {
            const gasReserve = 0.01;
            const withdrawMON = Math.min(withdrawThreshold, balMON - gasReserve);
            if (withdrawMON <= 0) {
                console.log(`[AutoWithdraw] ${agent.name}: insufficient balance for withdrawal after gas reserve`);
                return;
            }
            
            const agentSigner = new ethers.Wallet(agent.agentPrivateKey, provider);
            console.log(`[AutoWithdraw] Sending tx: ${withdrawMON.toFixed(6)} MON from ${agent.agentWalletAddress} → ${agent.ownerAddress}`);
            const tx = await agentSigner.sendTransaction({
                to: agent.ownerAddress,
                value: ethers.parseEther(withdrawMON.toFixed(6)),
            });
            console.log(`[AutoWithdraw] ⏳ TX submitted: ${tx.hash} — waiting for confirmation...`);
            const receipt = await tx.wait();
            console.log(`[AutoWithdraw] ✅ ${agent.name}: ${withdrawMON.toFixed(4)} MON → ${agent.ownerAddress} (tx: ${tx.hash}, block: ${receipt.blockNumber})`);
            
            agent.financial.totalWithdrawn += withdrawMON;
            transferHistory[agentId].push({
                type: 'auto_withdraw',
                amount: withdrawMON,
                txHash: tx.hash,
                from: agent.agentWalletAddress,
                to: agent.ownerAddress,
                timestamp: Date.now(),
            });
            
            broadcastAll({
                type: 'agent:autoWithdraw',
                agentId,
                agentName: agent.name,
                amount: withdrawMON,
                txHash: tx.hash,
                ownerAddress: agent.ownerAddress,
            });
        }
    } catch (err) {
        console.error(`[AutoWithdraw] ${agent.name} error:`, err.message);
    }
}

// Expose checkProfitWithdraw for AgentAutonomousLoop
module.exports.checkProfitWithdraw = checkProfitWithdraw;

// Auto-start the loop if configured
if (process.env.AUTONOMOUS_AUTOSTART === 'true') {
    autonomousLoop.start();
}

// ─── Start ───────────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
    console.log(`
  ⚔️  Monad Colosseum - Unified Server
  ─────────────────────────────────────
  HTTP API  : http://localhost:${PORT}/api
  WebSocket : ws://localhost:${PORT}/ws
  Claude    : http://localhost:${PORT}/api/claude
  Health    : http://localhost:${PORT}/api/health
  `);

    // ── Startup blockchain health check ──────────────────────────
    console.log('[Startup] ── Blockchain Health Check ──');
    console.log('[Startup] RPC URL:', MONAD_RPC);
    console.log('[Startup] Platform signer:', platformSigner ? `✅ ${platformSigner.address}` : '❌ NOT AVAILABLE');
    console.log('[Startup] AgentRegistry:', registryContract ? `✅ ${process.env.AGENT_REGISTRY_ADDRESS}` : '❌ NOT AVAILABLE');
    console.log('[Startup] BuffOracle:', buffOracleContract ? `✅ ${process.env.BUFF_ORACLE_ADDRESS}` : '❌ NOT AVAILABLE');
    
    if (provider) {
        try {
            const network = await provider.getNetwork();
            const blockNum = await provider.getBlockNumber();
            console.log(`[Startup] ✅ Provider connected: chainId=${network.chainId}, block=#${blockNum}`);
            
            if (platformSigner) {
                const signerBal = await provider.getBalance(platformSigner.address);
                console.log(`[Startup] ✅ Platform signer balance: ${ethers.formatEther(signerBal)} MON`);
            }
        } catch (err) {
            console.error(`[Startup] ❌ Provider health check FAILED:`, err.message);
        }
    } else {
        console.error('[Startup] ❌ No provider — all blockchain operations will fail!');
    }
    console.log('[Startup] ── End Health Check ──');
});

module.exports = { app, server, wss, gameEngine, arenaManager };
