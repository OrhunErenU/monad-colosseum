// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentRegistry
 * @author Monad Colosseum Team
 * @notice On-chain registry for AI gladiator agents with strategy parameters
 * @dev Stores agent profiles, strategy configs, autonomous wallet mappings,
 *      and supports natural-language-derived strategy parameters.
 *
 * Key Features:
 * - Agent registration with owner wallet + autonomous wallet
 * - On-chain strategy parameters (aggressiveness, risk_tolerance, etc.)
 * - Budget management (deposit/withdraw MON for agent operations)
 * - Profit target & auto-withdrawal thresholds
 * - External agent support for open arenas
 */
contract AgentRegistry is AccessControl, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════════════════

    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");
    bytes32 public constant ARENA_ROLE = keccak256("ARENA_ROLE");

    // ═══════════════════════════════════════════════════════════════════════════
    // ENUMS
    // ═══════════════════════════════════════════════════════════════════════════

    enum AgentStatus {
        ACTIVE,         // 0 - Available for arenas
        IN_BATTLE,      // 1 - Currently fighting
        PAUSED,         // 2 - Owner paused operations
        DECOMMISSIONED  // 3 - Permanently retired
    }

    enum BriberyPolicy {
        ALWAYS_REJECT,  // 0
        ALWAYS_ACCEPT,  // 1
        CONDITIONAL     // 2 - Accept based on amount/context
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Strategy parameters derived from natural language input
     */
    struct StrategyParams {
        uint8 aggressiveness;       // 0-100: How aggressive in combat
        uint8 riskTolerance;        // 0-100: What entry fee levels to accept
        BriberyPolicy briberyPolicy;
        uint256 profitTarget;       // Target earnings in wei before auto-withdraw
        uint256 withdrawThreshold;  // Auto-send to owner when balance exceeds this
        uint8 allianceTendency;     // 0-100: How likely to form alliances
        uint8 betrayalChance;       // 0-100: How likely to break alliances
    }

    /**
     * @notice Full agent profile
     */
    struct Agent {
        address owner;              // Human wallet that owns this agent
        address agentWallet;        // Autonomous wallet (platform-managed)
        string name;                // Display name
        string strategyDescription; // Natural language strategy
        StrategyParams params;      // Parsed strategy parameters
        AgentStatus status;
        uint256 budget;             // Current MON balance for operations
        uint256 totalEarnings;      // Lifetime earnings
        uint256 totalLosses;        // Lifetime losses
        uint256 matchesPlayed;
        uint256 matchesWon;
        int256 eloRating;           // ELO rating (starts at 1200)
        uint256 createdAt;
        bool isExternal;            // External agent (from other platforms)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice All agents by ID
    mapping(uint256 => Agent) public agents;

    /// @notice Agent wallet => agent ID
    mapping(address => uint256) public walletToAgent;

    /// @notice Owner => array of agent IDs
    mapping(address => uint256[]) public ownerAgents;

    /// @notice Total agents registered
    uint256 public totalAgents;

    /// @notice Agent creation fee
    uint256 public creationFee;

    /// @notice Platform treasury
    address public treasury;

    /// @notice Default ELO rating
    int256 public constant DEFAULT_ELO = 1200;

    /// @notice ELO K-factor
    uint256 public constant ELO_K_FACTOR = 32;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed owner,
        address indexed agentWallet,
        string name,
        uint256 timestamp
    );

    event AgentUpdated(
        uint256 indexed agentId,
        string name,
        string strategyDescription
    );

    event StrategyParamsUpdated(
        uint256 indexed agentId,
        uint8 aggressiveness,
        uint8 riskTolerance,
        uint8 allianceTendency,
        uint8 betrayalChance
    );

    event BudgetDeposited(
        uint256 indexed agentId,
        address indexed depositor,
        uint256 amount
    );

    event BudgetWithdrawn(
        uint256 indexed agentId,
        address indexed owner,
        uint256 amount
    );

    event AgentStatusChanged(
        uint256 indexed agentId,
        AgentStatus oldStatus,
        AgentStatus newStatus
    );

    event EloUpdated(
        uint256 indexed agentId,
        int256 oldElo,
        int256 newElo,
        uint256 matchId
    );

    event ExternalAgentRegistered(
        uint256 indexed agentId,
        address indexed externalWallet,
        string platformOrigin
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════

    error NotAgentOwner(address caller, address owner);
    error AgentNotFound(uint256 agentId);
    error AgentNotActive(uint256 agentId, AgentStatus status);
    error InsufficientBudget(uint256 required, uint256 available);
    error InvalidParams();
    error WalletAlreadyRegistered(address wallet);
    error InsufficientCreationFee(uint256 sent, uint256 required);

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    constructor(address admin, address _treasury, uint256 _creationFee) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PLATFORM_ROLE, admin);
        treasury = _treasury;
        creationFee = _creationFee;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT REGISTRATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Register a new agent
     * @param agentWallet The autonomous wallet for this agent
     * @param name Display name
     * @param strategyDescription Natural language strategy
     * @param params Strategy parameters
     */
    function registerAgent(
        address agentWallet,
        string calldata name,
        string calldata strategyDescription,
        StrategyParams calldata params
    ) external payable nonReentrant returns (uint256 agentId) {
        if (msg.value < creationFee) {
            revert InsufficientCreationFee(msg.value, creationFee);
        }
        if (walletToAgent[agentWallet] != 0) {
            revert WalletAlreadyRegistered(agentWallet);
        }
        _validateParams(params);

        agentId = ++totalAgents;
        uint256 budget = msg.value - creationFee;

        agents[agentId] = Agent({
            owner: msg.sender,
            agentWallet: agentWallet,
            name: name,
            strategyDescription: strategyDescription,
            params: params,
            status: AgentStatus.ACTIVE,
            budget: budget,
            totalEarnings: 0,
            totalLosses: 0,
            matchesPlayed: 0,
            matchesWon: 0,
            eloRating: DEFAULT_ELO,
            createdAt: block.timestamp,
            isExternal: false
        });

        walletToAgent[agentWallet] = agentId;
        ownerAgents[msg.sender].push(agentId);

        // Send creation fee to treasury
        if (creationFee > 0) {
            (bool success, ) = treasury.call{value: creationFee}("");
            require(success, "Treasury transfer failed");
        }

        emit AgentRegistered(agentId, msg.sender, agentWallet, name, block.timestamp);
    }

    /**
     * @notice Register an external agent (from other platforms)
     * @dev Only platform role can register external agents
     */
    function registerExternalAgent(
        address externalWallet,
        string calldata name,
        string calldata platformOrigin
    ) external onlyRole(PLATFORM_ROLE) returns (uint256 agentId) {
        if (walletToAgent[externalWallet] != 0) {
            revert WalletAlreadyRegistered(externalWallet);
        }

        agentId = ++totalAgents;

        StrategyParams memory defaultParams = StrategyParams({
            aggressiveness: 50,
            riskTolerance: 50,
            briberyPolicy: BriberyPolicy.CONDITIONAL,
            profitTarget: 0,
            withdrawThreshold: 0,
            allianceTendency: 50,
            betrayalChance: 20
        });

        agents[agentId] = Agent({
            owner: externalWallet,
            agentWallet: externalWallet,
            name: name,
            strategyDescription: string(abi.encodePacked("External agent from ", platformOrigin)),
            params: defaultParams,
            status: AgentStatus.ACTIVE,
            budget: 0,
            totalEarnings: 0,
            totalLosses: 0,
            matchesPlayed: 0,
            matchesWon: 0,
            eloRating: DEFAULT_ELO,
            createdAt: block.timestamp,
            isExternal: true
        });

        walletToAgent[externalWallet] = agentId;

        emit ExternalAgentRegistered(agentId, externalWallet, platformOrigin);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Update agent strategy
     */
    function updateStrategy(
        uint256 agentId,
        string calldata name,
        string calldata strategyDescription,
        StrategyParams calldata params
    ) external {
        Agent storage agent = agents[agentId];
        if (agent.owner != msg.sender) revert NotAgentOwner(msg.sender, agent.owner);
        if (agent.status == AgentStatus.IN_BATTLE) revert AgentNotActive(agentId, agent.status);
        _validateParams(params);

        agent.name = name;
        agent.strategyDescription = strategyDescription;
        agent.params = params;

        emit AgentUpdated(agentId, name, strategyDescription);
        emit StrategyParamsUpdated(agentId, params.aggressiveness, params.riskTolerance, params.allianceTendency, params.betrayalChance);
    }

    /**
     * @notice Deposit MON into agent's budget
     */
    function depositBudget(uint256 agentId) external payable nonReentrant {
        Agent storage agent = agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound(agentId);
        
        agent.budget += msg.value;
        emit BudgetDeposited(agentId, msg.sender, msg.value);

        // Auto-withdraw check
        if (agent.params.withdrawThreshold > 0 && agent.budget > agent.params.withdrawThreshold) {
            uint256 excess = agent.budget - agent.params.withdrawThreshold;
            agent.budget -= excess;
            (bool success, ) = agent.owner.call{value: excess}("");
            if (success) {
                emit BudgetWithdrawn(agentId, agent.owner, excess);
            } else {
                agent.budget += excess; // Revert on failure
            }
        }
    }

    /**
     * @notice Withdraw from agent's budget (owner only)
     */
    function withdrawBudget(uint256 agentId, uint256 amount) external nonReentrant {
        Agent storage agent = agents[agentId];
        if (agent.owner != msg.sender) revert NotAgentOwner(msg.sender, agent.owner);
        if (agent.budget < amount) revert InsufficientBudget(amount, agent.budget);

        agent.budget -= amount;
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Withdraw failed");

        emit BudgetWithdrawn(agentId, msg.sender, amount);
    }

    /**
     * @notice Set agent status
     */
    function setAgentStatus(uint256 agentId, AgentStatus status) external {
        Agent storage agent = agents[agentId];
        if (agent.owner != msg.sender && !hasRole(ARENA_ROLE, msg.sender)) {
            revert NotAgentOwner(msg.sender, agent.owner);
        }

        AgentStatus oldStatus = agent.status;
        agent.status = status;

        emit AgentStatusChanged(agentId, oldStatus, status);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ELO SYSTEM (Called by Arena)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Update ELO after a match
     * @dev Only callable by Arena contract
     */
    function updateElo(
        uint256 winnerId,
        uint256 loserId,
        uint256 matchId
    ) external onlyRole(ARENA_ROLE) {
        Agent storage winner = agents[winnerId];
        Agent storage loser = agents[loserId];

        int256 winnerOldElo = winner.eloRating;
        int256 loserOldElo = loser.eloRating;

        // Expected scores
        int256 diff = loserOldElo - winnerOldElo;
        // Simplified ELO: winner gets K * (1 - expected), loser loses K * expected
        int256 eloChange = int256(ELO_K_FACTOR);
        if (diff > 400) diff = 400;
        if (diff < -400) diff = -400;

        // Approximate expected: use diff/400 ratio
        int256 adjustment = (eloChange * diff) / 800;

        winner.eloRating += eloChange + adjustment;
        loser.eloRating -= eloChange + adjustment;

        // Floor at 0
        if (loser.eloRating < 0) loser.eloRating = 0;

        // Update match stats
        winner.matchesPlayed++;
        winner.matchesWon++;
        loser.matchesPlayed++;

        emit EloUpdated(winnerId, winnerOldElo, winner.eloRating, matchId);
        emit EloUpdated(loserId, loserOldElo, loser.eloRating, matchId);
    }

    /**
     * @notice Record earnings for an agent
     */
    function recordEarnings(uint256 agentId, uint256 amount) external onlyRole(ARENA_ROLE) {
        agents[agentId].totalEarnings += amount;
        agents[agentId].budget += amount;
    }

    /**
     * @notice Record losses for an agent
     */
    function recordLoss(uint256 agentId, uint256 amount) external onlyRole(ARENA_ROLE) {
        agents[agentId].totalLosses += amount;
    }

    /**
     * @notice Deduct from agent budget (entry fees etc)
     */
    function deductBudget(uint256 agentId, uint256 amount) external onlyRole(ARENA_ROLE) {
        Agent storage agent = agents[agentId];
        if (agent.budget < amount) revert InsufficientBudget(amount, agent.budget);
        agent.budget -= amount;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return agents[agentId];
    }

    function getAgentByWallet(address wallet) external view returns (Agent memory) {
        uint256 agentId = walletToAgent[wallet];
        return agents[agentId];
    }

    function getOwnerAgents(address owner) external view returns (uint256[] memory) {
        return ownerAgents[owner];
    }

    function getAgentParams(uint256 agentId) external view returns (StrategyParams memory) {
        return agents[agentId].params;
    }

    function getAgentElo(uint256 agentId) external view returns (int256) {
        return agents[agentId].eloRating;
    }

    /**
     * @notice Get top agents by ELO (for leaderboard)
     * @param limit Max results to return
     */
    function getTopAgents(uint256 limit) external view returns (uint256[] memory ids, int256[] memory ratings) {
        uint256 count = totalAgents < limit ? totalAgents : limit;
        ids = new uint256[](count);
        ratings = new int256[](count);

        // Simple insertion sort for top N
        for (uint256 i = 1; i <= totalAgents; i++) {
            int256 elo = agents[i].eloRating;
            
            for (uint256 j = 0; j < count; j++) {
                if (elo > ratings[j]) {
                    // Shift down
                    for (uint256 k = count - 1; k > j; k--) {
                        ids[k] = ids[k - 1];
                        ratings[k] = ratings[k - 1];
                    }
                    ids[j] = i;
                    ratings[j] = elo;
                    break;
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTERNAL
    // ═══════════════════════════════════════════════════════════════════════════

    function _validateParams(StrategyParams calldata params) internal pure {
        if (params.aggressiveness > 100) revert InvalidParams();
        if (params.riskTolerance > 100) revert InvalidParams();
        if (params.allianceTendency > 100) revert InvalidParams();
        if (params.betrayalChance > 100) revert InvalidParams();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════════════════════

    function setCreationFee(uint256 _fee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        creationFee = _fee;
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = _treasury;
    }

    // Allow receiving MON
    receive() external payable {}
}
