// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BuffOracle
 * @author Monad Colosseum Team
 * @notice Native-MON burn-to-buff system — owners/viewers burn MON to buff agents
 * @dev No external token dependency. MON sent is permanently locked (burned).
 *
 * Flow:
 * 1. Anyone calls applyBuff{ value: monAmount }(agentAddr, buffType)
 * 2. MON is locked in the contract (burned)
 * 3. Buff stored: magnitude = min( (value / 0.1 MON) * 10, 500 )
 * 4. Arena reads active buffs during combat
 * 5. Buffs expire after 3 matches OR 1 hour (whichever first)
 */
contract BuffOracle is AccessControl, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════════════════

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
        address sponsor;        // Who burned MON
        uint96 monBurned;       // Amount of MON burned (in wei)
        BuffType buffType;      // Type of buff
        uint16 magnitude;       // Buff strength (stat points)
        uint40 appliedAt;       // Timestamp
        uint8 matchesRemaining; // Expires when 0
        bool consumed;          // Fully expired?
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice 0.1 MON → 10 magnitude points, 1 MON → 100, 5 MON → 500 (cap)
    uint256 public constant BUFF_MULTIPLIER = 10;
    uint16 public constant MAX_BUFF_MAGNITUDE = 500;
    uint8 public constant BUFF_MATCH_DURATION = 3;
    uint40 public constant BUFF_TIME_DURATION = 3600; // 1 hour

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    mapping(address => Buff[]) public agentBuffs;
    mapping(address => uint256) public agentTotalBurned;
    mapping(address => uint256) public sponsorTotalBurned;
    uint256 public totalBuffs;
    uint256 public totalMonBurned;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event BuffApplied(
        address indexed agent,
        address indexed sponsor,
        uint96 monBurned,
        BuffType buffType,
        uint16 magnitude
    );

    event BuffConsumed(address indexed agent, uint256 buffIndex, BuffType buffType, uint16 magnitude);
    event BuffExpired(address indexed agent, uint256 buffIndex);

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════

    error InvalidAgent();
    error ZeroAmount();

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    constructor(address admin, address arena) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ARENA_ROLE, arena);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CORE — BURN MON TO BUFF
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Burn native MON to give an agent a temporary buff.
     * @param agent The agent address to buff
     * @param buffType HEALTH, ARMOR, ATTACK, or SPEED
     */
    function applyBuff(
        address agent,
        BuffType buffType
    ) external payable nonReentrant {
        if (agent == address(0)) revert InvalidAgent();
        if (msg.value == 0) revert ZeroAmount();

        // magnitude = min( (msg.value / 1e17) * 10, 500 )
        // 0.1 MON (1e17 wei) → 10 pts, 1 MON → 100 pts, 5 MON → 500 (cap)
        uint256 rawMagnitude = (msg.value * BUFF_MULTIPLIER) / 1e17;
        uint16 magnitude = rawMagnitude > MAX_BUFF_MAGNITUDE
            ? MAX_BUFF_MAGNITUDE
            : uint16(rawMagnitude);
        if (magnitude == 0) magnitude = 1;

        agentBuffs[agent].push(Buff({
            agent: agent,
            sponsor: msg.sender,
            monBurned: uint96(msg.value),
            buffType: buffType,
            magnitude: magnitude,
            appliedAt: uint40(block.timestamp),
            matchesRemaining: BUFF_MATCH_DURATION,
            consumed: false
        }));

        agentTotalBurned[agent] += msg.value;
        sponsorTotalBurned[msg.sender] += msg.value;
        totalBuffs++;
        totalMonBurned += msg.value;

        emit BuffApplied(agent, msg.sender, uint96(msg.value), buffType, magnitude);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ARENA INTEGRATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Get aggregated active buffs for an agent (view, no state change)
     */
    function getActiveBuffs(
        address agent
    ) external view returns (
        uint16 healthBuff,
        uint16 armorBuff,
        uint16 attackBuff,
        uint16 speedBuff
    ) {
        Buff[] storage buffs = agentBuffs[agent];
        uint40 now_ = uint40(block.timestamp);

        for (uint256 i = 0; i < buffs.length; i++) {
            Buff storage b = buffs[i];
            if (b.consumed) continue;
            if (b.matchesRemaining == 0) continue;
            if (now_ - b.appliedAt > BUFF_TIME_DURATION) continue;

            if (b.buffType == BuffType.HEALTH) healthBuff += b.magnitude;
            else if (b.buffType == BuffType.ARMOR) armorBuff += b.magnitude;
            else if (b.buffType == BuffType.ATTACK) attackBuff += b.magnitude;
            else if (b.buffType == BuffType.SPEED) speedBuff += b.magnitude;
        }
    }

    /**
     * @notice Consume one match-use of each active buff for an agent.
     * @dev Called by Arena after each match completes.
     */
    function consumeMatchBuffs(address agent) external onlyRole(ARENA_ROLE) {
        Buff[] storage buffs = agentBuffs[agent];
        uint40 now_ = uint40(block.timestamp);

        for (uint256 i = 0; i < buffs.length; i++) {
            Buff storage b = buffs[i];
            if (b.consumed) continue;

            if (now_ - b.appliedAt > BUFF_TIME_DURATION) {
                b.consumed = true;
                emit BuffExpired(agent, i);
                continue;
            }

            if (b.matchesRemaining > 0) {
                b.matchesRemaining--;
                emit BuffConsumed(agent, i, b.buffType, b.magnitude);
                if (b.matchesRemaining == 0) {
                    b.consumed = true;
                    emit BuffExpired(agent, i);
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function getAgentBuffCount(address agent) external view returns (uint256) {
        return agentBuffs[agent].length;
    }

    function getAgentBuff(address agent, uint256 index) external view returns (Buff memory) {
        return agentBuffs[agent][index];
    }

    function getSponsorStats(address sponsor) external view returns (uint256) {
        return sponsorTotalBurned[sponsor];
    }

    // No withdraw — MON is permanently burned/locked
}
