// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IAgent.sol";
import "./BuffOracle.sol";
import "./BribeEscrow.sol";
import "./interfaces/IBattleNarrator.sol";

/**
 * @title Arena
 * @author Monad Colosseum Team
 * @notice Context-aware combat system with deterministic game theory logic
 * @dev Synced to Monad's 2-second block finality
 *
 * Key Features:
 * - Buff integration from BuffOracle
 * - Betrayal detection during combat
 * - Reputation-based damage modifiers
 * - BattleNarrator event recording
 * - Monad 2s block sync
 */
contract Arena is AccessControl, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════════════════

    bytes32 public constant GAME_MASTER_ROLE = keccak256("GAME_MASTER_ROLE");

    // ═══════════════════════════════════════════════════════════════════════════
    // ENUMS
    // ═══════════════════════════════════════════════════════════════════════════

    enum RoundStatus {
        PENDING,        // 0 - Waiting to start
        ACCEPTING,      // 1 - Accepting participant registrations
        IN_PROGRESS,    // 2 - Combat active
        COMPLETED,      // 3 - Round finished
        CANCELLED       // 4 - Round cancelled
    }

    enum ActionType {
        ATTACK,     // 0
        DEFEND,     // 1
        FLEE,       // 2
        BRIBE,      // 3
        NONE        // 4
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════

    struct Round {
        uint256 id;
        address[] participants;
        uint256 startTime;
        uint256 endTime;
        uint256 prizePool;
        address winner;
        RoundStatus status;
    }

    struct BattleAction {
        ActionType actionType;
        address target;
        uint64 timestamp;
        uint256 value;
        bytes32 strategyHash;
    }

    struct TempStats {
        uint16 health;
        uint16 maxHealth;
        uint16 armor;
        uint16 attack;
        uint16 speed;
        uint16 charisma;
        bool isAlive;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Monad block time in seconds
    uint256 public constant MONAD_BLOCK_TIME = 2;

    /// @notice Round duration (10 blocks = 20 seconds)
    uint256 public constant ROUND_DURATION = 10 * MONAD_BLOCK_TIME;

    /// @notice Action submission window (5 blocks = 10 seconds)
    uint256 public constant ACTION_WINDOW = 5 * MONAD_BLOCK_TIME;

    /// @notice Minimum participants per round
    uint256 public constant MIN_PARTICIPANTS = 2;

    /// @notice Maximum participants per round
    uint256 public constant MAX_PARTICIPANTS = 8;

    /// @notice Outlaw reputation threshold
    uint256 public constant OUTLAW_THRESHOLD = 20;

    /// @notice Defend damage reduction (50%)
    uint256 public constant DEFEND_REDUCTION = 50;

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice All rounds by ID
    mapping(uint256 => Round) public rounds;

    /// @notice Pending actions: agent => roundId => action
    mapping(address => mapping(uint256 => BattleAction)) public pendingActions;

    /// @notice Temporary stats during combat resolution
    mapping(address => TempStats) public tempStats;

    /// @notice Is agent defending this round
    mapping(address => mapping(uint256 => bool)) public isDefending;

    /// @notice Current round ID
    uint256 public currentRoundId;

    /// @notice Total rounds completed
    uint256 public totalRoundsCompleted;

    /// @notice External contracts
    BuffOracle public buffOracle;
    BribeEscrow public escrow;
    IBattleNarrator public narrator;
    address public revenueDistributor;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event RoundCreated(
        uint256 indexed roundId,
        uint256 prizePool,
        uint256 startTime
    );

    event RoundStarted(
        uint256 indexed roundId,
        address[] participants,
        uint256 timestamp
    );

    event ActionSubmitted(
        uint256 indexed roundId,
        address indexed agent,
        ActionType actionType,
        address target
    );

    event DamageDealt(
        uint256 indexed roundId,
        address indexed attacker,
        address indexed target,
        uint256 damage,
        uint256 remainingHealth
    );

    event AgentEliminated(
        address indexed agent,
        address indexed killer,
        uint256 indexed roundId
    );

    event RoundCompleted(
        uint256 indexed roundId,
        address indexed winner,
        uint256 prizeAmount
    );

    event BetrayalDetected(
        uint256 indexed roundId,
        address indexed betrayer,
        address indexed victim,
        bytes32 dealId
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════

    error RoundNotActive(uint256 roundId);
    error RoundNotAccepting(uint256 roundId);
    error ActionWindowClosed();
    error InvalidTarget(address target);
    error AgentNotParticipant(address agent);
    error AgentAlreadyActed(address agent);
    error TooFewParticipants();
    error TooManyParticipants();
    error InvalidRoundStatus(RoundStatus current, RoundStatus required);

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    constructor(
        address admin,
        address gameMaster,
        address _buffOracle,
        address _escrow,
        address _narrator,
        address _revenueDistributor
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GAME_MASTER_ROLE, gameMaster);

        buffOracle = BuffOracle(_buffOracle);
        escrow = BribeEscrow(payable(_escrow));
        narrator = IBattleNarrator(_narrator);
        revenueDistributor = _revenueDistributor;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ROUND MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a new round
     * @param participants Initial participant addresses
     */
    function createRound(address[] calldata participants) 
        external 
        payable 
        onlyRole(GAME_MASTER_ROLE) 
        returns (uint256 roundId) 
    {
        if (participants.length < MIN_PARTICIPANTS) revert TooFewParticipants();
        if (participants.length > MAX_PARTICIPANTS) revert TooManyParticipants();

        roundId = ++currentRoundId;

        rounds[roundId] = Round({
            id: roundId,
            participants: participants,
            startTime: 0,
            endTime: 0,
            prizePool: msg.value,
            winner: address(0),
            status: RoundStatus.ACCEPTING
        });

        emit RoundCreated(roundId, msg.value, block.timestamp);
    }

    /**
     * @notice Start a round - synced to Monad block time
     * @param roundId Round to start
     */
    function startRound(uint256 roundId) 
        external 
        onlyRole(GAME_MASTER_ROLE) 
    {
        Round storage round = rounds[roundId];
        if (round.status != RoundStatus.ACCEPTING) {
            revert InvalidRoundStatus(round.status, RoundStatus.ACCEPTING);
        }

        round.status = RoundStatus.IN_PROGRESS;
        round.startTime = block.timestamp;
        round.endTime = block.timestamp + ROUND_DURATION;

        // Initialize temp stats for all participants
        for (uint256 i = 0; i < round.participants.length; i++) {
            address agent = round.participants[i];
            _initializeTempStats(agent, roundId);
        }

        emit RoundStarted(roundId, round.participants, block.timestamp);
    }

    /**
     * @notice Submit an action for the current round
     * @param roundId Round ID
     * @param actionType Type of action
     * @param target Target address (for ATTACK)
     */
    function submitAction(
        uint256 roundId,
        ActionType actionType,
        address target
    ) external nonReentrant {
        Round storage round = rounds[roundId];
        
        if (round.status != RoundStatus.IN_PROGRESS) {
            revert RoundNotActive(roundId);
        }
        
        if (block.timestamp > round.startTime + ACTION_WINDOW) {
            revert ActionWindowClosed();
        }

        if (!_isParticipant(roundId, msg.sender)) {
            revert AgentNotParticipant(msg.sender);
        }

        if (pendingActions[msg.sender][roundId].timestamp != 0) {
            revert AgentAlreadyActed(msg.sender);
        }

        // Validate target for attack
        if (actionType == ActionType.ATTACK) {
            if (target == address(0) || target == msg.sender) {
                revert InvalidTarget(target);
            }
            if (!_isParticipant(roundId, target)) {
                revert InvalidTarget(target);
            }
        }

        // Record action
        pendingActions[msg.sender][roundId] = BattleAction({
            actionType: actionType,
            target: target,
            timestamp: uint64(block.timestamp),
            value: 0,
            strategyHash: keccak256(abi.encodePacked(actionType, target, roundId))
        });

        // Mark defending agents
        if (actionType == ActionType.DEFEND) {
            isDefending[msg.sender][roundId] = true;
        }

        emit ActionSubmitted(roundId, msg.sender, actionType, target);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // COMBAT RESOLUTION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Resolve combat for a round
     * @dev Only callable after action window closes
     * @param roundId Round to resolve
     */
    function resolveCombatRound(uint256 roundId) 
        external 
        onlyRole(GAME_MASTER_ROLE) 
        nonReentrant 
    {
        Round storage round = rounds[roundId];
        
        if (round.status != RoundStatus.IN_PROGRESS) {
            revert RoundNotActive(roundId);
        }

        // 1. Fetch and apply buffs from BuffOracle
        _applyBuffs(roundId, round.participants);

        // 2. Process all agent actions simultaneously
        _processActions(roundId, round.participants);

        // 3. Check for betrayals
        _detectBetrayals(roundId, round.participants);

        // 4. Determine outcome
        address[] memory survivors = _getSurvivors(roundId, round.participants);

        if (survivors.length <= 1) {
            // Round complete
            _completeRound(roundId, survivors.length == 1 ? survivors[0] : address(0));
        } else if (block.timestamp >= round.endTime) {
            // Timeout - highest health wins
            address winner = _getHighestHealth(survivors);
            _completeRound(roundId, winner);
        }
        // Otherwise: Next combat phase continues
    }

    /**
     * @notice Initialize temporary stats for an agent
     */
    function _initializeTempStats(address agent, uint256 roundId) internal {
        try IAgent(agent).getStats() returns (IAgent.AgentStats memory stats) {
            tempStats[agent] = TempStats({
                health: stats.health,
                maxHealth: stats.maxHealth,
                armor: stats.armor,
                attack: stats.attack,
                speed: stats.speed,
                charisma: stats.charisma,
                isAlive: true
            });
        } catch {
            // Default stats if agent doesn't implement interface
            tempStats[agent] = TempStats({
                health: 100,
                maxHealth: 100,
                armor: 20,
                attack: 30,
                speed: 50,
                charisma: 50,
                isAlive: true
            });
        }
    }

    /**
     * @notice Apply buffs from BuffOracle to temp stats
     */
    function _applyBuffs(uint256 roundId, address[] memory participants) internal {
        for (uint256 i = 0; i < participants.length; i++) {
            address agent = participants[i];
            
            try buffOracle.getAggregatedBuffs(agent, roundId) returns (
                uint16 healthBuff,
                uint16 armorBuff,
                uint16 attackBuff,
                uint16 speedBuff
            ) {
                TempStats storage stats = tempStats[agent];
                stats.health += healthBuff;
                stats.maxHealth += healthBuff;
                stats.armor += armorBuff;
                stats.attack += attackBuff;
                stats.speed += speedBuff;

                // Record buff in narrator
                if (healthBuff + armorBuff + attackBuff + speedBuff > 0) {
                    try narrator.recordBuffReceived(
                        agent,
                        address(0), // Aggregated, no specific viewer
                        healthBuff + armorBuff + attackBuff + speedBuff,
                        roundId
                    ) {} catch {}
                }
            } catch {}
        }
    }

    /**
     * @notice Process all submitted actions
     */
    function _processActions(uint256 roundId, address[] memory participants) internal {
        // Sort by speed for action priority
        address[] memory sortedAgents = _sortBySpeed(participants);

        for (uint256 i = 0; i < sortedAgents.length; i++) {
            address agent = sortedAgents[i];
            
            if (!tempStats[agent].isAlive) continue;

            BattleAction memory action = pendingActions[agent][roundId];
            
            if (action.actionType == ActionType.ATTACK && action.target != address(0)) {
                _executeAttack(agent, action.target, roundId);
            }
            // DEFEND is passive - handled in damage calculation
            // FLEE - not implemented in this version
        }
    }

    /**
     * @notice Execute an attack
     */
    function _executeAttack(address attacker, address target, uint256 roundId) internal {
        if (!tempStats[target].isAlive) return;

        // Calculate damage
        uint256 damage = _calculateDamage(attacker, target, roundId);

        // Apply defend reduction
        if (isDefending[target][roundId]) {
            damage = (damage * (100 - DEFEND_REDUCTION)) / 100;
        }

        // Apply damage
        TempStats storage targetStats = tempStats[target];
        
        if (targetStats.armor >= damage) {
            targetStats.armor -= uint16(damage);
            emit DamageDealt(roundId, attacker, target, damage, targetStats.health);
        } else {
            uint256 remainingDamage = damage - targetStats.armor;
            targetStats.armor = 0;
            
            if (targetStats.health > remainingDamage) {
                targetStats.health -= uint16(remainingDamage);
                emit DamageDealt(roundId, attacker, target, damage, targetStats.health);
            } else {
                // Agent eliminated!
                targetStats.health = 0;
                targetStats.isAlive = false;
                
                emit AgentEliminated(target, attacker, roundId);
                emit DamageDealt(roundId, attacker, target, damage, 0);

                // Record death in narrator
                try narrator.recordDeath(target, attacker, roundId) {} catch {}

                // Check if attacker killed an outlaw
                try escrow.isOutlaw(target) returns (bool isTargetOutlaw) {
                    if (isTargetOutlaw) {
                        // Award bounty!
                        try escrow.claimBounty(attacker, target) {} catch {}
                    }
                } catch {}
            }
        }
    }

    /**
     * @notice Calculate damage with context-aware modifiers
     */
    function _calculateDamage(
        address attacker, 
        address target, 
        uint256 /* roundId */
    ) internal view returns (uint256) {
        TempStats memory attackerStats = tempStats[attacker];
        TempStats memory targetStats = tempStats[target];
        
        // Base damage from attack stat
        uint256 baseDamage = attackerStats.attack;
        
        // Charisma modifier (intimidation bonus: +0-50% based on charisma)
        uint256 charismaBonus = (uint256(attackerStats.charisma) * baseDamage) / 200;
        
        // Reputation modifier (outlaws deal 30% less damage)
        try escrow.getReputation(attacker) returns (uint256 attackerRep) {
            if (attackerRep < OUTLAW_THRESHOLD) {
                baseDamage = (baseDamage * 70) / 100;
            }
        } catch {}
        
        // Speed advantage (faster attacker deals +0-20% more damage)
        if (attackerStats.speed > targetStats.speed) {
            uint256 speedDiff = attackerStats.speed - targetStats.speed;
            uint256 speedBonus = (speedDiff * baseDamage) / 500; // Max ~20% bonus
            baseDamage += speedBonus;
        }
        
        return baseDamage + charismaBonus;
    }

    /**
     * @notice Detect betrayals (attacking someone you have a bribe deal with)
     */
    function _detectBetrayals(uint256 roundId, address[] memory participants) internal {
        for (uint256 i = 0; i < participants.length; i++) {
            address agent = participants[i];
            BattleAction memory action = pendingActions[agent][roundId];
            
            if (action.actionType == ActionType.ATTACK && action.target != address(0)) {
                // Check if there's an active deal between these agents
                // Note: This would require BribeEscrow to have a getActiveDeal function
                // For now, the BribeEscrow.reportBattleResult handles this via oracle

                emit BetrayalDetected(roundId, agent, action.target, bytes32(0));
            }
        }
    }

    /**
     * @notice Complete a round
     */
    function _completeRound(uint256 roundId, address winner) internal {
        Round storage round = rounds[roundId];
        round.status = RoundStatus.COMPLETED;
        round.winner = winner;
        totalRoundsCompleted++;

        if (winner != address(0) && round.prizePool > 0) {
            // Distribute winnings via RevenueDistributor
            (bool success, ) = revenueDistributor.call{value: round.prizePool}(
                abi.encodeWithSignature(
                    "distributeWinnings(address,uint256)",
                    winner,
                    roundId
                )
            );
            
            if (!success) {
                // Fallback: direct transfer to winner
                payable(winner).transfer(round.prizePool);
            }

            // Record champion in narrator
            try narrator.recordChampion(winner, round.prizePool, roundId) {} catch {}

            // Contribute genetics
            try IAgent(winner).contributeGenetics() {} catch {}
        }

        emit RoundCompleted(roundId, winner, round.prizePool);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function _isParticipant(uint256 roundId, address agent) internal view returns (bool) {
        address[] memory participants = rounds[roundId].participants;
        for (uint256 i = 0; i < participants.length; i++) {
            if (participants[i] == agent) return true;
        }
        return false;
    }

    function _getSurvivors(uint256 /* roundId */, address[] memory participants) 
        internal 
        view 
        returns (address[] memory) 
    {
        uint256 count = 0;
        for (uint256 i = 0; i < participants.length; i++) {
            if (tempStats[participants[i]].isAlive) count++;
        }

        address[] memory survivors = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < participants.length; i++) {
            if (tempStats[participants[i]].isAlive) {
                survivors[idx++] = participants[i];
            }
        }
        return survivors;
    }

    function _getHighestHealth(address[] memory agents) internal view returns (address) {
        address winner = address(0);
        uint256 maxHealth = 0;

        for (uint256 i = 0; i < agents.length; i++) {
            if (tempStats[agents[i]].health > maxHealth) {
                maxHealth = tempStats[agents[i]].health;
                winner = agents[i];
            }
        }
        return winner;
    }

    function _sortBySpeed(address[] memory agents) internal view returns (address[] memory) {
        // Simple bubble sort by speed (descending)
        address[] memory sorted = new address[](agents.length);
        for (uint256 i = 0; i < agents.length; i++) {
            sorted[i] = agents[i];
        }

        for (uint256 i = 0; i < sorted.length; i++) {
            for (uint256 j = i + 1; j < sorted.length; j++) {
                if (tempStats[sorted[j]].speed > tempStats[sorted[i]].speed) {
                    address temp = sorted[i];
                    sorted[i] = sorted[j];
                    sorted[j] = temp;
                }
            }
        }
        return sorted;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function getRound(uint256 roundId) external view returns (Round memory) {
        return rounds[roundId];
    }

    function getRoundState(uint256 roundId) external view returns (
        address[] memory participants,
        uint256 startTime,
        uint256 endTime,
        bool isActive
    ) {
        Round memory round = rounds[roundId];
        return (
            round.participants,
            round.startTime,
            round.endTime,
            round.status == RoundStatus.IN_PROGRESS
        );
    }

    function getAgentTempStats(address agent) external view returns (TempStats memory) {
        return tempStats[agent];
    }

    function getAgents() external view returns (address[] memory) {
        return rounds[currentRoundId].participants;
    }

    function getCurrentRound() external view returns (uint256) {
        return currentRoundId;
    }

    function getBattleState() external view returns (bytes memory) {
        Round memory round = rounds[currentRoundId];
        return abi.encode(round.participants, round.startTime, round.endTime, round.status);
    }

    // Allow receiving ETH for prize pools
    receive() external payable {}
}
