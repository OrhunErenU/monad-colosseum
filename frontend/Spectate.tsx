/**
 * Spectate.tsx - Live Combat Stream Integration
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

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface AgentStats {
    address: string;
    health: number;
    maxHealth: number;
    armor: number;
    attack: number;
    speed: number;
    charisma: number;
    reputation: number;
    isOutlaw: boolean;
    isAlive: boolean;
}

interface NarrativeEvent {
    type: string;
    primaryActor: string;
    secondaryActor: string;
    value: string;
    description: string;
    timestamp: number;
    roundId: number;
}

interface ActiveBuff {
    type: number;
    magnitude: number;
    viewer: string;
    timestamp: number;
}

interface RoundState {
    id: number;
    participants: string[];
    startTime: number;
    endTime: number;
    status: string;
    prizePool: string;
    winner: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRACT ADDRESSES (Monad Testnet)
// ═══════════════════════════════════════════════════════════════════════════════

const ARENA_ADDRESS = process.env.REACT_APP_ARENA_ADDRESS || '0x...';
const NARRATOR_ADDRESS = process.env.REACT_APP_NARRATOR_ADDRESS || '0x...';
const BUFF_ORACLE_ADDRESS = process.env.REACT_APP_BUFF_ORACLE_ADDRESS || '0x...';
const ESCROW_ADDRESS = process.env.REACT_APP_ESCROW_ADDRESS || '0x...';

// ═══════════════════════════════════════════════════════════════════════════════
// ABIs (Minimal)
// ═══════════════════════════════════════════════════════════════════════════════

const ArenaABI = [
    "function getCurrentRound() view returns (uint256)",
    "function getRound(uint256 roundId) view returns (tuple(uint256 id, address[] participants, uint256 startTime, uint256 endTime, uint256 prizePool, address winner, uint8 status))",
    "function getRoundState(uint256 roundId) view returns (address[] participants, uint256 startTime, uint256 endTime, bool isActive)",
    "function getAgentTempStats(address agent) view returns (tuple(uint16 health, uint16 maxHealth, uint16 armor, uint16 attack, uint16 speed, uint16 charisma, bool isAlive))",
    "event RoundStarted(uint256 indexed roundId, address[] participants, uint256 timestamp)",
    "event RoundCompleted(uint256 indexed roundId, address indexed winner, uint256 prizeAmount)",
    "event DamageDealt(uint256 indexed roundId, address indexed attacker, address indexed target, uint256 damage, uint256 remainingHealth)",
    "event AgentEliminated(address indexed agent, address indexed killer, uint256 indexed roundId)"
];

const NarratorABI = [
    "function getTimeline(uint256 limit) view returns (tuple(uint8 eventType, address primaryActor, address secondaryActor, uint256 value, uint256 timestamp, uint256 roundId, bytes32 metadata)[])",
    "function getAgentTitle(address agent) view returns (string)",
    "event NarrativeRecorded(uint256 indexed eventIndex, uint8 indexed eventType, address indexed primaryActor, address secondaryActor, uint256 value, uint256 roundId)"
];

const BuffOracleABI = [
    "function getAgentBuffs(address agent, uint256 roundId) view returns (tuple(address agent, address viewer, uint96 tokensBurned, uint8 buffType, uint16 magnitude, uint40 appliedAt, uint40 roundId, bool consumed)[])",
    "function applyBuff(address agent, address viewer, uint96 tokenAmount, uint8 buffType, uint256 roundId)",
    "event BuffApplied(address indexed agent, address indexed viewer, uint96 tokensBurned, uint8 buffType, uint16 magnitude, uint256 indexed roundId)"
];

const EscrowABI = [
    "function getReputation(address agent) view returns (uint256)",
    "function isOutlaw(address agent) view returns (bool)"
];

const IAgentABI = [
    "function getStats() view returns (tuple(uint16 health, uint16 maxHealth, uint16 armor, uint16 attack, uint16 speed, uint16 charisma, uint16 loyalty))"
];

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT TYPE MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

const EVENT_TYPES: Record<number, string> = {
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

const EVENT_ICONS: Record<string, string> = {
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

const BUFF_TYPES: Record<number, string> = {
    0: 'HEALTH',
    1: 'ARMOR',
    2: 'ATTACK',
    3: 'SPEED'
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function Spectate() {
    const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
    const [signer, setSigner] = useState<ethers.Signer | null>(null);
    const [currentRound, setCurrentRound] = useState<RoundState | null>(null);
    const [agents, setAgents] = useState<AgentStats[]>([]);
    const [combatLog, setCombatLog] = useState<NarrativeEvent[]>([]);
    const [activeBuffs, setActiveBuffs] = useState<Record<string, ActiveBuff[]>>({});
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // ═══════════════════════════════════════════════════════════════════════════
    // WALLET CONNECTION
    // ═══════════════════════════════════════════════════════════════════════════

    const connectWallet = useCallback(async () => {
        if (typeof window.ethereum === 'undefined') {
            alert('Please install MetaMask!');
            return;
        }

        try {
            const browserProvider = new ethers.BrowserProvider(window.ethereum);
            await browserProvider.send('eth_requestAccounts', []);
            const signer = await browserProvider.getSigner();

            setProvider(browserProvider);
            setSigner(signer);
            setIsConnected(true);
        } catch (error) {
            console.error('Failed to connect wallet:', error);
        }
    }, []);

    // ═══════════════════════════════════════════════════════════════════════════
    // DATA FETCHING
    // ═══════════════════════════════════════════════════════════════════════════

    const fetchRoundState = useCallback(async () => {
        if (!provider) return;

        try {
            const arenaContract = new ethers.Contract(ARENA_ADDRESS, ArenaABI, provider);
            const roundId = await arenaContract.getCurrentRound();

            if (roundId > 0) {
                const round = await arenaContract.getRound(roundId);

                setCurrentRound({
                    id: Number(roundId),
                    participants: round.participants,
                    startTime: Number(round.startTime),
                    endTime: Number(round.endTime),
                    status: ['PENDING', 'ACCEPTING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'][round.status],
                    prizePool: ethers.formatEther(round.prizePool),
                    winner: round.winner
                });

                // Fetch agent stats
                const escrowContract = new ethers.Contract(ESCROW_ADDRESS, EscrowABI, provider);

                const agentStats = await Promise.all(
                    round.participants.map(async (addr: string) => {
                        try {
                            const tempStats = await arenaContract.getAgentTempStats(addr);
                            const reputation = await escrowContract.getReputation(addr);
                            const isOutlaw = await escrowContract.isOutlaw(addr);

                            return {
                                address: addr,
                                health: Number(tempStats.health),
                                maxHealth: Number(tempStats.maxHealth),
                                armor: Number(tempStats.armor),
                                attack: Number(tempStats.attack),
                                speed: Number(tempStats.speed),
                                charisma: Number(tempStats.charisma),
                                reputation: Number(reputation),
                                isOutlaw,
                                isAlive: tempStats.isAlive
                            };
                        } catch {
                            return {
                                address: addr,
                                health: 100,
                                maxHealth: 100,
                                armor: 20,
                                attack: 30,
                                speed: 50,
                                charisma: 50,
                                reputation: 50,
                                isOutlaw: false,
                                isAlive: true
                            };
                        }
                    })
                );

                setAgents(agentStats);
            }
        } catch (error) {
            console.error('Failed to fetch round state:', error);
        } finally {
            setIsLoading(false);
        }
    }, [provider]);

    const fetchCombatLog = useCallback(async () => {
        if (!provider) return;

        try {
            const narratorContract = new ethers.Contract(NARRATOR_ADDRESS, NarratorABI, provider);
            const events = await narratorContract.getTimeline(20);

            const formattedEvents: NarrativeEvent[] = events.map((e: any) => ({
                type: EVENT_TYPES[e.eventType] || 'UNKNOWN',
                primaryActor: e.primaryActor,
                secondaryActor: e.secondaryActor,
                value: ethers.formatEther(e.value),
                description: generateEventDescription(EVENT_TYPES[e.eventType], e),
                timestamp: Number(e.timestamp) * 1000,
                roundId: Number(e.roundId)
            }));

            setCombatLog(formattedEvents);
        } catch (error) {
            console.error('Failed to fetch combat log:', error);
        }
    }, [provider]);

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENT SUBSCRIPTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    useEffect(() => {
        if (!provider) return;

        const arenaContract = new ethers.Contract(ARENA_ADDRESS, ArenaABI, provider);
        const narratorContract = new ethers.Contract(NARRATOR_ADDRESS, NarratorABI, provider);
        const buffOracle = new ethers.Contract(BUFF_ORACLE_ADDRESS, BuffOracleABI, provider);

        // Subscribe to narrative events
        const handleNarrativeEvent = (
            eventIndex: bigint,
            eventType: number,
            primaryActor: string,
            secondaryActor: string,
            value: bigint,
            roundId: bigint
        ) => {
            const newEvent: NarrativeEvent = {
                type: EVENT_TYPES[eventType] || 'UNKNOWN',
                primaryActor,
                secondaryActor,
                value: ethers.formatEther(value),
                description: generateEventDescription(EVENT_TYPES[eventType], { primaryActor, secondaryActor, value }),
                timestamp: Date.now(),
                roundId: Number(roundId)
            };

            setCombatLog(prev => [newEvent, ...prev.slice(0, 49)]);
        };

        // Subscribe to buff applications
        const handleBuffApplied = (
            agent: string,
            viewer: string,
            tokensBurned: bigint,
            buffType: number,
            magnitude: number,
            roundId: bigint
        ) => {
            // Trigger visual effect
            triggerBuffEffect(agent, buffType, magnitude);

            // Update active buffs
            setActiveBuffs(prev => ({
                ...prev,
                [agent]: [
                    ...(prev[agent] || []),
                    {
                        type: buffType,
                        magnitude,
                        viewer,
                        timestamp: Date.now()
                    }
                ]
            }));

            // Add to combat log
            setCombatLog(prev => [{
                type: 'BUFF_RECEIVED',
                primaryActor: agent,
                secondaryActor: viewer,
                value: ethers.formatEther(tokensBurned),
                description: `${shortenAddress(agent)} received +${magnitude} ${BUFF_TYPES[buffType]} from ${shortenAddress(viewer)}`,
                timestamp: Date.now(),
                roundId: Number(roundId)
            }, ...prev.slice(0, 49)]);
        };

        // Subscribe to damage events
        const handleDamage = (
            roundId: bigint,
            attacker: string,
            target: string,
            damage: bigint,
            remainingHealth: bigint
        ) => {
            setCombatLog(prev => [{
                type: 'ATTACK',
                primaryActor: attacker,
                secondaryActor: target,
                value: damage.toString(),
                description: `${shortenAddress(attacker)} dealt ${damage} damage to ${shortenAddress(target)} (${remainingHealth} HP remaining)`,
                timestamp: Date.now(),
                roundId: Number(roundId)
            }, ...prev.slice(0, 49)]);

            // Update agent health
            setAgents(prev => prev.map(a =>
                a.address.toLowerCase() === target.toLowerCase()
                    ? { ...a, health: Number(remainingHealth) }
                    : a
            ));
        };

        // Subscribe to eliminations
        const handleElimination = (agent: string, killer: string, roundId: bigint) => {
            setCombatLog(prev => [{
                type: 'AGENT_DEATH',
                primaryActor: agent,
                secondaryActor: killer,
                value: '0',
                description: `☠️ ${shortenAddress(agent)} was eliminated by ${shortenAddress(killer)}!`,
                timestamp: Date.now(),
                roundId: Number(roundId)
            }, ...prev.slice(0, 49)]);

            setAgents(prev => prev.map(a =>
                a.address.toLowerCase() === agent.toLowerCase()
                    ? { ...a, health: 0, isAlive: false }
                    : a
            ));
        };

        // Attach listeners
        narratorContract.on('NarrativeRecorded', handleNarrativeEvent);
        buffOracle.on('BuffApplied', handleBuffApplied);
        arenaContract.on('DamageDealt', handleDamage);
        arenaContract.on('AgentEliminated', handleElimination);

        return () => {
            narratorContract.removeAllListeners();
            buffOracle.removeAllListeners();
            arenaContract.removeAllListeners();
        };
    }, [provider]);

    // Initial data fetch
    useEffect(() => {
        if (provider) {
            fetchRoundState();
            fetchCombatLog();

            // Poll every 5 seconds
            const interval = setInterval(() => {
                fetchRoundState();
            }, 5000);

            return () => clearInterval(interval);
        }
    }, [provider, fetchRoundState, fetchCombatLog]);

    // ═══════════════════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════════════════

    return (
        <div className="spectate-container">
            <header className="spectate-header">
                <h1>🏛️ Monad Colosseum</h1>
                <div className="connection-status">
                    {isConnected ? (
                        <span className="connected">🟢 Connected</span>
                    ) : (
                        <button onClick={connectWallet} className="connect-btn">
                            Connect Wallet
                        </button>
                    )}
                </div>
            </header>

            {isLoading ? (
                <div className="loading">Loading arena...</div>
            ) : (
                <div className="spectate-grid">
                    {/* Left Panel: Combat Log */}
                    <div className="combat-log-panel">
                        <CombatLog events={combatLog} />
                    </div>

                    {/* Center Panel: Arena View */}
                    <div className="arena-panel">
                        <RoundInfo round={currentRound} />
                        <AgentGrid agents={agents} activeBuffs={activeBuffs} />
                    </div>

                    {/* Right Panel: Viewer Buff Interface */}
                    <div className="buff-panel">
                        {signer && currentRound && (
                            <ViewerBuffPanel
                                agents={agents}
                                currentRound={currentRound.id}
                                signer={signer}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function CombatLog({ events }: { events: NarrativeEvent[] }) {
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

function RoundInfo({ round }: { round: RoundState | null }) {
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
                    <span className="winner">👑 Winner: {shortenAddress(round.winner)}</span>
                )}
            </div>
        </div>
    );
}

function AgentGrid({ agents, activeBuffs }: {
    agents: AgentStats[],
    activeBuffs: Record<string, ActiveBuff[]>
}) {
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

function AgentCard({ agent, buffs }: { agent: AgentStats, buffs: ActiveBuff[] }) {
    const healthPercent = (agent.health / agent.maxHealth) * 100;

    return (
        <div
            className={`agent-card ${!agent.isAlive ? 'dead' : ''} ${agent.isOutlaw ? 'outlaw' : ''}`}
            data-agent={agent.address}
        >
            <div className="agent-header">
                <span className="address">{shortenAddress(agent.address)}</span>
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

function ViewerBuffPanel({
    agents,
    currentRound,
    signer
}: {
    agents: AgentStats[],
    currentRound: number,
    signer: ethers.Signer
}) {
    const [selectedAgent, setSelectedAgent] = useState<string>('');
    const [buffType, setBuffType] = useState<number>(0);
    const [tokenAmount, setTokenAmount] = useState<string>('0.1');
    const [isSending, setIsSending] = useState(false);

    const sendBuff = async () => {
        if (!selectedAgent || !tokenAmount) return;

        setIsSending(true);
        try {
            const buffOracle = new ethers.Contract(BUFF_ORACLE_ADDRESS, BuffOracleABI, signer);

            // Note: In production, this would first burn tokens on nad.fun
            // For now, we just call applyBuff directly

            const tx = await buffOracle.applyBuff(
                selectedAgent,
                await signer.getAddress(),
                ethers.parseEther(tokenAmount),
                buffType,
                currentRound,
                { value: ethers.parseEther(tokenAmount) }
            );

            await tx.wait();
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
                            {shortenAddress(a.address)} - HP: {a.health}
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
                <p>⚡ Effect: +{Math.floor(parseFloat(tokenAmount || '0') * 10)} to selected stat</p>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function shortenAddress(address: string): string {
    if (!address || address === ethers.ZeroAddress) return 'Unknown';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimestamp(ts: number): string {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function generateEventDescription(type: string, event: any): string {
    const actor = shortenAddress(event.primaryActor);
    const target = shortenAddress(event.secondaryActor);
    const value = typeof event.value === 'bigint' ? ethers.formatEther(event.value) : event.value;

    switch (type) {
        case 'BATTLE_START':
            return `Battle round started!`;
        case 'ATTACK':
            return `${actor} attacked ${target}`;
        case 'DEFEND':
            return `${actor} is defending`;
        case 'BRIBE_OFFERED':
            return `${actor} offered ${value} MONAD bribe to ${target}`;
        case 'BRIBE_ACCEPTED':
            return `${actor} accepted bribe from ${target}`;
        case 'BETRAYAL':
            return `🗡️ ${actor} BETRAYED ${target}! Trust broken!`;
        case 'OUTLAW_DECLARED':
            return `🤠 ${actor} is now an OUTLAW! Bounty: ${value} MONAD`;
        case 'BOUNTY_CLAIMED':
            return `💀 ${actor} claimed bounty on outlaw ${target}!`;
        case 'AGENT_DEATH':
            return `☠️ ${actor} has been eliminated by ${target}`;
        case 'CHAMPION_CROWNED':
            return `👑 ${actor} wins ${value} MONAD as CHAMPION!`;
        case 'BUFF_RECEIVED':
            return `✨ ${actor} received buff from ${target}`;
        default:
            return `${type}: ${actor} → ${target}`;
    }
}

function triggerBuffEffect(agentAddress: string, buffType: number, magnitude: number): void {
    const agentElement = document.querySelector(`[data-agent="${agentAddress}"]`);
    if (!agentElement) return;

    const particle = document.createElement('div');
    particle.className = `buff-particle ${BUFF_TYPES[buffType].toLowerCase()}`;
    particle.textContent = `+${magnitude}`;
    agentElement.appendChild(particle);

    // Animate
    particle.animate([
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-30px)' }
    ], {
        duration: 2000,
        easing: 'ease-out'
    });

    setTimeout(() => particle.remove(), 2000);
}

export default Spectate;
