// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title BattleNarrator
 * @author Monad Colosseum Team
 * @notice Storytelling layer for arena events - creates dramatic narrative from on-chain actions
 * @dev Stores structured events that frontend can render as dramatic battle commentary
 *
 * "In the shadows of the Monad Colosseum, every action tells a story..."
 */
contract BattleNarrator is AccessControl {
    // ═══════════════════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════════════════

    bytes32 public constant NARRATOR_ROLE = keccak256("NARRATOR_ROLE");

    // ═══════════════════════════════════════════════════════════════════════════
    // ENUMS & STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════

    enum EventType {
        BATTLE_START,       // 0
        ATTACK,             // 1
        DEFEND,             // 2
        BRIBE_OFFERED,      // 3
        BRIBE_ACCEPTED,     // 4
        BETRAYAL,           // 5
        OUTLAW_DECLARED,    // 6
        BOUNTY_CLAIMED,     // 7
        AGENT_DEATH,        // 8
        CHAMPION_CROWNED,   // 9
        BUFF_RECEIVED,      // 10
        DRAMATIC_MOMENT     // 11 - Custom dramatic events
    }

    struct NarrativeEvent {
        EventType eventType;
        address primaryActor;
        address secondaryActor;
        uint256 value;              // MON amount, damage, etc.
        uint256 timestamp;
        uint256 roundId;
        bytes32 metadata;           // Extra data hash
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice All narrative events
    NarrativeEvent[] public timeline;

    /// @notice Events per agent (for agent-specific feeds)
    mapping(address => uint256[]) public agentEvents;

    /// @notice Events per round
    mapping(uint256 => uint256[]) public roundEvents;

    /// @notice Betrayal count per agent (for "The Betrayer" title)
    mapping(address => uint256) public betrayalCount;

    /// @notice Kill count per agent (for "The Executioner" title)
    mapping(address => uint256) public killCount;

    /// @notice Agent titles (earned through actions)
    mapping(address => string) public agentTitle;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event NarrativeRecorded(
        uint256 indexed eventIndex,
        EventType indexed eventType,
        address indexed primaryActor,
        address secondaryActor,
        uint256 value,
        uint256 roundId
    );

    event TitleAwarded(
        address indexed agent,
        string title,
        string reason
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    constructor(address admin, address arena, address escrow) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(NARRATOR_ROLE, arena);
        _grantRole(NARRATOR_ROLE, escrow);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RECORDING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Record a betrayal event - the most dramatic of all!
     */
    function recordBetrayal(
        address betrayer,
        address victim,
        uint256 amount,
        uint256 roundId
    ) external onlyRole(NARRATOR_ROLE) {
        uint256 eventIndex = timeline.length;

        timeline.push(NarrativeEvent({
            eventType: EventType.BETRAYAL,
            primaryActor: betrayer,
            secondaryActor: victim,
            value: amount,
            timestamp: block.timestamp,
            roundId: roundId,
            metadata: keccak256(abi.encodePacked("BETRAYAL", betrayer, victim, amount))
        }));

        agentEvents[betrayer].push(eventIndex);
        agentEvents[victim].push(eventIndex);
        roundEvents[roundId].push(eventIndex);

        // Track betrayal count and award title
        betrayalCount[betrayer]++;
        if (betrayalCount[betrayer] >= 3 && bytes(agentTitle[betrayer]).length == 0) {
            agentTitle[betrayer] = "The Betrayer";
            emit TitleAwarded(betrayer, "The Betrayer", "Betrayed 3 or more agents");
        }

        emit NarrativeRecorded(eventIndex, EventType.BETRAYAL, betrayer, victim, amount, roundId);
    }

    /**
     * @notice Record a bribe acceptance - alliance formed!
     */
    function recordBribeAccepted(
        address offerer,
        address target,
        uint256 amount,
        uint256 roundId
    ) external onlyRole(NARRATOR_ROLE) {
        uint256 eventIndex = timeline.length;

        timeline.push(NarrativeEvent({
            eventType: EventType.BRIBE_ACCEPTED,
            primaryActor: target,
            secondaryActor: offerer,
            value: amount,
            timestamp: block.timestamp,
            roundId: roundId,
            metadata: keccak256(abi.encodePacked("BRIBE", offerer, target, amount))
        }));

        agentEvents[offerer].push(eventIndex);
        agentEvents[target].push(eventIndex);
        roundEvents[roundId].push(eventIndex);

        emit NarrativeRecorded(eventIndex, EventType.BRIBE_ACCEPTED, target, offerer, amount, roundId);
    }

    /**
     * @notice Record an agent becoming an outlaw
     */
    function recordOutlawDeclared(
        address outlaw,
        uint256 bountyAmount,
        uint256 roundId
    ) external onlyRole(NARRATOR_ROLE) {
        uint256 eventIndex = timeline.length;

        timeline.push(NarrativeEvent({
            eventType: EventType.OUTLAW_DECLARED,
            primaryActor: outlaw,
            secondaryActor: address(0),
            value: bountyAmount,
            timestamp: block.timestamp,
            roundId: roundId,
            metadata: keccak256(abi.encodePacked("OUTLAW", outlaw, bountyAmount))
        }));

        agentEvents[outlaw].push(eventIndex);
        roundEvents[roundId].push(eventIndex);

        // Award outlaw title
        agentTitle[outlaw] = "The Outlaw";
        emit TitleAwarded(outlaw, "The Outlaw", "Reputation fell below threshold");

        emit NarrativeRecorded(eventIndex, EventType.OUTLAW_DECLARED, outlaw, address(0), bountyAmount, roundId);
    }

    /**
     * @notice Record an agent death
     */
    function recordDeath(
        address victim,
        address killer,
        uint256 roundId
    ) external onlyRole(NARRATOR_ROLE) {
        uint256 eventIndex = timeline.length;

        timeline.push(NarrativeEvent({
            eventType: EventType.AGENT_DEATH,
            primaryActor: victim,
            secondaryActor: killer,
            value: 0,
            timestamp: block.timestamp,
            roundId: roundId,
            metadata: keccak256(abi.encodePacked("DEATH", victim, killer))
        }));

        agentEvents[victim].push(eventIndex);
        if (killer != address(0)) {
            agentEvents[killer].push(eventIndex);
            killCount[killer]++;

            // Award executioner title
            if (killCount[killer] >= 5 && keccak256(bytes(agentTitle[killer])) != keccak256(bytes("The Betrayer"))) {
                agentTitle[killer] = "The Executioner";
                emit TitleAwarded(killer, "The Executioner", "Eliminated 5 or more agents");
            }
        }
        roundEvents[roundId].push(eventIndex);

        emit NarrativeRecorded(eventIndex, EventType.AGENT_DEATH, victim, killer, 0, roundId);
    }

    /**
     * @notice Record a champion being crowned
     */
    function recordChampion(
        address champion,
        uint256 prizeAmount,
        uint256 roundId
    ) external onlyRole(NARRATOR_ROLE) {
        uint256 eventIndex = timeline.length;

        timeline.push(NarrativeEvent({
            eventType: EventType.CHAMPION_CROWNED,
            primaryActor: champion,
            secondaryActor: address(0),
            value: prizeAmount,
            timestamp: block.timestamp,
            roundId: roundId,
            metadata: keccak256(abi.encodePacked("CHAMPION", champion, prizeAmount))
        }));

        agentEvents[champion].push(eventIndex);
        roundEvents[roundId].push(eventIndex);

        // Champion title (highest honor)
        agentTitle[champion] = "The Champion";
        emit TitleAwarded(champion, "The Champion", "Won the arena battle");

        emit NarrativeRecorded(eventIndex, EventType.CHAMPION_CROWNED, champion, address(0), prizeAmount, roundId);
    }

    /**
     * @notice Record a viewer buff received
     */
    function recordBuffReceived(
        address agent,
        address viewer,
        uint256 buffValue,
        uint256 roundId
    ) external onlyRole(NARRATOR_ROLE) {
        uint256 eventIndex = timeline.length;

        timeline.push(NarrativeEvent({
            eventType: EventType.BUFF_RECEIVED,
            primaryActor: agent,
            secondaryActor: viewer,
            value: buffValue,
            timestamp: block.timestamp,
            roundId: roundId,
            metadata: keccak256(abi.encodePacked("BUFF", agent, viewer, buffValue))
        }));

        agentEvents[agent].push(eventIndex);
        roundEvents[roundId].push(eventIndex);

        emit NarrativeRecorded(eventIndex, EventType.BUFF_RECEIVED, agent, viewer, buffValue, roundId);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Get the last N events (newest first)
     */
    function getTimeline(uint256 limit) external view returns (NarrativeEvent[] memory) {
        uint256 len = timeline.length > limit ? limit : timeline.length;
        NarrativeEvent[] memory events = new NarrativeEvent[](len);

        for (uint256 i = 0; i < len; i++) {
            events[i] = timeline[timeline.length - 1 - i]; // Reverse order
        }

        return events;
    }

    /**
     * @notice Get events for a specific agent
     */
    function getAgentTimeline(address agent, uint256 limit) external view returns (NarrativeEvent[] memory) {
        uint256[] storage eventIndices = agentEvents[agent];
        uint256 len = eventIndices.length > limit ? limit : eventIndices.length;
        NarrativeEvent[] memory events = new NarrativeEvent[](len);

        for (uint256 i = 0; i < len; i++) {
            events[i] = timeline[eventIndices[eventIndices.length - 1 - i]];
        }

        return events;
    }

    /**
     * @notice Get events for a specific round
     */
    function getRoundTimeline(uint256 roundId) external view returns (NarrativeEvent[] memory) {
        uint256[] storage eventIndices = roundEvents[roundId];
        NarrativeEvent[] memory events = new NarrativeEvent[](eventIndices.length);

        for (uint256 i = 0; i < eventIndices.length; i++) {
            events[i] = timeline[eventIndices[i]];
        }

        return events;
    }

    /**
     * @notice Get total event count
     */
    function getEventCount() external view returns (uint256) {
        return timeline.length;
    }

    /**
     * @notice Get agent's earned title
     */
    function getAgentTitle(address agent) external view returns (string memory) {
        return bytes(agentTitle[agent]).length > 0 ? agentTitle[agent] : "Gladiator";
    }

    /**
     * @notice Get agent stats for display
     */
    function getAgentNarrativeStats(address agent) external view returns (
        uint256 eventCount,
        uint256 betrayals,
        uint256 kills,
        string memory title
    ) {
        return (
            agentEvents[agent].length,
            betrayalCount[agent],
            killCount[agent],
            bytes(agentTitle[agent]).length > 0 ? agentTitle[agent] : "Gladiator"
        );
    }
}
