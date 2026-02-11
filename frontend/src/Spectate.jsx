/**
 * Spectate.jsx - Live Combat Stream Integration
 * 
 * Real-time arena viewer with:
 * - Live combat log from BattleNarrator
 * - Buff application effects from BuffOracle
 * - Agent stats display
 * - Viewer buff panel for engagement
 * 
 * @author Monad Colosseum Team
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { Arena3DViewer } from './components/Arena3DViewer';

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRACT ADDRESSES (Monad Testnet)
// ═══════════════════════════════════════════════════════════════════════════════

const ARENA_ADDRESS = import.meta.env.VITE_ARENA_ADDRESS || '0x0000000000000000000000000000000000000001';
const NARRATOR_ADDRESS = import.meta.env.VITE_NARRATOR_ADDRESS || '0x0000000000000000000000000000000000000002';
const BUFF_ORACLE_ADDRESS = import.meta.env.VITE_BUFF_ORACLE_ADDRESS || '0x0000000000000000000000000000000000000003';
const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_ADDRESS || '0x0000000000000000000000000000000000000004';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws';
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

// ═══════════════════════════════════════════════════════════════════════════════
// ABIs (Minimal)
// ═══════════════════════════════════════════════════════════════════════════════

const ArenaABI = [
    "function getCurrentRound() view returns (uint256)",
    "function getRound(uint256 roundId) view returns (tuple(uint256 id, address[] participants, uint256 startTime, uint256 endTime, uint256 prizePool, address winner, uint8 status))",
    "event DamageDealt(uint256 indexed roundId, address indexed attacker, address indexed target, uint256 damage, uint256 remainingHealth)",
    "event AgentEliminated(address indexed agent, address indexed killer, uint256 indexed roundId)"
];

const NarratorABI = [
    "function getTimeline(uint256 limit) view returns (tuple(uint8 eventType, address primaryActor, address secondaryActor, uint256 value, uint256 timestamp, uint256 roundId, bytes32 metadata)[])",
    "event NarrativeRecorded(uint256 indexed eventIndex, uint8 indexed eventType, address indexed primaryActor, address secondaryActor, uint256 value, uint256 roundId)"
];

const BuffOracleABI = [
    "function applyBuff(address agent, address viewer, uint96 tokenAmount, uint8 buffType, uint256 roundId) payable",
    "event BuffApplied(address indexed agent, address indexed viewer, uint96 tokensBurned, uint8 buffType, uint16 magnitude, uint256 indexed roundId)"
];

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT TYPE MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

const EVENT_TYPES = {
    0: 'BATTLE_START',
    1: 'ATTACK',
    2: 'DEFEND',
    3: 'BRIBE_OFFERED',
    4: 'BRIBE_ACCEPTED',
    5: 'BETRAYAL',
    6: 'OUTLAW_DECLARED',
    7: 'BOUNTY_CLAIMED',
    8: 'AGENT_DEATH',
    9: 'CHAMPION_CROWNED',
    10: 'BUFF_RECEIVED',
    11: 'DRAMATIC_MOMENT'
};

const EVENT_ICONS = {
    'BATTLE_START': '⚔️',
    'ATTACK': '💥',
    'DEFEND': '🛡️',
    'BRIBE_OFFERED': '💰',
    'BRIBE_ACCEPTED': '🤝',
    'BETRAYAL': '🗡️',
    'OUTLAW_DECLARED': '🤠',
    'BOUNTY_CLAIMED': '💀',
    'AGENT_DEATH': '☠️',
    'CHAMPION_CROWNED': '👑',
    'BUFF_RECEIVED': '✨',
    'DRAMATIC_MOMENT': '🎭'
};

const BUFF_TYPES = {
    0: 'HEALTH',
    1: 'ARMOR',
    2: 'ATTACK',
    3: 'SPEED'
};

// ═══════════════════════════════════════════════════════════════════════════════
// DEMO MODE DATA
// ═══════════════════════════════════════════════════════════════════════════════

const DEMO_AGENTS = [
    { address: '0xDEAD...BEEF', health: 850, maxHealth: 1000, armor: 50, attack: 75, speed: 60, charisma: 40, reputation: 72, isOutlaw: false, isAlive: true },
    { address: '0xCAFE...BABE', health: 620, maxHealth: 1000, armor: 80, attack: 45, speed: 40, charisma: 90, reputation: 85, isOutlaw: false, isAlive: true },
    { address: '0x1337...H4X0', health: 0, maxHealth: 1000, armor: 20, attack: 120, speed: 95, charisma: 15, reputation: 18, isOutlaw: true, isAlive: false },
    { address: '0xABCD...1234', health: 450, maxHealth: 1000, armor: 60, attack: 55, speed: 70, charisma: 65, reputation: 55, isOutlaw: false, isAlive: true },
];

const DEMO_EVENTS = [
    { type: 'BRIBE_OFFERED', primaryActor: '0xCAFE...BABE', secondaryActor: '0xDEAD...BEEF', value: '0.5', description: '0xCAFE offered 0.5 MONAD bribe to 0xDEAD', timestamp: Date.now() - 45000, roundId: 47 },
    { type: 'BRIBE_ACCEPTED', primaryActor: '0xDEAD...BEEF', secondaryActor: '0xCAFE...BABE', value: '0.5', description: '0xDEAD accepted bribe from 0xCAFE', timestamp: Date.now() - 40000, roundId: 47 },
    { type: 'BETRAYAL', primaryActor: '0x1337...H4X0', secondaryActor: '0xABCD...1234', value: '0.3', description: '🗡️ 0x1337 BETRAYED 0xABCD! Trust broken!', timestamp: Date.now() - 35000, roundId: 47 },
    { type: 'OUTLAW_DECLARED', primaryActor: '0x1337...H4X0', secondaryActor: '', value: '1.0', description: '🤠 0x1337 is now an OUTLAW! Bounty: 1.0 MONAD', timestamp: Date.now() - 30000, roundId: 47 },
    { type: 'ATTACK', primaryActor: '0xDEAD...BEEF', secondaryActor: '0x1337...H4X0', value: '150', description: '0xDEAD attacked 0x1337 for 150 damage', timestamp: Date.now() - 20000, roundId: 47 },
    { type: 'BUFF_RECEIVED', primaryActor: '0xCAFE...BABE', secondaryActor: '0xViewer', value: '0.1', description: '✨ 0xCAFE received +100 HP from viewer!', timestamp: Date.now() - 15000, roundId: 47 },
    { type: 'BOUNTY_CLAIMED', primaryActor: '0xABCD...1234', secondaryActor: '0x1337...H4X0', value: '1.0', description: '💀 0xABCD claimed bounty on outlaw 0x1337!', timestamp: Date.now() - 10000, roundId: 47 },
    { type: 'AGENT_DEATH', primaryActor: '0x1337...H4X0', secondaryActor: '0xABCD...1234', value: '0', description: '☠️ 0x1337 has been eliminated by 0xABCD', timestamp: Date.now() - 5000, roundId: 47 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function Spectate() {
    const [isConnected, setIsConnected] = useState(false);
    const [isDemoMode, setIsDemoMode] = useState(true);
    const [currentRound] = useState({
        id: 47,
        participants: DEMO_AGENTS.map(a => a.address),
        startTime: Date.now() - 60000,
        endTime: 0,
        status: 'IN_PROGRESS',
        prizePool: '2.5',
        winner: ''
    });
    const [agents, setAgents] = useState(DEMO_AGENTS);
    const [combatLog, setCombatLog] = useState(DEMO_EVENTS);
    const [activeBuffs, setActiveBuffs] = useState({});
    const [view3D, setView3D] = useState(false);

    // Connect wallet
    const connectWallet = useCallback(async () => {
        if (typeof window.ethereum === 'undefined') {
            alert('Please install MetaMask! Running in demo mode.');
            return;
        }

        try {
            const browserProvider = new ethers.BrowserProvider(window.ethereum);
            await browserProvider.send('eth_requestAccounts', []);
            setIsConnected(true);
            setIsDemoMode(false);
        } catch (error) {
            console.error('Failed to connect wallet:', error);
        }
    }, []);

    // Simulate live updates in demo mode
    useEffect(() => {
        if (!isDemoMode) return;

        const interval = setInterval(() => {
            // Randomly update agent health
            setAgents(prev => prev.map(agent => {
                if (!agent.isAlive) return agent;
                const change = Math.floor(Math.random() * 50) - 25;
                const newHealth = Math.max(0, Math.min(agent.maxHealth, agent.health + change));
                return { ...agent, health: newHealth, isAlive: newHealth > 0 };
            }));

            // Randomly add new events
            if (Math.random() > 0.7) {
                const types = ['ATTACK', 'DEFEND', 'BUFF_RECEIVED'];
                const type = types[Math.floor(Math.random() * types.length)];
                const actor = DEMO_AGENTS[Math.floor(Math.random() * DEMO_AGENTS.length)];
                const target = DEMO_AGENTS[Math.floor(Math.random() * DEMO_AGENTS.length)];

                setCombatLog(prev => [{
                    type,
                    primaryActor: actor.address,
                    secondaryActor: target.address,
                    value: (Math.random() * 100).toFixed(0),
                    description: `${actor.address} ${type.toLowerCase()} ${target.address}`,
                    timestamp: Date.now(),
                    roundId: 47
                }, ...prev.slice(0, 19)]);
            }
        }, 3000);

        return () => clearInterval(interval);
    }, [isDemoMode]);

    // Live WebSocket integration
    useEffect(() => {
        if (isDemoMode) return;

        let ws;
        let reconnectTimer;

        const connect = () => {
            ws = new WebSocket(WS_URL);

            ws.onopen = () => {
                console.log('[WS] Connected to battle server');
                // Subscribe to all arena events
                ws.send(JSON.stringify({ type: 'subscribe', arenaId: '*' }));
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    handleLiveEvent(msg);
                } catch (e) {
                    console.error('[WS] Parse error:', e);
                }
            };

            ws.onclose = () => {
                console.log('[WS] Disconnected, reconnecting in 3s...');
                reconnectTimer = setTimeout(connect, 3000);
            };

            ws.onerror = (err) => {
                console.error('[WS] Error:', err);
            };
        };

        const handleLiveEvent = (msg) => {
            switch (msg.type) {
                case 'match:turn': {
                    // Map turn events to combat log entries
                    if (msg.events) {
                        const newEntries = msg.events
                            .filter(e => e.type !== 'recovery')
                            .map(e => ({
                                type: mapEventType(e.type),
                                primaryActor: e.attackerId || e.agentId || e.betrayer || '',
                                secondaryActor: e.defenderId || e.victim || '',
                                value: String(e.damage || 0),
                                description: formatLiveEvent(e),
                                timestamp: Date.now(),
                                roundId: msg.turn,
                            }));
                        setCombatLog(prev => [...newEntries, ...prev].slice(0, 30));
                    }
                    break;
                }
                case 'agent:died': {
                    setCombatLog(prev => [{
                        type: 'AGENT_DEATH',
                        primaryActor: msg.agentId,
                        secondaryActor: '',
                        value: '0',
                        description: `☠️ ${msg.agentId} has been eliminated! (Turn ${msg.turn})`,
                        timestamp: Date.now(),
                        roundId: msg.turn,
                    }, ...prev].slice(0, 30));
                    break;
                }
                case 'alliance:formed': {
                    const a = msg.alliance;
                    setCombatLog(prev => [{
                        type: 'BRIBE_ACCEPTED',
                        primaryActor: a.members[0],
                        secondaryActor: a.members[1],
                        value: '0',
                        description: `🤝 İttifak kuruldu: ${a.members.join(' & ')}`,
                        timestamp: Date.now(),
                        roundId: 0,
                    }, ...prev].slice(0, 30));
                    break;
                }
                case 'alliance:betrayal': {
                    setCombatLog(prev => [{
                        type: 'BETRAYAL',
                        primaryActor: msg.betrayer,
                        secondaryActor: msg.victim,
                        value: '0',
                        description: `🗡️ ${msg.betrayer} İHANET ETTİ ${msg.victim}'a!`,
                        timestamp: Date.now(),
                        roundId: 0,
                    }, ...prev].slice(0, 30));
                    break;
                }
                case 'match:completed': {
                    setCombatLog(prev => [{
                        type: 'CHAMPION_CROWNED',
                        primaryActor: msg.result?.winner?.id || '',
                        secondaryActor: '',
                        value: '0',
                        description: `👑 Maç bitti! Kazanan: ${msg.result?.winner?.id || 'Berabere'}`,
                        timestamp: Date.now(),
                        roundId: 0,
                    }, ...prev].slice(0, 30));
                    break;
                }
                default:
                    break;
            }
        };

        const mapEventType = (type) => {
            const map = {
                'attack': 'ATTACK',
                'defend': 'DEFEND',
                'betrayal': 'BETRAYAL',
                'alliance_formed': 'BRIBE_ACCEPTED',
                'propose_alliance': 'BRIBE_OFFERED',
                'death': 'AGENT_DEATH',
                'match_end': 'CHAMPION_CROWNED',
            };
            return map[type] || 'DRAMATIC_MOMENT';
        };

        const formatLiveEvent = (e) => {
            switch (e.type) {
                case 'attack':
                    return `💥 ${e.attackerId} saldırıyor → ${e.defenderId} (${e.damage} hasar${e.defended ? ', savunuldu!' : ''})`;
                case 'defend':
                    return `🛡️ ${e.agentId} savunuyor`;
                case 'betrayal':
                    return `🗡️ ${e.betrayer} İHANET → ${e.victim} (${e.damage} hasar!)`;
                case 'death':
                    return `☠️ ${e.agentId} elendi!`;
                case 'match_end':
                    return `👑 Kazanan: ${e.winner || 'Berabere'}`;
                default:
                    return `${e.type}: ${JSON.stringify(e)}`;
            }
        };

        connect();

        return () => {
            if (ws) ws.close();
            if (reconnectTimer) clearTimeout(reconnectTimer);
        };
    }, [isDemoMode]);

    // ═══════════════════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════════════════

    return (
        <div className="spectate-container">
            <header className="spectate-header">
                <h1>🏛️ Monad Colosseum</h1>
                <div className="header-right">
                    {isDemoMode && <span className="demo-badge">📺 DEMO MODE</span>}
                    <div className="connection-status">
                        {isConnected ? (
                            <span className="connected">🟢 Connected</span>
                        ) : (
                            <button onClick={connectWallet} className="connect-btn">
                                Connect Wallet
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <div className="spectate-grid">
                {/* Left Panel: Combat Log */}
                <div className="combat-log-panel">
                    <CombatLog events={combatLog} />
                </div>

                {/* Center Panel: Arena View */}
                <div className="arena-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <RoundInfo round={currentRound} />
                        <button
                            onClick={() => setView3D(!view3D)}
                            className="view-toggle-btn"
                            style={{
                                padding: '0.5rem 1rem',
                                background: view3D ? '#8b5cf6' : 'transparent',
                                border: '1px solid #8b5cf6',
                                borderRadius: '8px',
                                color: '#fff',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                            }}
                        >
                            {view3D ? '🎮 3D View' : '📊 2D View'}
                        </button>
                    </div>

                    {view3D ? (
                        <Arena3DViewer
                            agents={agents}
                            events={combatLog.slice(0, 10).map(e => ({
                                type: e.type.toLowerCase(),
                                attackerId: e.primaryActor,
                                defenderId: e.secondaryActor,
                                agentId: e.primaryActor,
                                damage: parseInt(e.value) || 0
                            }))}
                            isLive={!isDemoMode}
                            arenaId={`arena_${currentRound.id}`}
                        />
                    ) : (
                        <AgentGrid agents={agents} activeBuffs={activeBuffs} />
                    )}
                </div>

                {/* Right Panel: Viewer Buff Interface */}
                <div className="buff-panel">
                    <ViewerBuffPanel
                        agents={agents}
                        currentRound={currentRound.id}
                        isDemoMode={isDemoMode}
                        onBuffSent={(agent, buffType) => {
                            setActiveBuffs(prev => ({
                                ...prev,
                                [agent]: [...(prev[agent] || []), { type: buffType, magnitude: 100, viewer: 'You', timestamp: Date.now() }]
                            }));
                            setCombatLog(prev => [{
                                type: 'BUFF_RECEIVED',
                                primaryActor: agent,
                                secondaryActor: 'You',
                                value: '0.1',
                                description: `✨ ${agent} received +100 ${BUFF_TYPES[buffType]} from You!`,
                                timestamp: Date.now(),
                                roundId: 47
                            }, ...prev.slice(0, 19)]);
                        }}
                    />
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function CombatLog({ events }) {
    return (
        <div className="combat-log">
            <h3>⚔️ Live Combat Feed</h3>
            <div className="log-entries">
                {events.length === 0 ? (
                    <div className="no-events">Waiting for battle events...</div>
                ) : (
                    events.map((event, i) => (
                        <div key={i} className={`log-entry ${event.type.toLowerCase()}`}>
                            <span className="timestamp">
                                {formatTimestamp(event.timestamp)}
                            </span>
                            <span className="icon">{EVENT_ICONS[event.type] || '📢'}</span>
                            <p className="description">{event.description}</p>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

function RoundInfo({ round }) {
    if (!round) {
        return <div className="round-info">No active round</div>;
    }

    return (
        <div className="round-info">
            <h2>Round #{round.id}</h2>
            <div className="round-stats">
                <span className={`status ${round.status.toLowerCase()}`}>
                    {round.status}
                </span>
                <span className="prize">💰 {round.prizePool} MONAD</span>
                {round.winner && round.winner !== ethers.ZeroAddress && (
                    <span className="winner">👑 Winner: {round.winner}</span>
                )}
            </div>
        </div>
    );
}

function AgentGrid({ agents, activeBuffs }) {
    return (
        <div className="agent-grid">
            {agents.map((agent) => (
                <AgentCard
                    key={agent.address}
                    agent={agent}
                    buffs={activeBuffs[agent.address] || []}
                />
            ))}
        </div>
    );
}

function AgentCard({ agent, buffs }) {
    const healthPercent = (agent.health / agent.maxHealth) * 100;

    return (
        <div
            className={`agent-card ${!agent.isAlive ? 'dead' : ''} ${agent.isOutlaw ? 'outlaw' : ''}`}
            data-agent={agent.address}
        >
            <div className="agent-header">
                <span className="address">{agent.address}</span>
                {agent.isOutlaw && <span className="outlaw-badge">🤠 OUTLAW</span>}
            </div>

            <div className="health-bar">
                <div className="health-fill" style={{ width: `${healthPercent}%` }} />
                <span className="health-text">{agent.health} / {agent.maxHealth}</span>
            </div>

            <div className="stats">
                <div className="stat">
                    <span className="label">⚔️</span>
                    <span className="value">{agent.attack}</span>
                </div>
                <div className="stat">
                    <span className="label">🛡️</span>
                    <span className="value">{agent.armor}</span>
                </div>
                <div className="stat">
                    <span className="label">⚡</span>
                    <span className="value">{agent.speed}</span>
                </div>
                <div className="stat">
                    <span className="label">💬</span>
                    <span className="value">{agent.charisma}</span>
                </div>
                <div className="stat">
                    <span className="label">⭐</span>
                    <span className={`value ${agent.reputation < 20 ? 'low' : agent.reputation > 70 ? 'high' : ''}`}>
                        {agent.reputation}
                    </span>
                </div>
            </div>

            {buffs.length > 0 && (
                <div className="active-buffs">
                    {buffs.slice(-3).map((buff, i) => (
                        <span key={i} className={`buff ${BUFF_TYPES[buff.type].toLowerCase()}`}>
                            +{buff.magnitude} {BUFF_TYPES[buff.type]}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function ViewerBuffPanel({ agents, currentRound, isDemoMode, onBuffSent }) {
    const [selectedAgent, setSelectedAgent] = useState('');
    const [buffType, setBuffType] = useState(0);
    const [tokenAmount, setTokenAmount] = useState('0.1');
    const [isSending, setIsSending] = useState(false);

    const sendBuff = async () => {
        if (!selectedAgent || !tokenAmount) return;

        setIsSending(true);

        if (isDemoMode) {
            // Demo mode: simulate buff
            setTimeout(() => {
                onBuffSent(selectedAgent, buffType);
                setIsSending(false);
                alert('🔥 Buff sent! (Demo mode)');
            }, 1000);
            return;
        }

        try {
            // Real mode: call contract
            // const buffOracle = new ethers.Contract(BUFF_ORACLE_ADDRESS, BuffOracleABI, signer);
            // const tx = await buffOracle.applyBuff(...);
            // await tx.wait();
            alert('Buff sent! 🔥');
        } catch (error) {
            console.error('Failed to send buff:', error);
            alert('Failed to send buff');
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className="viewer-buff-panel">
            <h3>💪 Buff Your Gladiator</h3>

            <div className="form-group">
                <label>Select Agent</label>
                <select
                    value={selectedAgent}
                    onChange={(e) => setSelectedAgent(e.target.value)}
                >
                    <option value="">Choose a gladiator...</option>
                    {agents.filter(a => a.isAlive).map(a => (
                        <option key={a.address} value={a.address}>
                            {a.address} - HP: {a.health}
                        </option>
                    ))}
                </select>
            </div>

            <div className="form-group">
                <label>Buff Type</label>
                <select
                    value={buffType}
                    onChange={(e) => setBuffType(Number(e.target.value))}
                >
                    <option value={0}>❤️ Health (+HP)</option>
                    <option value={1}>🛡️ Armor (+DEF)</option>
                    <option value={2}>⚔️ Attack (+ATK)</option>
                    <option value={3}>⚡ Speed (+SPD)</option>
                </select>
            </div>

            <div className="form-group">
                <label>Tokens to Burn</label>
                <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={tokenAmount}
                    onChange={(e) => setTokenAmount(e.target.value)}
                    placeholder="0.1"
                />
                <span className="token-symbol">MONAD</span>
            </div>

            <button
                onClick={sendBuff}
                disabled={isSending || !selectedAgent}
                className="send-buff-btn"
            >
                {isSending ? 'Sending...' : '🔥 Burn & Buff'}
            </button>

            <div className="buff-info">
                <p>💡 Burn tokens to instantly buff your favorite gladiator!</p>
                <p>⚡ Effect: +{Math.floor(parseFloat(tokenAmount || '0') * 1000)} to selected stat</p>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function formatTimestamp(ts) {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

export default Spectate;
