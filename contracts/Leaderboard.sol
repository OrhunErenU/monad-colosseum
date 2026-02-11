// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title Leaderboard
 * @author Monad Colosseum Team
 * @notice On-chain ELO leaderboard with category rankings
 * @dev Tracks multiple ranking categories:
 *      - ELO rating (overall skill)
 *      - Most wins
 *      - Highest earnings
 *      - Most betrayals
 *      - Most bribes given
 *      - Longest win streak
 */
contract Leaderboard is AccessControl {
    // ═══════════════════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════════════════

    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");

    // ═══════════════════════════════════════════════════════════════════════════
    // ENUMS
    // ═══════════════════════════════════════════════════════════════════════════

    enum TimePeriod {
        ALL_TIME,   // 0
        WEEKLY,     // 1
        DAILY       // 2
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════

    struct LeaderboardEntry {
        uint256 agentId;
        address agentWallet;
        string agentName;
        int256 eloRating;
        uint256 totalWins;
        uint256 totalMatches;
        uint256 totalEarnings;
        uint256 betrayalCount;
        uint256 bribeCount;
        uint256 currentStreak;
        uint256 bestStreak;
        uint256 lastUpdated;
    }

    struct SeasonInfo {
        uint256 seasonId;
        uint256 startTime;
        uint256 endTime;
        bool isActive;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Agent stats by agentId
    mapping(uint256 => LeaderboardEntry) public entries;

    /// @notice Weekly stats reset tracker
    mapping(uint256 => mapping(uint256 => LeaderboardEntry)) public weeklyEntries;

    /// @notice Current season
    SeasonInfo public currentSeason;

    /// @notice Season history
    mapping(uint256 => SeasonInfo) public seasons;

    /// @notice Total entries
    uint256 public totalEntries;

    /// @notice Current week number
    uint256 public currentWeek;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event EntryUpdated(
        uint256 indexed agentId,
        int256 newElo,
        uint256 totalWins,
        uint256 totalMatches
    );

    event MatchRecorded(
        uint256 indexed winnerId,
        uint256 indexed loserId,
        uint256 matchId,
        int256 winnerNewElo,
        int256 loserNewElo
    );

    event BetrayalRecorded(uint256 indexed agentId, uint256 totalBetrayals);
    event BribeRecorded(uint256 indexed agentId, uint256 totalBribes);
    event StreakUpdated(uint256 indexed agentId, uint256 currentStreak, uint256 bestStreak);
    event SeasonStarted(uint256 indexed seasonId, uint256 startTime, uint256 endTime);
    event SeasonEnded(uint256 indexed seasonId, uint256[] topAgents);

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPDATER_ROLE, admin);
        currentWeek = block.timestamp / 1 weeks;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CORE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Initialize or update an agent's leaderboard entry
     */
    function initializeEntry(
        uint256 agentId,
        address agentWallet,
        string calldata agentName,
        int256 initialElo
    ) external onlyRole(UPDATER_ROLE) {
        if (entries[agentId].agentId == 0) {
            totalEntries++;
        }

        entries[agentId] = LeaderboardEntry({
            agentId: agentId,
            agentWallet: agentWallet,
            agentName: agentName,
            eloRating: initialElo,
            totalWins: 0,
            totalMatches: 0,
            totalEarnings: 0,
            betrayalCount: 0,
            bribeCount: 0,
            currentStreak: 0,
            bestStreak: 0,
            lastUpdated: block.timestamp
        });
    }

    /**
     * @notice Record a match result
     */
    function recordMatch(
        uint256 winnerId,
        uint256 loserId,
        uint256 matchId,
        int256 winnerNewElo,
        int256 loserNewElo,
        uint256 earningsAmount
    ) external onlyRole(UPDATER_ROLE) {
        // Update winner
        LeaderboardEntry storage winner = entries[winnerId];
        winner.eloRating = winnerNewElo;
        winner.totalWins++;
        winner.totalMatches++;
        winner.totalEarnings += earningsAmount;
        winner.currentStreak++;
        if (winner.currentStreak > winner.bestStreak) {
            winner.bestStreak = winner.currentStreak;
        }
        winner.lastUpdated = block.timestamp;

        // Update loser
        LeaderboardEntry storage loser = entries[loserId];
        loser.eloRating = loserNewElo;
        loser.totalMatches++;
        loser.currentStreak = 0;
        loser.lastUpdated = block.timestamp;

        emit MatchRecorded(winnerId, loserId, matchId, winnerNewElo, loserNewElo);
        emit StreakUpdated(winnerId, winner.currentStreak, winner.bestStreak);
        emit EntryUpdated(winnerId, winnerNewElo, winner.totalWins, winner.totalMatches);
        emit EntryUpdated(loserId, loserNewElo, loser.totalWins, loser.totalMatches);
    }

    /**
     * @notice Record a betrayal
     */
    function recordBetrayal(uint256 agentId) external onlyRole(UPDATER_ROLE) {
        entries[agentId].betrayalCount++;
        entries[agentId].lastUpdated = block.timestamp;
        emit BetrayalRecorded(agentId, entries[agentId].betrayalCount);
    }

    /**
     * @notice Record a bribe
     */
    function recordBribe(uint256 agentId) external onlyRole(UPDATER_ROLE) {
        entries[agentId].bribeCount++;
        entries[agentId].lastUpdated = block.timestamp;
        emit BribeRecorded(agentId, entries[agentId].bribeCount);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function getEntry(uint256 agentId) external view returns (LeaderboardEntry memory) {
        return entries[agentId];
    }

    /**
     * @notice Get top agents by ELO
     */
    function getTopByElo(uint256 limit) external view returns (LeaderboardEntry[] memory) {
        uint256 count = totalEntries < limit ? totalEntries : limit;
        LeaderboardEntry[] memory top = new LeaderboardEntry[](count);
        int256[] memory topElos = new int256[](count);

        for (uint256 i = 1; i <= totalEntries; i++) {
            LeaderboardEntry memory entry = entries[i];
            if (entry.agentId == 0) continue;

            for (uint256 j = 0; j < count; j++) {
                if (entry.eloRating > topElos[j]) {
                    // Shift down
                    for (uint256 k = count - 1; k > j; k--) {
                        top[k] = top[k - 1];
                        topElos[k] = topElos[k - 1];
                    }
                    top[j] = entry;
                    topElos[j] = entry.eloRating;
                    break;
                }
            }
        }

        return top;
    }

    /**
     * @notice Get top agents by wins
     */
    function getTopByWins(uint256 limit) external view returns (LeaderboardEntry[] memory) {
        uint256 count = totalEntries < limit ? totalEntries : limit;
        LeaderboardEntry[] memory top = new LeaderboardEntry[](count);
        uint256[] memory topWins = new uint256[](count);

        for (uint256 i = 1; i <= totalEntries; i++) {
            LeaderboardEntry memory entry = entries[i];
            if (entry.agentId == 0) continue;

            for (uint256 j = 0; j < count; j++) {
                if (entry.totalWins > topWins[j]) {
                    for (uint256 k = count - 1; k > j; k--) {
                        top[k] = top[k - 1];
                        topWins[k] = topWins[k - 1];
                    }
                    top[j] = entry;
                    topWins[j] = entry.totalWins;
                    break;
                }
            }
        }

        return top;
    }

    /**
     * @notice Get top betrayers
     */
    function getTopBetrayers(uint256 limit) external view returns (LeaderboardEntry[] memory) {
        uint256 count = totalEntries < limit ? totalEntries : limit;
        LeaderboardEntry[] memory top = new LeaderboardEntry[](count);
        uint256[] memory topBetrayals = new uint256[](count);

        for (uint256 i = 1; i <= totalEntries; i++) {
            LeaderboardEntry memory entry = entries[i];
            if (entry.agentId == 0) continue;

            for (uint256 j = 0; j < count; j++) {
                if (entry.betrayalCount > topBetrayals[j]) {
                    for (uint256 k = count - 1; k > j; k--) {
                        top[k] = top[k - 1];
                        topBetrayals[k] = topBetrayals[k - 1];
                    }
                    top[j] = entry;
                    topBetrayals[j] = entry.betrayalCount;
                    break;
                }
            }
        }

        return top;
    }

    /**
     * @notice Get agent rank by ELO
     */
    function getAgentRank(uint256 agentId) external view returns (uint256 rank) {
        int256 targetElo = entries[agentId].eloRating;
        rank = 1;
        
        for (uint256 i = 1; i <= totalEntries; i++) {
            if (i != agentId && entries[i].agentId != 0 && entries[i].eloRating > targetElo) {
                rank++;
            }
        }
    }

    /**
     * @notice Get win rate for an agent
     */
    function getWinRate(uint256 agentId) external view returns (uint256) {
        LeaderboardEntry memory entry = entries[agentId];
        if (entry.totalMatches == 0) return 0;
        return (entry.totalWins * 10000) / entry.totalMatches; // Basis points
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SEASON MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    function startSeason(uint256 duration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 seasonId = currentSeason.seasonId + 1;
        
        currentSeason = SeasonInfo({
            seasonId: seasonId,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            isActive: true
        });

        seasons[seasonId] = currentSeason;
        emit SeasonStarted(seasonId, block.timestamp, block.timestamp + duration);
    }

    // Allow receiving MON
    receive() external payable {}
}
