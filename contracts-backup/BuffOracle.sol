// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BuffOracle
 * @author Monad Colosseum Team
 * @notice Receives nad.fun burn events and applies buffs to agents
 * @dev Integrates with nad.fun token burning to provide real-time viewer engagement
 *
 * Flow:
 * 1. Viewer burns nad.fun tokens via frontend
 * 2. nad.fun backend calls applyBuff()
 * 3. Arena reads buffs during combat resolution
 * 4. Agent stats are temporarily boosted
 */
contract BuffOracle is AccessControl, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Role for nad.fun backend to apply buffs
    bytes32 public constant NADFUN_ROLE = keccak256("NADFUN_ROLE");
    
    /// @notice Role for Arena to read and consume buffs
    bytes32 public constant ARENA_ROLE = keccak256("ARENA_ROLE");

    // ═══════════════════════════════════════════════════════════════════════════
    // ENUMS & STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════

    enum BuffType { 
        HEALTH,     // 0 - Increase health
        ARMOR,      // 1 - Increase damage reduction
        ATTACK,     // 2 - Increase damage dealt
        SPEED       // 3 - Increase action priority
    }

    struct Buff {
        address agent;          // Who receives the buff
        address viewer;         // Who burned tokens
        uint96 tokensBurned;    // Amount of tokens burned
        BuffType buffType;      // Type of buff
        uint16 magnitude;       // Buff strength
        uint40 appliedAt;       // Timestamp
        uint40 roundId;         // Arena round
        bool consumed;          // Has arena applied this buff?
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice All buffs by round
    mapping(uint256 => Buff[]) public roundBuffs;

    /// @notice Total buff value per agent (for leaderboard)
    mapping(address => uint256) public agentBuffValue;

    /// @notice Total tokens burned per viewer (for rewards)
    mapping(address => uint256) public viewerBurnedTotal;

    /// @notice Conversion rate: 1 token = 10 stat points
    uint256 public constant BUFF_MULTIPLIER = 10;

    /// @notice Maximum buff magnitude per single burn
    uint16 public constant MAX_BUFF_MAGNITUDE = 500;

    /// @notice Total buffs applied
    uint256 public totalBuffs;

    /// @notice Total tokens burned through this oracle
    uint256 public totalTokensBurned;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event BuffApplied(
        address indexed agent,
        address indexed viewer,
        uint96 tokensBurned,
        BuffType buffType,
        uint16 magnitude,
        uint256 indexed roundId
    );

    event BuffConsumed(
        address indexed agent,
        uint256 indexed roundId,
        uint256 buffIndex,
        BuffType buffType,
        uint16 magnitude
    );

    event ViewerRewarded(
        address indexed viewer,
        uint256 totalBurned,
        uint256 rewardAmount
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════

    error InvalidAgent(address agent);
    error InvalidAmount(uint256 amount);
    error BuffAlreadyConsumed(uint256 buffIndex);

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    constructor(address admin, address nadFunBackend, address arena) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(NADFUN_ROLE, nadFunBackend);
        _grantRole(ARENA_ROLE, arena);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CORE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Called by nad.fun backend when viewer burns tokens
     * @param agent Which agent to buff
     * @param viewer Who burned tokens
     * @param tokenAmount How many tokens burned
     * @param buffType HEALTH, ARMOR, ATTACK, or SPEED
     * @param roundId Current arena round
     */
    function applyBuff(
        address agent,
        address viewer,
        uint96 tokenAmount,
        BuffType buffType,
        uint256 roundId
    ) external onlyRole(NADFUN_ROLE) nonReentrant {
        if (agent == address(0)) revert InvalidAgent(agent);
        if (tokenAmount == 0) revert InvalidAmount(tokenAmount);

        // Calculate magnitude (capped)
        uint16 magnitude = uint16(
            tokenAmount * BUFF_MULTIPLIER > MAX_BUFF_MAGNITUDE 
                ? MAX_BUFF_MAGNITUDE 
                : tokenAmount * BUFF_MULTIPLIER
        );

        Buff memory buff = Buff({
            agent: agent,
            viewer: viewer,
            tokensBurned: tokenAmount,
            buffType: buffType,
            magnitude: magnitude,
            appliedAt: uint40(block.timestamp),
            roundId: uint40(roundId),
            consumed: false
        });

        roundBuffs[roundId].push(buff);
        agentBuffValue[agent] += tokenAmount;
        viewerBurnedTotal[viewer] += tokenAmount;
        totalBuffs++;
        totalTokensBurned += tokenAmount;

        emit BuffApplied(agent, viewer, tokenAmount, buffType, magnitude, roundId);
    }

    /**
     * @notice Arena calls this to get all unconsumed buffs for an agent
     * @param agent Agent address
     * @param roundId Round to check
     * @return buffs Array of buffs for this agent in this round
     */
    function getAgentBuffs(
        address agent, 
        uint256 roundId
    ) external view returns (Buff[] memory) {
        Buff[] storage allBuffs = roundBuffs[roundId];
        uint256 count = 0;

        // Count agent's unconsumed buffs
        for (uint256 i = 0; i < allBuffs.length; i++) {
            if (allBuffs[i].agent == agent && !allBuffs[i].consumed) {
                count++;
            }
        }

        // Collect them
        Buff[] memory agentBuffs = new Buff[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < allBuffs.length; i++) {
            if (allBuffs[i].agent == agent && !allBuffs[i].consumed) {
                agentBuffs[idx++] = allBuffs[i];
            }
        }

        return agentBuffs;
    }

    /**
     * @notice Arena marks buff as consumed after applying
     * @param roundId Round ID
     * @param buffIndex Index in roundBuffs array
     */
    function consumeBuff(
        uint256 roundId, 
        uint256 buffIndex
    ) external onlyRole(ARENA_ROLE) {
        if (roundBuffs[roundId][buffIndex].consumed) {
            revert BuffAlreadyConsumed(buffIndex);
        }

        Buff storage buff = roundBuffs[roundId][buffIndex];
        buff.consumed = true;

        emit BuffConsumed(
            buff.agent, 
            roundId, 
            buffIndex, 
            buff.buffType, 
            buff.magnitude
        );
    }

    /**
     * @notice Get aggregated buff totals for an agent in a round
     * @return healthBuff Total health buff
     * @return armorBuff Total armor buff
     * @return attackBuff Total attack buff
     * @return speedBuff Total speed buff
     */
    function getAggregatedBuffs(
        address agent,
        uint256 roundId
    ) external view returns (
        uint16 healthBuff,
        uint16 armorBuff,
        uint16 attackBuff,
        uint16 speedBuff
    ) {
        Buff[] storage allBuffs = roundBuffs[roundId];

        for (uint256 i = 0; i < allBuffs.length; i++) {
            if (allBuffs[i].agent == agent && !allBuffs[i].consumed) {
                if (allBuffs[i].buffType == BuffType.HEALTH) {
                    healthBuff += allBuffs[i].magnitude;
                } else if (allBuffs[i].buffType == BuffType.ARMOR) {
                    armorBuff += allBuffs[i].magnitude;
                } else if (allBuffs[i].buffType == BuffType.ATTACK) {
                    attackBuff += allBuffs[i].magnitude;
                } else if (allBuffs[i].buffType == BuffType.SPEED) {
                    speedBuff += allBuffs[i].magnitude;
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function getRoundBuffCount(uint256 roundId) external view returns (uint256) {
        return roundBuffs[roundId].length;
    }

    function getViewerStats(address viewer) external view returns (uint256 totalBurned) {
        return viewerBurnedTotal[viewer];
    }

    function getAgentTotalBuffValue(address agent) external view returns (uint256) {
        return agentBuffValue[agent];
    }
}
