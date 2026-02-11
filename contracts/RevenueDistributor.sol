// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RevenueDistributor
 * @author Monad Colosseum Team
 * @notice Distributes arena winnings between winner and nad.fun liquidity pool
 * @dev 10% of all winnings go to nad.fun pool for token holder rewards
 */
contract RevenueDistributor is AccessControl, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════════════════

    bytes32 public constant ARENA_ROLE = keccak256("ARENA_ROLE");

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice nad.fun liquidity pool address
    address public nadFunPool;

    /// @notice Revenue share to nad.fun pool (in basis points, 1000 = 10%)
    uint256 public constant REVENUE_SHARE_BPS = 1000;

    /// @notice Total distributed to winners
    uint256 public totalWinnerDistributed;

    /// @notice Total distributed to nad.fun pool
    uint256 public totalPoolDistributed;

    /// @notice Distribution history
    struct Distribution {
        address winner;
        uint256 winnerAmount;
        uint256 poolAmount;
        uint256 timestamp;
        uint256 battleId;
    }

    Distribution[] public distributions;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event WinningsDistributed(
        address indexed winner,
        uint256 winnerShare,
        uint256 poolShare,
        uint256 indexed battleId
    );

    event PoolUpdated(address indexed oldPool, address indexed newPool);

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════

    error InvalidWinner(address winner);
    error InvalidPool(address pool);
    error TransferFailed(address recipient, uint256 amount);
    error InsufficientBalance(uint256 required, uint256 available);

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    constructor(address admin, address arena, address _nadFunPool) {
        if (_nadFunPool == address(0)) revert InvalidPool(_nadFunPool);
        
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ARENA_ROLE, arena);
        nadFunPool = _nadFunPool;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REPUTATION-BASED PRICING
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice BribeEscrow contract for reputation lookup
    address public escrowContract;

    /// @notice Set escrow contract for reputation lookups
    function setEscrowContract(address _escrow) external onlyRole(DEFAULT_ADMIN_ROLE) {
        escrowContract = _escrow;
    }

    /**
     * @notice Calculate buff cost with reputation discount
     * @param agent Agent receiving the buff
     * @param baseTokenAmount Base token amount before discount
     * @return discountedCost Final cost after reputation discount
     */
    function calculateBuffCost(address agent, uint256 baseTokenAmount) 
        public 
        view 
        returns (uint256 discountedCost) 
    {
        if (escrowContract == address(0)) {
            return baseTokenAmount;
        }

        // Get reputation from escrow
        (bool success, bytes memory data) = escrowContract.staticcall(
            abi.encodeWithSignature("getReputation(address)", agent)
        );

        if (!success) {
            return baseTokenAmount;
        }

        uint256 reputation = abi.decode(data, (uint256));

        if (reputation >= 80) {
            // High reputation = 20% discount (pay 80%)
            return (baseTokenAmount * 80) / 100;
        } else if (reputation >= 50) {
            // Medium reputation = 10% discount (pay 90%)
            return (baseTokenAmount * 90) / 100;
        } else if (reputation >= 20) {
            // Low reputation = no discount
            return baseTokenAmount;
        } else {
            // Outlaw = 20% PREMIUM (pay 120%)
            return (baseTokenAmount * 120) / 100;
        }
    }

    /**
     * @notice Get discount percentage for display
     * @param agent Agent to check
     * @return discountPercent Discount in percentage (negative = premium)
     */
    function getBuffDiscount(address agent) external view returns (int256 discountPercent) {
        if (escrowContract == address(0)) {
            return 0;
        }

        (bool success, bytes memory data) = escrowContract.staticcall(
            abi.encodeWithSignature("getReputation(address)", agent)
        );

        if (!success) {
            return 0;
        }

        uint256 reputation = abi.decode(data, (uint256));

        if (reputation >= 80) {
            return 20; // 20% discount
        } else if (reputation >= 50) {
            return 10; // 10% discount
        } else if (reputation >= 20) {
            return 0; // No discount
        } else {
            return -20; // 20% premium for outlaws
        }
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // CORE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Distribute battle winnings
     * @param winner Address of the battle winner
     * @param battleId ID of the battle
     */
    function distributeWinnings(
        address winner,
        uint256 battleId
    ) external payable onlyRole(ARENA_ROLE) nonReentrant {
        if (winner == address(0)) revert InvalidWinner(winner);
        if (msg.value == 0) revert InsufficientBalance(1, 0);

        uint256 totalAmount = msg.value;
        uint256 poolShare = (totalAmount * REVENUE_SHARE_BPS) / 10000;
        uint256 winnerShare = totalAmount - poolShare;

        // Transfer to nad.fun pool
        (bool poolSuccess, ) = nadFunPool.call{value: poolShare}("");
        if (!poolSuccess) revert TransferFailed(nadFunPool, poolShare);

        // Transfer to winner
        (bool winnerSuccess, ) = winner.call{value: winnerShare}("");
        if (!winnerSuccess) revert TransferFailed(winner, winnerShare);

        // Update stats
        totalWinnerDistributed += winnerShare;
        totalPoolDistributed += poolShare;

        // Record distribution
        distributions.push(Distribution({
            winner: winner,
            winnerAmount: winnerShare,
            poolAmount: poolShare,
            timestamp: block.timestamp,
            battleId: battleId
        }));

        emit WinningsDistributed(winner, winnerShare, poolShare, battleId);
    }

    /**
     * @notice Distribute with custom split (for special events)
     * @param winner Winner address
     * @param poolShareBps Pool share in basis points
     * @param battleId Battle ID
     */
    function distributeCustom(
        address winner,
        uint256 poolShareBps,
        uint256 battleId
    ) external payable onlyRole(ARENA_ROLE) nonReentrant {
        if (winner == address(0)) revert InvalidWinner(winner);
        if (poolShareBps > 5000) poolShareBps = 5000; // Max 50% to pool

        uint256 totalAmount = msg.value;
        uint256 poolShare = (totalAmount * poolShareBps) / 10000;
        uint256 winnerShare = totalAmount - poolShare;

        (bool poolSuccess, ) = nadFunPool.call{value: poolShare}("");
        if (!poolSuccess) revert TransferFailed(nadFunPool, poolShare);

        (bool winnerSuccess, ) = winner.call{value: winnerShare}("");
        if (!winnerSuccess) revert TransferFailed(winner, winnerShare);

        totalWinnerDistributed += winnerShare;
        totalPoolDistributed += poolShare;

        distributions.push(Distribution({
            winner: winner,
            winnerAmount: winnerShare,
            poolAmount: poolShare,
            timestamp: block.timestamp,
            battleId: battleId
        }));

        emit WinningsDistributed(winner, winnerShare, poolShare, battleId);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Update nad.fun pool address
     */
    function setNadFunPool(address newPool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newPool == address(0)) revert InvalidPool(newPool);
        
        address oldPool = nadFunPool;
        nadFunPool = newPool;
        
        emit PoolUpdated(oldPool, newPool);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function getDistributionCount() external view returns (uint256) {
        return distributions.length;
    }

    function getDistribution(uint256 index) external view returns (Distribution memory) {
        return distributions[index];
    }

    function getRecentDistributions(uint256 limit) external view returns (Distribution[] memory) {
        uint256 len = distributions.length > limit ? limit : distributions.length;
        Distribution[] memory recent = new Distribution[](len);
        
        for (uint256 i = 0; i < len; i++) {
            recent[i] = distributions[distributions.length - 1 - i];
        }
        
        return recent;
    }

    function getStats() external view returns (
        uint256 _totalWinner,
        uint256 _totalPool,
        uint256 _distributionCount
    ) {
        return (totalWinnerDistributed, totalPoolDistributed, distributions.length);
    }

    // Allow receiving ETH
    receive() external payable {}
}
