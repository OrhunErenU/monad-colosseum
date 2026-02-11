// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IBattleNarrator
 * @notice Interface for the Battle Narrator storytelling contract
 */
interface IBattleNarrator {
    function recordBetrayal(
        address betrayer,
        address victim,
        uint256 amount,
        uint256 roundId
    ) external;

    function recordBribeAccepted(
        address offerer,
        address target,
        uint256 amount,
        uint256 roundId
    ) external;

    function recordOutlawDeclared(
        address outlaw,
        uint256 bountyAmount,
        uint256 roundId
    ) external;

    function recordDeath(
        address victim,
        address killer,
        uint256 roundId
    ) external;

    function recordChampion(
        address champion,
        uint256 prizeAmount,
        uint256 roundId
    ) external;

    function recordBuffReceived(
        address agent,
        address viewer,
        uint256 buffValue,
        uint256 roundId
    ) external;
}
