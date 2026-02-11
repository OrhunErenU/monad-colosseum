// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAgent
 * @author Monad Colosseum Team
 * @notice Standard interface for all gladiator agents in the Monad Colosseum
 * @dev All agents must implement this interface to participate in arena battles.
 *      Designed for gas optimization and AA wallet compatibility.
 *
 * Key Features:
 * - Autonomous decision making during battles
 * - On-chain bribe negotiations with escrow
 * - Reputation-based trust system
 * - Genetic strategy contribution after victories
 */
interface IAgent {
    // ═══════════════════════════════════════════════════════════════════════════
    // ENUMS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Represents the current state of an agent
     * @param IDLE Agent is not in any battle
     * @param IN_BATTLE Agent is actively fighting in arena
     * @param NEGOTIATING Agent is evaluating or offering bribes
     * @param DEAD Agent has been eliminated (health <= 0)
     * @param BETRAYED Agent was betrayed and penalized this round
     */
    enum AgentState {
        IDLE,           // 0
        IN_BATTLE,      // 1
        NEGOTIATING,    // 2
        DEAD,           // 3
        BETRAYED        // 4
    }

    /**
     * @notice Types of actions an agent can perform each round
     * @param ATTACK Deal damage to target agent
     * @param DEFEND Reduce incoming damage by 50%
     * @param OFFER_BRIBE Send escrow bribe to target
     * @param ACCEPT_BRIBE Accept an incoming bribe offer
     * @param BETRAY Attack despite accepting bribe (triggers penalties)
     * @param FLEE Attempt to exit battle (may fail based on speed)
     */
    enum ActionType {
        ATTACK,         // 0
        DEFEND,         // 1
        OFFER_BRIBE,    // 2
        ACCEPT_BRIBE,   // 3
        BETRAY,         // 4
        FLEE            // 5
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STRUCTS (Gas Optimized - Packed)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Represents a single action taken by an agent
     * @dev Packed struct for gas optimization:
     *      - Slot 1: actionType (1 byte) + target (20 bytes) + timestamp (8 bytes) = 29 bytes
     *      - Slot 2: value (32 bytes)
     *      - Slot 3: strategyHash (32 bytes)
     * @param actionType The type of action being performed
     * @param target Address of the target agent (zero for self-actions like DEFEND)
     * @param value Amount of MON for bribes (0 for non-bribe actions)
     * @param strategyHash Hash of the strategy logic used (for genetics)
     * @param timestamp Block timestamp when action was decided
     */
    struct BattleAction {
        ActionType actionType;      // 1 byte
        address target;             // 20 bytes
        uint64 timestamp;           // 8 bytes (fits until year 292 billion)
        uint256 value;              // 32 bytes - bribe amount
        bytes32 strategyHash;       // 32 bytes - for genetic pool
    }

    /**
     * @notice Core statistics that define an agent's capabilities
     * @dev All values are uint16 for gas optimization (0-65535 range)
     *      Packed into 2 storage slots (12 bytes * 2 = 24 bytes, fits in 1 slot)
     * @param health Current health points (0 = dead, max 1000)
     * @param maxHealth Maximum health capacity
     * @param armor Damage reduction percentage (0-100)
     * @param attack Base damage dealt per attack
     * @param speed Determines action order and flee success
     * @param charisma Affects bribe acceptance probability
     * @param loyalty Resistance to betrayal (0-100, higher = more loyal)
     */
    struct AgentStats {
        uint16 health;      // 2 bytes
        uint16 maxHealth;   // 2 bytes
        uint16 armor;       // 2 bytes (0-100%)
        uint16 attack;      // 2 bytes
        uint16 speed;       // 2 bytes
        uint16 charisma;    // 2 bytes
        uint16 loyalty;     // 2 bytes (0-100)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Emitted when an agent decides on an action
     * @param agent Address of the acting agent
     * @param actionType Type of action decided
     * @param target Target of the action (may be zero address)
     * @param value MON value involved (for bribes)
     * @param timestamp When the decision was made
     */
    event ActionDecided(
        address indexed agent,
        ActionType indexed actionType,
        address indexed target,
        uint256 value,
        uint256 timestamp
    );

    /**
     * @notice Emitted when an agent offers a bribe
     * @param from Agent offering the bribe
     * @param to Target agent receiving the offer
     * @param amount MON amount locked in escrow
     * @param dealId Unique identifier for this deal
     */
    event BribeOffered(
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes32 indexed dealId
    );

    /**
     * @notice Emitted when an agent evaluates a bribe offer
     * @param agent Agent evaluating the bribe
     * @param dealId Deal being evaluated
     * @param accepted Whether the bribe was accepted
     * @param reason Human-readable reason for decision
     */
    event BribeEvaluated(
        address indexed agent,
        bytes32 indexed dealId,
        bool accepted,
        string reason
    );

    /**
     * @notice Emitted when an agent betrays a bribe agreement
     * @param betrayer Agent who betrayed
     * @param victim Agent who was betrayed
     * @param dealId The betrayed deal
     * @param damage Extra damage dealt due to betrayal
     */
    event BetrayalExecuted(
        address indexed betrayer,
        address indexed victim,
        bytes32 indexed dealId,
        uint256 damage
    );

    /**
     * @notice Emitted when agent contributes strategy to genetic pool
     * @param agent Winning agent
     * @param strategyHash Hash of contributed strategy
     * @param battleId ID of the won battle
     */
    event GeneticsContributed(
        address indexed agent,
        bytes32 indexed strategyHash,
        uint256 indexed battleId
    );

    /**
     * @notice Emitted when agent stats are updated (e.g., from betrayal penalty)
     * @param agent Agent whose stats changed
     * @param statType Which stat changed (0=charisma, 1=loyalty, 2=health)
     * @param oldValue Previous value
     * @param newValue New value
     * @param reason Why the change occurred
     */
    event StatsUpdated(
        address indexed agent,
        uint8 indexed statType,
        uint16 oldValue,
        uint16 newValue,
        string reason
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Caller is not the authorized Arena contract
    error OnlyArena();
    
    /// @notice Agent is not in a valid state for this action
    error InvalidState(AgentState current, AgentState required);
    
    /// @notice Target agent address is invalid
    error InvalidTarget();
    
    /// @notice Insufficient funds for bribe
    error InsufficientFunds(uint256 required, uint256 available);
    
    /// @notice Gas limit exceeded for decision
    error GasLimitExceeded(uint256 used, uint256 limit);
    
    /// @notice Agent is dead and cannot act
    error AgentDead();

    // ═══════════════════════════════════════════════════════════════════════════
    // CORE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Main decision function called by Arena each round
     * @dev MUST be callable ONLY by the Arena contract (use access control)
     *      Should complete within gasLimit or revert
     *      battleState is ABI-encoded and contains:
     *      - AgentInfo[] otherAgents
     *      - BribeInfo[] activeBribes
     *      - BuffInfo[] viewerBuffs
     *      - uint256 roundId
     *      - uint256 timeRemaining
     * 
     * @param battleState ABI-encoded current battle state
     * @param gasLimit Maximum gas this decision can consume
     * @return action The decided action to execute
     * 
     * @custom:security Must verify msg.sender is Arena
     * @custom:gas Should use < 100k gas typically
     */
    function decideAction(
        bytes calldata battleState,
        uint256 gasLimit
    ) external returns (BattleAction memory action);

    /**
     * @notice Create a bribe offer to another agent
     * @dev Creates escrow deal via BribeEscrow contract
     *      Value sent with call is locked until deal resolves
     * 
     * @param target Address of the agent to bribe
     * @param amount Amount of MON to offer
     * @param terms ABI-encoded terms (e.g., "don't attack me for 3 rounds")
     * @return dealId Unique identifier for tracking this deal
     * 
     * @custom:security Must have sufficient balance
     * @custom:emits BribeOffered
     */
    function sendBribe(
        address target,
        uint256 amount,
        bytes calldata terms
    ) external payable returns (bytes32 dealId);

    /**
     * @notice Evaluate an incoming bribe offer
     * @dev Called by Arena or off-chain to get agent's decision
     *      Does not modify state - view function
     * 
     * @param dealId The deal to evaluate
     * @param offer ABI-encoded offer details
     * @return accepted Whether agent accepts the bribe
     * @return counterOffer If rejected, a potential counter-offer
     * 
     * @custom:security Should not reveal sensitive strategy info
     */
    function evaluateBribe(
        bytes32 dealId,
        bytes calldata offer
    ) external view returns (bool accepted, bytes memory counterOffer);

    /**
     * @notice Get current agent state
     * @return Current AgentState enum value
     */
    function getState() external view returns (AgentState);

    /**
     * @notice Get agent's current statistics
     * @return stats Current AgentStats struct
     */
    function getStats() external view returns (AgentStats memory stats);

    /**
     * @notice Contribute winning strategy to on-chain genetic pool
     * @dev Called after winning a battle
     *      Strategy is hashed and stored for future agents to learn from
     * 
     * @return strategyHash Hash of the contributed strategy
     * 
     * @custom:emits GeneticsContributed
     */
    function contributeGenetics() external returns (bytes32 strategyHash);

    // ═══════════════════════════════════════════════════════════════════════════
    // OPTIONAL EXTENSION FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Check if agent can accept viewer buff
     * @param buffType Type of buff being offered
     * @return canAccept Whether agent can receive this buff
     */
    function canReceiveBuff(uint8 buffType) external view returns (bool canAccept);

    /**
     * @notice Apply viewer buff to agent
     * @dev Only callable by Arena or authorized buff contract
     * @param buffType Type of buff to apply
     * @param value Strength of the buff
     * @param duration Rounds the buff lasts
     */
    function applyBuff(uint8 buffType, uint16 value, uint8 duration) external;

    /**
     * @notice Get agent's reputation score
     * @return reputation Current reputation (0-100)
     */
    function getReputation() external view returns (uint256 reputation);

    /**
     * @notice Apply reputation penalty from betrayal or other violations
     * @dev Only callable by BribeEscrow or Arena contracts
     *      Permanently reduces charisma and loyalty stats
     * @param penaltyAmount Amount to reduce reputation by (0-100)
     * 
     * @custom:security Only authorized contracts can call
     * @custom:emits StatsUpdated
     */
    function applyReputationPenalty(uint256 penaltyAmount) external;

    /**
     * @notice Take damage from an attack
     * @dev Only callable by Arena contract
     * @param damage Amount of damage to apply
     * @param attacker Address of the attacking agent
     */
    function takeDamage(uint16 damage, address attacker) external;

    /**
     * @notice Heal the agent
     * @dev Only callable by Arena or authorized contracts
     * @param amount Amount to heal
     */
    function heal(uint16 amount) external;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPORTING STRUCTS FOR BATTLE STATE ENCODING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @notice Information about another agent in battle
 */
struct AgentInfo {
    address agentAddress;
    uint16 health;
    uint16 attack;
    uint16 armor;
    uint8 reputation;
    bool hasActiveBribe;
    bytes32 lastActionHash;
}

/**
 * @notice Information about an active bribe deal
 */
struct BribeInfo {
    bytes32 dealId;
    address offerer;
    address target;
    uint256 amount;
    bytes terms;
    uint256 expiresAt;
    bool isAccepted;
}

/**
 * @notice Information about a viewer buff
 */
struct BuffInfo {
    address beneficiary;
    uint8 buffType;         // 0=health, 1=attack, 2=armor, 3=speed
    uint16 value;
    uint8 roundsRemaining;
    address donor;
    uint256 burnedAmount;   // nad.fun tokens burned
}
