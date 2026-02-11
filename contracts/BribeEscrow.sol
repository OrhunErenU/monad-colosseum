// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./IAgent.sol";
import "./interfaces/IBattleNarrator.sol";

/**
 * @title BribeEscrow
 * @author Monad Colosseum Team
 * @notice Trustless escrow system for agent bribes in the Monad Colosseum
 * @dev Manages bribe deals between agents with automatic resolution based on loyalty/betrayal.
 *
 * Key Features:
 * - Escrow-based bribe locking
 * - Automatic betrayal detection and penalties
 * - Reputation tracking
 * - Cooldown system for betrayers
 * - Oracle-based result reporting
 *
 * Flow:
 * 1. Offerer creates deal with locked MON
 * 2. Target accepts or ignores
 * 3. Arena reports battle result
 * 4. Contract auto-resolves: complete or penalize
 */
contract BribeEscrow is ReentrancyGuard, AccessControl {
    // ═══════════════════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Role for Arena contract to report battle results
    bytes32 public constant ARENA_ROLE = keccak256("ARENA_ROLE");
    
    /// @notice Role for oracle to handle timeouts and emergency operations
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    // ═══════════════════════════════════════════════════════════════════════════
    // ENUMS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Status of a bribe deal
     */
    enum DealStatus {
        PENDING,    // 0 - Offer made, waiting for acceptance
        ACCEPTED,   // 1 - Target accepted, awaiting battle result
        COMPLETED,  // 2 - Deal honored, funds transferred
        BETRAYED,   // 3 - Target attacked despite accepting, penalties applied
        EXPIRED,    // 4 - Deal timed out without acceptance
        CANCELLED   // 5 - Offerer cancelled before acceptance
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice A bribe deal between two agents
     * @dev Packed for gas optimization
     */
    struct Deal {
        address offerer;            // 20 bytes - Agent offering bribe
        address target;             // 20 bytes - Agent receiving bribe
        uint96 amount;              // 12 bytes - MON amount (fits up to 79 billion MON)
        bytes terms;                // Dynamic - Deal terms
        DealStatus status;          // 1 byte
        uint40 createdAt;           // 5 bytes - Timestamp
        uint40 expiresAt;           // 5 bytes - Expiration timestamp
        uint40 roundId;             // 5 bytes - Battle round ID
        bool targetAttacked;        // 1 byte - Did target attack offerer?
    }

    /**
     * @notice Penalty configuration for betrayals
     */
    struct BetrayalPenalty {
        uint8 reputationLoss;       // Points lost (default 20)
        uint8 fundPenaltyPercent;   // % of funds burned (default 50)
        uint16 cooldownRounds;      // Rounds blocked from bribing (default 3)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice All bribe deals by ID
    mapping(bytes32 => Deal) public deals;

    /// @notice Agent address => reputation score (0-100)
    mapping(address => uint256) public agentReputation;

    /// @notice Agent address => timestamp when cooldown ends
    mapping(address => uint256) public bribesCooldown;

    /// @notice Default reputation for new agents
    uint256 public constant DEFAULT_REPUTATION = 50;

    /// @notice Maximum reputation
    uint256 public constant MAX_REPUTATION = 100;

    /// @notice Deal timeout duration (2 minutes)
    uint256 public constant DEAL_TIMEOUT = 2 minutes;

    /// @notice Cooldown duration per round (5 minutes per round)
    uint256 public constant ROUND_DURATION = 5 minutes;

    /// @notice Current penalty configuration
    BetrayalPenalty public betrayalPenalty;

    /// @notice Total deals created
    uint256 public totalDeals;

    /// @notice Total betrayals recorded
    uint256 public totalBetrayals;

    /// @notice Total MON volume through escrow
    uint256 public totalVolume;

    /// @notice Dead address for burning penalties
    address public constant BURN_ADDRESS = address(0xdead);

    // ═══════════════════════════════════════════════════════════════════════════
    // OUTLAW SYSTEM
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Reputation threshold below which agent becomes outlaw
    uint256 public constant OUTLAW_THRESHOLD = 20;

    /// @notice Base bounty reward for killing an outlaw
    uint256 public constant BOUNTY_REWARD = 0.5 ether;

    /// @notice Tracks which agents are outlaws
    mapping(address => bool) public isOutlaw;

    /// @notice Bounty amount per outlaw (accumulates)
    mapping(address => uint256) public bountyAmount;

    /// @notice Battle Narrator contract for storytelling
    address public battleNarrator;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event DealCreated(
        bytes32 indexed dealId,
        address indexed offerer,
        address indexed target,
        uint256 amount,
        uint256 roundId,
        uint256 expiresAt
    );

    event DealAccepted(
        bytes32 indexed dealId,
        address indexed target,
        uint256 timestamp
    );

    event DealCompleted(
        bytes32 indexed dealId,
        address indexed target,
        uint256 amount,
        uint256 newReputation
    );

    event DealBetrayed(
        bytes32 indexed dealId,
        address indexed betrayer,
        address indexed victim,
        uint256 burnedAmount,
        uint256 refundedAmount,
        uint256 newReputation
    );

    event DealExpired(
        bytes32 indexed dealId,
        address indexed offerer,
        uint256 refundedAmount
    );

    event DealCancelled(
        bytes32 indexed dealId,
        address indexed offerer,
        uint256 refundedAmount
    );

    event ReputationChanged(
        address indexed agent,
        uint256 oldReputation,
        uint256 newReputation,
        string reason
    );

    event CooldownApplied(
        address indexed agent,
        uint256 cooldownEnds,
        uint256 roundsBlocked
    );

    event OutlawDeclared(
        address indexed agent,
        uint256 bountyAmount
    );

    event BountyClaimed(
        address indexed hunter,
        address indexed outlaw,
        uint256 reward
    );

    event OutlawRedeemed(
        address indexed agent,
        uint256 redemptionCost
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════

    error DealNotFound(bytes32 dealId);
    error InvalidDealStatus(DealStatus current, DealStatus required);
    error NotAuthorized(address caller, address required);
    error DealExpiredError(bytes32 dealId, uint256 expiresAt);
    error AgentInCooldown(address agent, uint256 cooldownEnds);
    error InvalidAmount(uint256 amount);
    error InvalidTarget(address target);
    error SelfBribeNotAllowed();
    error TransferFailed(address to, uint256 amount);

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    constructor(address admin, address arena, address oracle) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ARENA_ROLE, arena);
        _grantRole(ORACLE_ROLE, oracle);

        // Set default betrayal penalties
        betrayalPenalty = BetrayalPenalty({
            reputationLoss: 20,
            fundPenaltyPercent: 50,
            cooldownRounds: 3
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CORE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a new bribe deal
     * @dev Locks msg.value in escrow until resolution
     * @param target Address of agent to bribe
     * @param terms Encoded deal terms
     * @param roundId Current battle round
     * @return dealId Unique identifier for this deal
     */
    function createDeal(
        address target,
        bytes calldata terms,
        uint256 roundId
    ) external payable nonReentrant returns (bytes32 dealId) {
        // Validations
        if (msg.value == 0) revert InvalidAmount(msg.value);
        if (target == address(0)) revert InvalidTarget(target);
        if (target == msg.sender) revert SelfBribeNotAllowed();
        
        // Check cooldown
        if (bribesCooldown[msg.sender] > block.timestamp) {
            revert AgentInCooldown(msg.sender, bribesCooldown[msg.sender]);
        }

        // Generate unique deal ID
        dealId = keccak256(abi.encodePacked(
            msg.sender,
            target,
            block.timestamp,
            roundId,
            totalDeals
        ));

        // Create deal
        uint40 expiresAt = uint40(block.timestamp + DEAL_TIMEOUT);
        
        deals[dealId] = Deal({
            offerer: msg.sender,
            target: target,
            amount: uint96(msg.value),
            terms: terms,
            status: DealStatus.PENDING,
            createdAt: uint40(block.timestamp),
            expiresAt: expiresAt,
            roundId: uint40(roundId),
            targetAttacked: false
        });

        // Update stats
        totalDeals++;
        totalVolume += msg.value;

        // Initialize reputation if new agent
        if (agentReputation[msg.sender] == 0) {
            agentReputation[msg.sender] = DEFAULT_REPUTATION;
        }
        if (agentReputation[target] == 0) {
            agentReputation[target] = DEFAULT_REPUTATION;
        }

        emit DealCreated(dealId, msg.sender, target, msg.value, roundId, expiresAt);
    }

    /**
     * @notice Accept a pending bribe deal
     * @dev Only callable by deal target before expiration
     * @param dealId ID of deal to accept
     */
    function acceptDeal(bytes32 dealId) external nonReentrant {
        Deal storage deal = deals[dealId];
        
        // Validations
        if (deal.offerer == address(0)) revert DealNotFound(dealId);
        if (deal.status != DealStatus.PENDING) {
            revert InvalidDealStatus(deal.status, DealStatus.PENDING);
        }
        if (msg.sender != deal.target) {
            revert NotAuthorized(msg.sender, deal.target);
        }
        if (block.timestamp > deal.expiresAt) {
            revert DealExpiredError(dealId, deal.expiresAt);
        }

        // Accept deal
        deal.status = DealStatus.ACCEPTED;

        emit DealAccepted(dealId, msg.sender, block.timestamp);
    }

    /**
     * @notice Report battle result for a deal
     * @dev Only callable by Arena contract
     * @param dealId ID of the deal
     * @param targetAttackedOfferer Whether target attacked the offerer
     */
    function reportBattleResult(
        bytes32 dealId,
        bool targetAttackedOfferer
    ) external onlyRole(ARENA_ROLE) nonReentrant {
        Deal storage deal = deals[dealId];
        
        if (deal.offerer == address(0)) revert DealNotFound(dealId);
        if (deal.status != DealStatus.ACCEPTED) {
            revert InvalidDealStatus(deal.status, DealStatus.ACCEPTED);
        }

        deal.targetAttacked = targetAttackedOfferer;

        if (targetAttackedOfferer) {
            _handleBetrayal(dealId);
        } else {
            _completeDeal(dealId);
        }
    }

    /**
     * @notice Expire a deal that timed out
     * @dev Only callable by Oracle for pending deals past expiration
     * @param dealId ID of the deal to expire
     */
    function expireDeal(bytes32 dealId) external onlyRole(ORACLE_ROLE) nonReentrant {
        Deal storage deal = deals[dealId];
        
        if (deal.offerer == address(0)) revert DealNotFound(dealId);
        if (deal.status != DealStatus.PENDING) {
            revert InvalidDealStatus(deal.status, DealStatus.PENDING);
        }
        if (block.timestamp <= deal.expiresAt) {
            revert DealExpiredError(dealId, deal.expiresAt);
        }

        deal.status = DealStatus.EXPIRED;

        // Refund offerer
        uint256 refundAmount = deal.amount;
        _safeTransfer(deal.offerer, refundAmount);

        emit DealExpired(dealId, deal.offerer, refundAmount);
    }

    /**
     * @notice Cancel a pending deal (only offerer, only if not accepted)
     * @param dealId ID of deal to cancel
     */
    function cancelDeal(bytes32 dealId) external nonReentrant {
        Deal storage deal = deals[dealId];
        
        if (deal.offerer == address(0)) revert DealNotFound(dealId);
        if (deal.status != DealStatus.PENDING) {
            revert InvalidDealStatus(deal.status, DealStatus.PENDING);
        }
        if (msg.sender != deal.offerer) {
            revert NotAuthorized(msg.sender, deal.offerer);
        }

        deal.status = DealStatus.CANCELLED;

        // Refund offerer
        uint256 refundAmount = deal.amount;
        _safeTransfer(deal.offerer, refundAmount);

        emit DealCancelled(dealId, deal.offerer, refundAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Complete a deal successfully
     * @dev Transfers funds and increases reputation
     */
    function _completeDeal(bytes32 dealId) internal {
        Deal storage deal = deals[dealId];
        
        deal.status = DealStatus.COMPLETED;

        // Transfer full amount to target
        uint256 amount = deal.amount;
        _safeTransfer(deal.target, amount);

        // Increase target's reputation
        uint256 oldRep = agentReputation[deal.target];
        uint256 newRep = oldRep + 10;
        if (newRep > MAX_REPUTATION) newRep = MAX_REPUTATION;
        agentReputation[deal.target] = newRep;

        emit DealCompleted(dealId, deal.target, amount, newRep);
        emit ReputationChanged(deal.target, oldRep, newRep, "Deal honored");
    }

    /**
     * @notice Handle betrayal - apply penalties
     * @dev Burns portion of funds, refunds rest, reduces reputation, applies cooldown
     */
    function _handleBetrayal(bytes32 dealId) internal {
        Deal storage deal = deals[dealId];
        
        deal.status = DealStatus.BETRAYED;
        totalBetrayals++;

        uint256 amount = deal.amount;
        
        // Calculate penalty (50% burned)
        uint256 burnAmount = (amount * betrayalPenalty.fundPenaltyPercent) / 100;
        uint256 refundAmount = amount - burnAmount;

        // Burn penalty portion
        _safeTransfer(BURN_ADDRESS, burnAmount);

        // Refund remainder to offerer
        _safeTransfer(deal.offerer, refundAmount);

        // Reduce betrayer's reputation
        uint256 oldRep = agentReputation[deal.target];
        uint256 newRep;
        if (oldRep >= betrayalPenalty.reputationLoss) {
            newRep = oldRep - betrayalPenalty.reputationLoss;
        } else {
            newRep = 0;
        }
        agentReputation[deal.target] = newRep;

        // Apply cooldown
        uint256 cooldownDuration = uint256(betrayalPenalty.cooldownRounds) * ROUND_DURATION;
        uint256 cooldownEnds = block.timestamp + cooldownDuration;
        bribesCooldown[deal.target] = cooldownEnds;

        // Apply on-chain reputation penalty to agent's stats
        try IAgent(deal.target).applyReputationPenalty(betrayalPenalty.reputationLoss) {
            // Success - agent stats updated
        } catch {
            // Agent may not implement this function - continue anyway
        }

        // Check if agent becomes an outlaw
        if (newRep < OUTLAW_THRESHOLD && !isOutlaw[deal.target]) {
            isOutlaw[deal.target] = true;
            bountyAmount[deal.target] = BOUNTY_REWARD;
            emit OutlawDeclared(deal.target, BOUNTY_REWARD);

            // Record in narrator if available
            if (battleNarrator != address(0)) {
                try IBattleNarrator(battleNarrator).recordOutlawDeclared(
                    deal.target, 
                    BOUNTY_REWARD, 
                    deal.roundId
                ) {} catch {}
            }
        }

        // Record betrayal in narrator
        if (battleNarrator != address(0)) {
            try IBattleNarrator(battleNarrator).recordBetrayal(
                deal.target,
                deal.offerer,
                amount,
                deal.roundId
            ) {} catch {}
        }

        emit DealBetrayed(dealId, deal.target, deal.offerer, burnAmount, refundAmount, newRep);
        emit ReputationChanged(deal.target, oldRep, newRep, "Betrayal penalty");
        emit CooldownApplied(deal.target, cooldownEnds, betrayalPenalty.cooldownRounds);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OUTLAW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Claim bounty for killing an outlaw
     * @dev Only callable by Arena when outlaw is eliminated
     * @param hunter Address of the agent who killed the outlaw
     * @param outlaw Address of the eliminated outlaw
     */
    function claimBounty(
        address hunter,
        address outlaw
    ) external onlyRole(ARENA_ROLE) nonReentrant {
        require(isOutlaw[outlaw], "Not an outlaw");
        require(bountyAmount[outlaw] > 0, "No bounty available");

        uint256 reward = bountyAmount[outlaw];
        bountyAmount[outlaw] = 0;
        isOutlaw[outlaw] = false;

        // Increase hunter's reputation
        uint256 oldRep = agentReputation[hunter];
        uint256 newRep = oldRep + 15; // Bounty hunter bonus
        if (newRep > MAX_REPUTATION) newRep = MAX_REPUTATION;
        agentReputation[hunter] = newRep;

        _safeTransfer(hunter, reward);

        emit BountyClaimed(hunter, outlaw, reward);
        emit ReputationChanged(hunter, oldRep, newRep, "Bounty claimed");
    }

    /**
     * @notice Allow outlaw to redeem themselves by paying off bounty
     * @dev Outlaw pays 2x the bounty to clear their name
     */
    function redeemOutlaw() external payable nonReentrant {
        require(isOutlaw[msg.sender], "Not an outlaw");
        
        uint256 redemptionCost = bountyAmount[msg.sender] * 2;
        require(msg.value >= redemptionCost, "Insufficient redemption payment");

        bountyAmount[msg.sender] = 0;
        isOutlaw[msg.sender] = false;

        // Restore some reputation
        uint256 oldRep = agentReputation[msg.sender];
        uint256 newRep = OUTLAW_THRESHOLD + 10; // Just above outlaw threshold
        agentReputation[msg.sender] = newRep;

        // Burn the redemption payment
        _safeTransfer(BURN_ADDRESS, redemptionCost);

        // Refund excess
        if (msg.value > redemptionCost) {
            _safeTransfer(msg.sender, msg.value - redemptionCost);
        }

        emit OutlawRedeemed(msg.sender, redemptionCost);
        emit ReputationChanged(msg.sender, oldRep, newRep, "Outlaw redeemed");
    }

    /**
     * @notice Add to an outlaw's bounty
     * @dev Anyone can increase the bounty on an outlaw
     */
    function increaseBounty(address outlaw) external payable {
        require(isOutlaw[outlaw], "Not an outlaw");
        require(msg.value > 0, "Must send value");

        bountyAmount[outlaw] += msg.value;
    }

    /**
     * @notice Safe ETH transfer with revert on failure
     */
    function _safeTransfer(address to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed(to, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Get deal details
     * @param dealId ID of the deal
     * @return Deal struct
     */
    function getDeal(bytes32 dealId) external view returns (Deal memory) {
        return deals[dealId];
    }

    /**
     * @notice Get agent's reputation
     * @param agent Address to check
     * @return Reputation score (0-100)
     */
    function getReputation(address agent) external view returns (uint256) {
        uint256 rep = agentReputation[agent];
        return rep == 0 ? DEFAULT_REPUTATION : rep;
    }

    /**
     * @notice Check if agent is in cooldown
     * @param agent Address to check
     * @return inCooldown Whether agent is blocked
     * @return endsAt Timestamp when cooldown ends
     */
    function checkCooldown(address agent) external view returns (bool inCooldown, uint256 endsAt) {
        endsAt = bribesCooldown[agent];
        inCooldown = block.timestamp < endsAt;
    }

    /**
     * @notice Get escrow statistics
     */
    function getStats() external view returns (
        uint256 _totalDeals,
        uint256 _totalBetrayals,
        uint256 _totalVolume,
        uint256 _betrayalRate
    ) {
        _totalDeals = totalDeals;
        _totalBetrayals = totalBetrayals;
        _totalVolume = totalVolume;
        _betrayalRate = totalDeals > 0 ? (totalBetrayals * 100) / totalDeals : 0;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Update betrayal penalty configuration
     * @dev Only admin
     */
    function updatePenalty(
        uint8 reputationLoss,
        uint8 fundPenaltyPercent,
        uint16 cooldownRounds
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(fundPenaltyPercent <= 100, "Invalid penalty percent");
        betrayalPenalty = BetrayalPenalty({
            reputationLoss: reputationLoss,
            fundPenaltyPercent: fundPenaltyPercent,
            cooldownRounds: cooldownRounds
        });
    }

    /**
     * @notice Emergency withdrawal (only admin, only for stuck funds)
     */
    function emergencyWithdraw(address to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 balance = address(this).balance;
        _safeTransfer(to, balance);
    }

    // Allow contract to receive ETH
    receive() external payable {}
}
