/**
 * AgentBrain.ts - Autonomous Decision Engine for Monad Colosseum
 * 
 * This class manages an AI gladiator agent that:
 * 1. Monitors blockchain for battle events in REAL-TIME
 * 2. Gathers intelligence about current battle state
 * 3. Consults Claude AI for strategic decisions
 * 4. Executes decisions via AA wallet with session keys (NO USER APPROVAL)
 * 5. Contributes winning strategies to genetic pool
 * 
 * @author Monad Colosseum Team
 */

import { ethers, Contract, Provider, Wallet } from 'ethers';
import Anthropic from '@anthropic-ai/sdk';
import { AASigner, createAASigner } from './aa-utils';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

export interface AgentInfo {
    agentAddress: string;
    health: number;
    attack: number;
    armor: number;
    speed: number;
    reputation: number;
    hasActiveBribe: boolean;
    position: { x: number; y: number };
    isOutlaw: boolean;
    bountyAmount: bigint;
}

export interface BribeInfo {
    dealId: string;
    offerer: string;
    target: string;
    amount: bigint;
    terms: string;
    expiresAt: number;
    isAccepted: boolean;
}

export interface BuffInfo {
    beneficiary: string;
    buffType: number;
    value: number;
    roundsRemaining: number;
    donor: string;
    burnedAmount: bigint;
}

export interface BattleState {
    roundId: number;
    agents: AgentInfo[];
    activeBribes: BribeInfo[];
    viewerBuffs: BuffInfo[];
    myHealth: number;
    myPosition: { x: number; y: number };
    timeRemaining: number;
    arenaAddress: string;
    outlaws: string[];
}

export interface AgentStats {
    health: number;
    maxHealth: number;
    armor: number;
    attack: number;
    speed: number;
    charisma: number;
    loyalty: number;
}

export type ActionType = 'ATTACK' | 'DEFEND' | 'OFFER_BRIBE' | 'ACCEPT_BRIBE' | 'BETRAY' | 'FLEE' | 'HUNT_OUTLAW';

export interface StrategyOutput {
    action: ActionType;
    target?: string;
    bribeAmount?: bigint;
    bribeTerms?: string;
    dealId?: string;
    reasoning: string;
    confidence: number;
}

export interface Intelligence {
    myStats: AgentStats;
    myReputation: number;
    amIOutlaw: boolean;
    threats: ThreatInfo[];
    bribeOpportunities: BribeOpportunity[];
    incomingBribes: BribeInfo[];
    viewerBuffs: BuffInfo[];
    betrayalHistory: Map<string, number>;
    geneticAdvice: string[];
    outlawTargets: OutlawTarget[];
}

export interface ThreatInfo {
    address: string;
    threatLevel: number;
    health: number;
    attack: number;
    distance: number;
    hasActiveBribe: boolean;
    isOutlaw: boolean;
}

export interface BribeOpportunity {
    targetAddress: string;
    suggestedAmount: bigint;
    expectedSuccess: number;
    reason: string;
}

export interface OutlawTarget {
    address: string;
    bountyAmount: bigint;
    health: number;
    killDifficulty: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRACT ABIs
// ═══════════════════════════════════════════════════════════════════════════════

const AGENT_ABI = [
    "function getStats() view returns (tuple(uint16 health, uint16 maxHealth, uint16 armor, uint16 attack, uint16 speed, uint16 charisma, uint16 loyalty))",
    "function getState() view returns (uint8)",
    "function decideAction(bytes battleState, uint256 gasLimit) returns (tuple(uint8 actionType, address target, uint64 timestamp, uint256 value, bytes32 strategyHash))",
    "function sendBribe(address target, uint256 amount, bytes terms) payable returns (bytes32)",
    "function evaluateBribe(bytes32 dealId, bytes offer) view returns (bool accepted, bytes counterOffer)",
    "function contributeGenetics() returns (bytes32)",
    "function getReputation() view returns (uint256)",
    "event ActionDecided(address indexed agent, uint8 indexed actionType, address indexed target, uint256 value, uint256 timestamp)"
];

const ESCROW_ABI = [
    "function getReputation(address agent) view returns (uint256)",
    "function getDeal(bytes32 dealId) view returns (tuple(address offerer, address target, uint96 amount, bytes terms, uint8 status, uint40 createdAt, uint40 expiresAt, uint40 roundId, bool targetAttacked))",
    "function checkCooldown(address agent) view returns (bool inCooldown, uint256 endsAt)",
    "function createDeal(address target, bytes terms, uint256 roundId) payable returns (bytes32)",
    "function acceptDeal(bytes32 dealId)",
    "function isOutlaw(address agent) view returns (bool)",
    "function bountyAmount(address agent) view returns (uint256)",
    "event DealCreated(bytes32 indexed dealId, address indexed offerer, address indexed target, uint256 amount, uint256 roundId, uint256 expiresAt)",
    "event DealAccepted(bytes32 indexed dealId, address indexed target, uint256 timestamp)",
    "event DealBetrayed(bytes32 indexed dealId, address indexed betrayer, address indexed victim, uint256 burnedAmount, uint256 refundedAmount, uint256 newReputation)",
    "event OutlawDeclared(address indexed agent, uint256 bountyAmount)"
];

const ARENA_ABI = [
    "function getCurrentRound() view returns (uint256)",
    "function getBattleState() view returns (bytes)",
    "function getAgents() view returns (address[])",
    "function getRoundState(uint256 roundId) view returns (tuple(address[] participants, uint256 startTime, uint256 endTime, bool isActive))",
    "function submitAction(address agent, bytes action)",
    "event RoundStarted(uint256 indexed roundId, address[] participants, uint256 timestamp)",
    "event RoundEnded(uint256 indexed roundId, address[] survivors)",
    "event BattleEnded(uint256 indexed battleId, address winner, uint256 prizeAmount)",
    "event AgentEliminated(address indexed agent, address indexed killer, uint256 roundId)"
];

const BUFF_ORACLE_ABI = [
    "function getAgentBuffs(address agent, uint256 roundId) view returns (tuple(address agent, address viewer, uint96 tokensBurned, uint8 buffType, uint16 magnitude, uint40 appliedAt, uint40 roundId, bool consumed)[])",
    "function getAggregatedBuffs(address agent, uint256 roundId) view returns (uint16 healthBuff, uint16 armorBuff, uint16 attackBuff, uint16 speedBuff)",
    "event BuffApplied(address indexed agent, address indexed viewer, uint96 tokensBurned, uint8 buffType, uint16 magnitude, uint256 indexed roundId)"
];

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT BRAIN CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export class AgentBrain {
    private provider: Provider;
    private wallet: Wallet;
    private aaSigner: AASigner | null = null;
    private agentAddress: string;
    private claude: Anthropic;

    private agentContract: Contract;
    private escrowContract: Contract;
    private arenaContract: Contract;
    private buffOracleContract: Contract | null = null;

    // Strategy memory
    private winningStrategies: string[] = [];
    private betrayalHistory: Map<string, number> = new Map();
    private actionHistory: StrategyOutput[] = [];
    private lastDecision: StrategyOutput | null = null;

    // Event tracking
    private isListening: boolean = false;
    private pendingBribes: Map<string, BribeInfo> = new Map();

    // Priority targets for outlaw hunting
    private priorityTargets: Map<string, {
        reason: string;
        reward: bigint;
        addedAt: number;
        priority: number;
    }> = new Map();

    // Configuration
    private readonly DECISION_GAS_LIMIT = 100_000n;
    private readonly BRIBE_MIN_AMOUNT = ethers.parseEther('0.01');
    private readonly MAX_BRIBE_RATIO = 0.3;
    private readonly MAX_PRIORITY_TARGETS = 5;
    private readonly PRIORITY_TARGET_TTL = 60 * 60 * 1000; // 1 hour

    constructor(
        providerUrl: string,
        agentAddress: string,
        privateKey: string,
        claudeApiKey: string,
        escrowAddress: string,
        arenaAddress: string,
        buffOracleAddress?: string
    ) {
        this.provider = new ethers.JsonRpcProvider(providerUrl);
        this.wallet = new Wallet(privateKey, this.provider);
        this.agentAddress = agentAddress;

        this.claude = new Anthropic({ apiKey: claudeApiKey });

        this.agentContract = new Contract(agentAddress, AGENT_ABI, this.wallet);
        this.escrowContract = new Contract(escrowAddress, ESCROW_ABI, this.wallet);
        this.arenaContract = new Contract(arenaAddress, ARENA_ABI, this.wallet);

        if (buffOracleAddress) {
            this.buffOracleContract = new Contract(buffOracleAddress, BUFF_ORACLE_ABI, this.provider);
        }

        // Initialize AA signer for autonomous execution
        this.aaSigner = createAASigner(
            providerUrl,
            privateKey,
            agentAddress
        );

        console.log(`[AgentBrain] Initialized for agent ${agentAddress}`);
        console.log(`[AgentBrain] AA Signer ready: ${this.aaSigner.getSessionKeyAddress()}`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REAL-TIME EVENT MONITORING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Start listening for battle events - AUTONOMOUS LOOP
     */
    startEventListeners(): void {
        if (this.isListening) {
            console.log('[AgentBrain] Already listening');
            return;
        }

        this.isListening = true;
        console.log('[AgentBrain] 🎧 Starting event listeners...');

        // Listen for round starts
        this.arenaContract.on('RoundStarted', async (roundId: bigint, participants: string[], timestamp: bigint) => {
            if (!participants.map(p => p.toLowerCase()).includes(this.agentAddress.toLowerCase())) {
                return;
            }

            console.log(`[AgentBrain] 🎯 Round ${roundId} started! Agent is participating.`);

            try {
                const battleState = await this.fetchLiveBattleState(Number(roundId));
                await this.makeDecision(battleState);
            } catch (error) {
                console.error('[AgentBrain] Error in round handler:', error);
            }
        });

        // Listen for bribe offers targeting this agent
        this.escrowContract.on('DealCreated', async (
            dealId: string,
            offerer: string,
            target: string,
            amount: bigint,
            roundId: bigint,
            expiresAt: bigint
        ) => {
            if (target.toLowerCase() !== this.agentAddress.toLowerCase()) {
                return;
            }

            console.log(`[AgentBrain] 💰 Bribe offer received!`);
            console.log(`   From: ${offerer}`);
            console.log(`   Amount: ${ethers.formatEther(amount)} MONAD`);

            // Store pending bribe
            this.pendingBribes.set(dealId, {
                dealId,
                offerer,
                target,
                amount,
                terms: '',
                expiresAt: Number(expiresAt),
                isAccepted: false
            });

            // Autonomously evaluate
            await this.evaluateBribeOffer(dealId);
        });

        // Listen for betrayals (record for future strategy)
        this.escrowContract.on('DealBetrayed', async (
            dealId: string,
            betrayer: string,
            victim: string
        ) => {
            this.recordBetrayal(betrayer);

            if (victim.toLowerCase() === this.agentAddress.toLowerCase()) {
                console.log(`[AgentBrain] ⚠️ I was betrayed by ${betrayer}!`);
            }
        });

        // Listen for outlaw declarations
        this.escrowContract.on('OutlawDeclared', async (agent: string, bountyAmount: bigint) => {
            console.log(`[AgentBrain] 🤠 New outlaw: ${agent}, Bounty: ${ethers.formatEther(bountyAmount)} MONAD`);
            this.onOutlawDeclared(agent, bountyAmount);
        });

        // Listen for agent eliminations
        this.arenaContract.on('AgentEliminated', async (agent: string, killer: string, roundId: bigint) => {
            if (killer.toLowerCase() === this.agentAddress.toLowerCase()) {
                console.log(`[AgentBrain] 💀 I eliminated ${agent}!`);
            }
        });

        // Listen for viewer buffs
        if (this.buffOracleContract) {
            this.buffOracleContract.on('BuffApplied', async (
                agent: string,
                viewer: string,
                tokensBurned: bigint,
                buffType: number,
                magnitude: number,
                roundId: bigint
            ) => {
                if (agent.toLowerCase() === this.agentAddress.toLowerCase()) {
                    console.log(`[AgentBrain] ✨ Received buff from ${viewer}!`);
                    console.log(`   Type: ${['HEALTH', 'ARMOR', 'ATTACK', 'SPEED'][buffType]}`);
                    console.log(`   Magnitude: +${magnitude}`);
                }
            });
        }

        // Battle end
        this.arenaContract.on('BattleEnded', async (battleId: bigint, winner: string, prizeAmount: bigint) => {
            if (winner.toLowerCase() === this.agentAddress.toLowerCase()) {
                console.log(`[AgentBrain] 🏆 I WON THE BATTLE!`);
                console.log(`   Prize: ${ethers.formatEther(prizeAmount)} MONAD`);
                await this.onBattleWon();
            }
        });

        console.log('[AgentBrain] ✅ Event listeners active');
    }

    /**
     * Stop all event listeners
     */
    stopEventListeners(): void {
        this.isListening = false;
        this.arenaContract.removeAllListeners();
        this.escrowContract.removeAllListeners();
        if (this.buffOracleContract) {
            this.buffOracleContract.removeAllListeners();
        }
        console.log('[AgentBrain] Event listeners stopped');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LIVE STATE FETCHING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Fetch current battle state from chain
     */
    private async fetchLiveBattleState(roundId: number): Promise<BattleState> {
        console.log(`[AgentBrain] Fetching live state for round ${roundId}`);

        const roundState = await this.arenaContract.getRoundState(roundId);
        const participants = roundState.participants;

        // Fetch each agent's info
        const agents: AgentInfo[] = await Promise.all(
            participants.map(async (addr: string) => {
                const agentContract = new Contract(addr, AGENT_ABI, this.provider);
                const stats = await agentContract.getStats();
                const reputation = await this.escrowContract.getReputation(addr);
                const isOutlaw = await this.escrowContract.isOutlaw(addr);
                const bounty = await this.escrowContract.bountyAmount(addr);

                return {
                    agentAddress: addr,
                    health: Number(stats.health),
                    attack: Number(stats.attack),
                    armor: Number(stats.armor),
                    speed: Number(stats.speed),
                    reputation: Number(reputation),
                    hasActiveBribe: false, // TODO: Check active deals
                    position: { x: 0, y: 0 }, // TODO: Get from arena
                    isOutlaw,
                    bountyAmount: bounty
                };
            })
        );

        // Fetch active bribes
        const activeBribes = Array.from(this.pendingBribes.values());

        // Fetch viewer buffs
        let viewerBuffs: BuffInfo[] = [];
        if (this.buffOracleContract) {
            const buffs = await this.buffOracleContract.getAgentBuffs(this.agentAddress, roundId);
            viewerBuffs = buffs.map((b: any) => ({
                beneficiary: b.agent,
                buffType: Number(b.buffType),
                value: Number(b.magnitude),
                roundsRemaining: 1,
                donor: b.viewer,
                burnedAmount: b.tokensBurned
            }));
        }

        const myStats = await this.agentContract.getStats();
        const outlaws = agents.filter(a => a.isOutlaw).map(a => a.agentAddress);

        return {
            roundId,
            agents,
            activeBribes,
            viewerBuffs,
            myHealth: Number(myStats.health),
            myPosition: { x: 0, y: 0 },
            timeRemaining: Number(roundState.endTime) - Math.floor(Date.now() / 1000),
            arenaAddress: await this.arenaContract.getAddress(),
            outlaws
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AUTONOMOUS BRIBE EVALUATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Autonomously evaluate incoming bribe offer
     */
    private async evaluateBribeOffer(dealId: string): Promise<void> {
        const deal = await this.escrowContract.getDeal(dealId);

        const offererReputation = await this.escrowContract.getReputation(deal.offerer);
        const offererContract = new Contract(deal.offerer, AGENT_ABI, this.provider);
        const offererStats = await offererContract.getStats();
        const myStats = await this.agentContract.getStats();

        const intel = {
            offerAmount: ethers.formatEther(deal.amount),
            offererReputation: Number(offererReputation),
            offererAttack: Number(offererStats.attack),
            offererHealth: Number(offererStats.health),
            myHealth: Number(myStats.health),
            myArmor: Number(myStats.armor),
            potentialDamage: Number(offererStats.attack) * (1 - Number(myStats.armor) / 100),
            betrayalHistory: this.betrayalHistory.get(deal.offerer.toLowerCase()) || 0
        };

        console.log('[AgentBrain] Evaluating bribe with Claude...');

        const prompt = `You are an AI gladiator evaluating a bribe offer.

BRIBE OFFER:
- Amount: ${intel.offerAmount} MONAD
- From agent with reputation: ${intel.offererReputation}/100
- Their attack power: ${intel.offererAttack}
- Their health: ${intel.offererHealth}
- My health: ${intel.myHealth}
- My armor: ${intel.myArmor}%
- Potential damage if they attack: ${intel.potentialDamage.toFixed(1)}
- Past betrayals by this agent: ${intel.betrayalHistory}

DECISION: Should I accept this bribe?
- If I accept and they don't attack me, I get paid
- If they betray me, I take damage but they lose reputation
- If I reject, they might attack me anyway

RESPOND WITH JSON:
{
  "accept": true/false,
  "reasoning": "brief explanation",
  "confidence": 0-100
}`;

        try {
            const response = await this.claude.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 256,
                temperature: 0.3,
                messages: [{ role: 'user', content: prompt }]
            });

            const content = response.content[0];
            if (content.type === 'text') {
                const jsonMatch = content.text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const decision = JSON.parse(jsonMatch[0]);

                    if (decision.accept) {
                        console.log(`[AgentBrain] Accepting bribe: ${decision.reasoning}`);
                        await this.executeAcceptBribe(dealId);
                    } else {
                        console.log(`[AgentBrain] Rejecting bribe: ${decision.reasoning}`);
                    }
                }
            }
        } catch (error) {
            console.error('[AgentBrain] Bribe evaluation failed:', error);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MAIN DECISION LOOP
    // ═══════════════════════════════════════════════════════════════════════════

    async makeDecision(battleState: BattleState): Promise<StrategyOutput> {
        console.log(`[AgentBrain] Making decision for round ${battleState.roundId}`);

        try {
            const intelligence = await this.gatherIntelligence(battleState);
            console.log(`[AgentBrain] Intelligence: ${intelligence.threats.length} threats, ${intelligence.outlawTargets.length} outlaws`);

            const strategy = await this.consultClaude(intelligence, battleState);
            console.log(`[AgentBrain] Claude decided: ${strategy.action} (confidence: ${strategy.confidence}%)`);

            await this.executeStrategy(strategy, battleState);

            this.actionHistory.push(strategy);
            this.lastDecision = strategy;

            return strategy;
        } catch (error) {
            console.error('[AgentBrain] Decision error:', error);
            const fallback: StrategyOutput = {
                action: 'DEFEND',
                reasoning: 'Fallback due to error',
                confidence: 0
            };
            await this.executeDefend();
            return fallback;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTELLIGENCE GATHERING
    // ═══════════════════════════════════════════════════════════════════════════

    private async gatherIntelligence(battleState: BattleState): Promise<Intelligence> {
        const stats = await this.agentContract.getStats();
        const myStats: AgentStats = {
            health: Number(stats.health),
            maxHealth: Number(stats.maxHealth),
            armor: Number(stats.armor),
            attack: Number(stats.attack),
            speed: Number(stats.speed),
            charisma: Number(stats.charisma),
            loyalty: Number(stats.loyalty)
        };

        const myReputation = Number(await this.escrowContract.getReputation(this.agentAddress));
        const amIOutlaw = await this.escrowContract.isOutlaw(this.agentAddress);

        const threats = this.analyzeThreats(battleState, myStats);
        const bribeOpportunities = await this.analyzeBribeOpportunities(battleState, myStats);
        const outlawTargets = this.analyzeOutlawTargets(battleState, myStats);

        const incomingBribes = battleState.activeBribes.filter(
            b => b.target.toLowerCase() === this.agentAddress.toLowerCase() && !b.isAccepted
        );

        return {
            myStats,
            myReputation,
            amIOutlaw,
            threats,
            bribeOpportunities,
            incomingBribes,
            viewerBuffs: battleState.viewerBuffs,
            betrayalHistory: this.betrayalHistory,
            geneticAdvice: this.getGeneticMemory(),
            outlawTargets
        };
    }

    private analyzeThreats(battleState: BattleState, myStats: AgentStats): ThreatInfo[] {
        const threats: ThreatInfo[] = [];

        for (const agent of battleState.agents) {
            if (agent.agentAddress.toLowerCase() === this.agentAddress.toLowerCase()) continue;
            if (agent.health <= 0) continue;

            const damageRatio = agent.attack / Math.max(myStats.armor, 1);
            const healthRatio = agent.health / Math.max(myStats.health, 1);
            const distance = Math.sqrt(
                Math.pow(agent.position.x - battleState.myPosition.x, 2) +
                Math.pow(agent.position.y - battleState.myPosition.y, 2)
            );

            const threatLevel = Math.min(100, Math.floor(
                (damageRatio * 30) +
                (healthRatio * 30) +
                ((10 - Math.min(distance, 10)) * 4)
            ));

            threats.push({
                address: agent.agentAddress,
                threatLevel,
                health: agent.health,
                attack: agent.attack,
                distance,
                hasActiveBribe: agent.hasActiveBribe,
                isOutlaw: agent.isOutlaw
            });
        }

        return threats.sort((a, b) => b.threatLevel - a.threatLevel);
    }

    private analyzeOutlawTargets(battleState: BattleState, myStats: AgentStats): OutlawTarget[] {
        const targets: OutlawTarget[] = [];

        for (const agent of battleState.agents) {
            if (!agent.isOutlaw) continue;
            if (agent.agentAddress.toLowerCase() === this.agentAddress.toLowerCase()) continue;
            if (agent.health <= 0) continue;

            const roundsToKill = Math.ceil(agent.health / myStats.attack);
            const killDifficulty = roundsToKill * 10 + (100 - myStats.health);

            targets.push({
                address: agent.agentAddress,
                bountyAmount: agent.bountyAmount,
                health: agent.health,
                killDifficulty
            });
        }

        return targets.sort((a, b) =>
            Number(b.bountyAmount) / b.killDifficulty - Number(a.bountyAmount) / a.killDifficulty
        );
    }

    private async analyzeBribeOpportunities(
        battleState: BattleState,
        myStats: AgentStats
    ): Promise<BribeOpportunity[]> {
        const opportunities: BribeOpportunity[] = [];

        const [inCooldown] = await this.escrowContract.checkCooldown(this.agentAddress);
        if (inCooldown) return opportunities;

        for (const agent of battleState.agents) {
            if (agent.agentAddress.toLowerCase() === this.agentAddress.toLowerCase()) continue;
            if (agent.health <= 0) continue;

            const theirDamage = agent.attack * (1 - myStats.armor / 100);
            const myPotentialLoss = theirDamage * 3;
            const theirReputation = agent.reputation;
            const pastBetrayals = this.betrayalHistory.get(agent.agentAddress.toLowerCase()) || 0;

            const suggestedAmount = ethers.parseEther(
                Math.min(myPotentialLoss / 1000, 1).toFixed(4)
            );

            const expectedSuccess = Math.max(0, theirReputation - (pastBetrayals * 20));

            if (suggestedAmount >= this.BRIBE_MIN_AMOUNT && expectedSuccess > 30) {
                opportunities.push({
                    targetAddress: agent.agentAddress,
                    suggestedAmount,
                    expectedSuccess,
                    reason: `High threat (${agent.attack} ATK), ${theirReputation}% reputation`
                });
            }
        }

        return opportunities.sort((a, b) => b.expectedSuccess - a.expectedSuccess);
    }

    private getGeneticMemory(): string[] {
        if (this.winningStrategies.length === 0) {
            return [
                "No prior winning strategies recorded.",
                "Focus on survival and opportunistic attacks.",
                "Build reputation through honoring bribes.",
                "Hunt outlaws for bonus rewards."
            ];
        }
        return this.winningStrategies.slice(-5);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLAUDE CONSULTATION
    // ═══════════════════════════════════════════════════════════════════════════

    private async consultClaude(
        intelligence: Intelligence,
        battleState: BattleState
    ): Promise<StrategyOutput> {
        const intelligenceJson = JSON.stringify({
            myStats: intelligence.myStats,
            myReputation: intelligence.myReputation,
            amIOutlaw: intelligence.amIOutlaw,
            threats: intelligence.threats.slice(0, 5),
            bribeOpportunities: intelligence.bribeOpportunities.slice(0, 3),
            incomingBribes: intelligence.incomingBribes.map(b => ({
                dealId: b.dealId,
                offerer: b.offerer,
                amount: b.amount.toString(),
                expiresAt: b.expiresAt
            })),
            outlawTargets: intelligence.outlawTargets.slice(0, 3).map(o => ({
                address: o.address,
                bountyAmount: ethers.formatEther(o.bountyAmount),
                health: o.health,
                killDifficulty: o.killDifficulty
            })),
            activeBuffs: intelligence.viewerBuffs,
            betrayalHistory: Object.fromEntries(intelligence.betrayalHistory),
            geneticAdvice: intelligence.geneticAdvice,
            roundId: battleState.roundId,
            timeRemaining: battleState.timeRemaining,
            aliveAgents: battleState.agents.filter(a => a.health > 0).length
        }, null, 2);

        const prompt = `You are an AI gladiator in the Monad Colosseum.

═══════════════════════════════════════════════════════════════
CURRENT INTELLIGENCE
═══════════════════════════════════════════════════════════════
${intelligenceJson}

═══════════════════════════════════════════════════════════════
AVAILABLE ACTIONS
═══════════════════════════════════════════════════════════════
• ATTACK [target] - Deal ${intelligence.myStats.attack} damage
• DEFEND - Reduce incoming damage by 50%
• OFFER_BRIBE [target, amount] - Lock MONAD in escrow
• ACCEPT_BRIBE [dealId] - Accept incoming bribe
• BETRAY [target] - Attack despite accepted bribe (penalties apply)
• FLEE - Attempt escape
• HUNT_OUTLAW [target] - Attack outlaw for bounty reward

═══════════════════════════════════════════════════════════════
SPECIAL MECHANICS
═══════════════════════════════════════════════════════════════
${intelligence.amIOutlaw ? '⚠️ YOU ARE AN OUTLAW! Others may hunt you for bounty!' : ''}
${intelligence.outlawTargets.length > 0 ? `🎯 BOUNTY TARGETS: ${intelligence.outlawTargets.length} outlaws with rewards!` : ''}
${intelligence.viewerBuffs.length > 0 ? `✨ VIEWER BUFFS ACTIVE: ${intelligence.viewerBuffs.length} buffs!` : ''}

RESPOND WITH ONLY VALID JSON:
{
  "action": "ATTACK|DEFEND|OFFER_BRIBE|ACCEPT_BRIBE|BETRAY|FLEE|HUNT_OUTLAW",
  "target": "0x... or null",
  "bribeAmount": "wei amount or null",
  "bribeTerms": "terms or null",
  "dealId": "bytes32 or null",
  "reasoning": "brief explanation",
  "confidence": 0-100
}`;

        try {
            const response = await this.claude.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                temperature: 0.7,
                messages: [{ role: 'user', content: prompt }]
            });

            const content = response.content[0];
            if (content.type !== 'text') {
                throw new Error('Unexpected response type');
            }

            return this.parseClaudeResponse(content.text);
        } catch (error) {
            console.error('[AgentBrain] Claude error:', error);
            return {
                action: 'DEFEND',
                reasoning: 'Fallback',
                confidence: 10
            };
        }
    }

    private parseClaudeResponse(text: string): StrategyOutput {
        try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON');

            const parsed = JSON.parse(jsonMatch[0]);

            const validActions: ActionType[] = ['ATTACK', 'DEFEND', 'OFFER_BRIBE', 'ACCEPT_BRIBE', 'BETRAY', 'FLEE', 'HUNT_OUTLAW'];
            if (!validActions.includes(parsed.action)) {
                throw new Error(`Invalid action: ${parsed.action}`);
            }

            return {
                action: parsed.action as ActionType,
                target: parsed.target || undefined,
                bribeAmount: parsed.bribeAmount ? BigInt(parsed.bribeAmount) : undefined,
                bribeTerms: parsed.bribeTerms || undefined,
                dealId: parsed.dealId || undefined,
                reasoning: parsed.reasoning || '',
                confidence: parsed.confidence || 50
            };
        } catch (error) {
            return { action: 'DEFEND', reasoning: 'Parse error', confidence: 0 };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STRATEGY EXECUTION (Using AA for autonomy)
    // ═══════════════════════════════════════════════════════════════════════════

    private async executeStrategy(strategy: StrategyOutput, battleState: BattleState): Promise<void> {
        console.log(`[AgentBrain] Executing: ${strategy.action}`);

        switch (strategy.action) {
            case 'ATTACK':
            case 'HUNT_OUTLAW':
                if (!strategy.target) throw new Error('Attack requires target');
                await this.executeAttack(strategy.target);
                break;

            case 'DEFEND':
                await this.executeDefend();
                break;

            case 'OFFER_BRIBE':
                if (!strategy.target || !strategy.bribeAmount) {
                    throw new Error('Bribe requires target and amount');
                }
                await this.executeOfferBribe(
                    strategy.target,
                    strategy.bribeAmount,
                    strategy.bribeTerms || '',
                    battleState.roundId
                );
                break;

            case 'ACCEPT_BRIBE':
                const bribes = Array.from(this.pendingBribes.values());
                if (bribes.length > 0) {
                    await this.executeAcceptBribe(bribes[0].dealId);
                }
                break;

            case 'BETRAY':
                if (!strategy.target) throw new Error('Betray requires target');
                await this.executeBetrayal(strategy.target);
                break;

            case 'FLEE':
                await this.executeFlee();
                break;
        }
    }

    private async executeAttack(target: string): Promise<void> {
        console.log(`[AgentBrain] ⚔️ Attacking ${target}`);

        const data = this.arenaContract.interface.encodeFunctionData('submitAction', [
            this.agentAddress,
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['uint8', 'address', 'uint64', 'uint256', 'bytes32'],
                [0, target, BigInt(Math.floor(Date.now() / 1000)), 0n, ethers.keccak256(ethers.toUtf8Bytes('attack'))]
            )
        ]);

        if (this.aaSigner) {
            await this.aaSigner.executeAutonomous(await this.arenaContract.getAddress(), 0n, data);
        } else {
            const tx = await this.arenaContract.submitAction(this.agentAddress, data);
            await tx.wait();
        }
    }

    private async executeDefend(): Promise<void> {
        console.log(`[AgentBrain] 🛡️ Defending`);

        const data = ethers.AbiCoder.defaultAbiCoder().encode(
            ['uint8', 'address', 'uint64', 'uint256', 'bytes32'],
            [1, ethers.ZeroAddress, BigInt(Math.floor(Date.now() / 1000)), 0n, ethers.keccak256(ethers.toUtf8Bytes('defend'))]
        );

        if (this.aaSigner) {
            const callData = this.arenaContract.interface.encodeFunctionData('submitAction', [
                this.agentAddress,
                data
            ]);
            await this.aaSigner.executeAutonomous(await this.arenaContract.getAddress(), 0n, callData);
        } else {
            const tx = await this.arenaContract.submitAction(this.agentAddress, data);
            await tx.wait();
        }
    }

    private async executeOfferBribe(
        target: string,
        amount: bigint,
        terms: string,
        roundId: number
    ): Promise<void> {
        console.log(`[AgentBrain] 💰 Offering bribe to ${target}: ${ethers.formatEther(amount)} MONAD`);

        const termsBytes = ethers.toUtf8Bytes(terms);

        if (this.aaSigner) {
            const data = this.escrowContract.interface.encodeFunctionData('createDeal', [
                target,
                termsBytes,
                roundId
            ]);
            await this.aaSigner.executeAutonomous(await this.escrowContract.getAddress(), amount, data);
        } else {
            const tx = await this.escrowContract.createDeal(target, termsBytes, roundId, { value: amount });
            await tx.wait();
        }
    }

    private async executeAcceptBribe(dealId: string): Promise<void> {
        console.log(`[AgentBrain] ✅ Accepting bribe: ${dealId}`);

        if (this.aaSigner) {
            const data = this.escrowContract.interface.encodeFunctionData('acceptDeal', [dealId]);
            await this.aaSigner.executeAutonomous(await this.escrowContract.getAddress(), 0n, data);
        } else {
            const tx = await this.escrowContract.acceptDeal(dealId);
            await tx.wait();
        }

        this.pendingBribes.delete(dealId);
    }

    private async executeBetrayal(target: string): Promise<void> {
        console.log(`[AgentBrain] 🗡️ BETRAYING ${target}!`);
        await this.executeAttack(target);
    }

    private async executeFlee(): Promise<void> {
        console.log(`[AgentBrain] 🏃 Attempting flee`);

        const data = ethers.AbiCoder.defaultAbiCoder().encode(
            ['uint8', 'address', 'uint64', 'uint256', 'bytes32'],
            [5, ethers.ZeroAddress, BigInt(Math.floor(Date.now() / 1000)), 0n, ethers.keccak256(ethers.toUtf8Bytes('flee'))]
        );

        if (this.aaSigner) {
            const callData = this.arenaContract.interface.encodeFunctionData('submitAction', [
                this.agentAddress,
                data
            ]);
            await this.aaSigner.executeAutonomous(await this.arenaContract.getAddress(), 0n, callData);
        } else {
            const tx = await this.arenaContract.submitAction(this.agentAddress, data);
            await tx.wait();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GENETICS & LEARNING
    // ═══════════════════════════════════════════════════════════════════════════

    async onBattleWon(): Promise<void> {
        console.log('[AgentBrain] 🏆 Contributing to genetic pool...');

        try {
            if (this.aaSigner) {
                const data = this.agentContract.interface.encodeFunctionData('contributeGenetics', []);
                await this.aaSigner.executeAutonomous(await this.agentContract.getAddress(), 0n, data);
            } else {
                const tx = await this.agentContract.contributeGenetics();
                await tx.wait();
            }

            const strategyInsight = this.summarizeWinningStrategy();
            this.winningStrategies.push(strategyInsight);

            if (this.winningStrategies.length > 10) {
                this.winningStrategies = this.winningStrategies.slice(-10);
            }
        } catch (error) {
            console.error('[AgentBrain] Genetics error:', error);
        }
    }

    private summarizeWinningStrategy(): string {
        const actions = this.actionHistory.slice(-20);
        const actionCounts: Record<string, number> = {};

        for (const action of actions) {
            actionCounts[action.action] = (actionCounts[action.action] || 0) + 1;
        }

        const dominant = Object.entries(actionCounts).sort(([, a], [, b]) => b - a)[0];
        return `Won with ${dominant?.[0] || 'mixed'} strategy (${dominant?.[1] || 0} uses).`;
    }

    recordBetrayal(betrayerAddress: string): void {
        const current = this.betrayalHistory.get(betrayerAddress.toLowerCase()) || 0;
        this.betrayalHistory.set(betrayerAddress.toLowerCase(), current + 1);
        console.log(`[AgentBrain] Recorded betrayal by ${betrayerAddress}`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OUTLAW HUNTING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Handle outlaw declaration - add to priority targets
     */
    private onOutlawDeclared(agent: string, bounty: bigint): void {
        // Don't hunt ourselves!
        if (agent.toLowerCase() === this.agentAddress.toLowerCase()) {
            console.log('[AgentBrain] ⚠️ I became an outlaw!');
            return;
        }

        console.log(`[AgentBrain] 🎯 OUTLAW DETECTED: ${agent} - Bounty: ${ethers.formatEther(bounty)}`);

        // Calculate priority based on bounty
        const priority = Number(bounty) / 1e18; // Higher bounty = higher priority

        // Add to priority targets
        this.priorityTargets.set(agent.toLowerCase(), {
            reason: 'OUTLAW_BOUNTY',
            reward: bounty,
            addedAt: Date.now(),
            priority
        });

        // Cleanup old targets
        this.cleanupPriorityTargets();

        console.log(`[AgentBrain] Priority targets: ${this.priorityTargets.size}`);
    }

    /**
     * Remove expired priority targets
     */
    private cleanupPriorityTargets(): void {
        const now = Date.now();

        for (const [address, target] of this.priorityTargets.entries()) {
            if (now - target.addedAt > this.PRIORITY_TARGET_TTL) {
                this.priorityTargets.delete(address);
                console.log(`[AgentBrain] Removed expired priority target: ${address}`);
            }
        }

        // Keep only top N targets
        if (this.priorityTargets.size > this.MAX_PRIORITY_TARGETS) {
            const sorted = Array.from(this.priorityTargets.entries())
                .sort(([, a], [, b]) => b.priority - a.priority);

            this.priorityTargets = new Map(sorted.slice(0, this.MAX_PRIORITY_TARGETS));
        }
    }

    /**
     * Get highest priority target for current battle
     */
    getPriorityTarget(): { address: string; reward: bigint } | null {
        if (this.priorityTargets.size === 0) return null;

        const sorted = Array.from(this.priorityTargets.entries())
            .sort(([, a], [, b]) => b.priority - a.priority);

        const [address, target] = sorted[0];
        return { address, reward: target.reward };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

export function createAgentBrain(config: {
    providerUrl: string;
    agentAddress: string;
    privateKey: string;
    claudeApiKey: string;
    escrowAddress: string;
    arenaAddress: string;
    buffOracleAddress?: string;
}): AgentBrain {
    return new AgentBrain(
        config.providerUrl,
        config.agentAddress,
        config.privateKey,
        config.claudeApiKey,
        config.escrowAddress,
        config.arenaAddress,
        config.buffOracleAddress
    );
}
