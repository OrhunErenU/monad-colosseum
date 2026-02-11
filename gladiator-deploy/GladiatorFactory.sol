// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

contract GladiatorFactory {
    // ============ Enums ============
    enum Phase { Waiting, Commit, Reveal, Settled, Finished }

    // ============ Structs ============
    struct Gladiator {
        address owner;
        bytes32 strategyHash;
        uint256 stake;
        uint8 lastMove; // 0=None, 1=Cooperate, 2=Defect
        bool isRevealed;
        bool hasCommitted;
        int256 score;
    }

    struct Arena {
        uint256 id;
        uint256 entryFee;
        uint256 totalPool;
        uint8 maxPlayers;
        uint8 playerCount;
        uint8 currentRound;
        uint8 totalRounds;
        uint256 phaseDeadline;
        Phase phase;
    }

    // ============ State Variables ============
    mapping(uint256 => Arena) public arenas;
    mapping(uint256 => mapping(uint8 => address)) public arenaPlayers;
    mapping(uint256 => mapping(address => Gladiator)) public gladiators;
    mapping(uint256 => mapping(address => bytes32)) public commits;
    mapping(uint256 => uint8) public commitCount;
    mapping(uint256 => uint8) public revealCount;
    mapping(uint256 => mapping(address => uint256)) public pendingRewards;
    uint256 public nextArenaId;

    // Spectator bet state
    mapping(uint256 => mapping(address => address)) public bets;
    mapping(uint256 => mapping(address => uint256)) public betAmounts;
    mapping(uint256 => uint256) public betPool;
    mapping(uint256 => uint8) public betCount;
    mapping(uint256 => mapping(uint8 => address)) public bettors;

    // ============ Reentrancy Guard ============
    bool private _locked;

    modifier nonReentrant() {
        require(!_locked, "ReentrancyGuard: reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    // ============ Events ============
    event ArenaCreated(uint256 indexed arenaId, uint256 fee, uint8 maxPlayers, uint8 totalRounds);
    event GladiatorJoined(uint256 indexed arenaId, address indexed player, bytes32 strategyHash);
    event MoveCommitted(uint256 indexed arenaId, address indexed player, bytes32 commitHash);
    event MoveRevealed(uint256 indexed arenaId, address indexed player, uint8 move, uint256 blockNumber);
    event RoundSettled(uint256 indexed arenaId, uint8 round, uint256 timestamp);
    event ArenaFinished(uint256 indexed arenaId, address indexed winner, uint256 prize);
    event RewardClaimed(uint256 indexed arenaId, address indexed player, uint256 amount);
    event BetPlaced(uint256 indexed arenaId, address indexed bettor, address predictedWinner, uint256 amount);

    // ============ External Functions ============

    function createArena(
        uint256 _entryFee,
        uint8 _maxPlayers,
        uint8 _totalRounds
    ) external returns (uint256) {
        require(_maxPlayers >= 2 && _maxPlayers <= 10, "Invalid maxPlayers");
        require(_totalRounds >= 1 && _totalRounds <= 10, "Invalid totalRounds");

        uint256 arenaId = nextArenaId++;

        arenas[arenaId] = Arena({
            id: arenaId,
            entryFee: _entryFee,
            totalPool: 0,
            maxPlayers: _maxPlayers,
            playerCount: 0,
            currentRound: 0,
            totalRounds: _totalRounds,
            phaseDeadline: 0,
            phase: Phase.Waiting
        });

        emit ArenaCreated(arenaId, _entryFee, _maxPlayers, _totalRounds);
        return arenaId;
    }

    function enterArena(uint256 _arenaId, bytes32 _strategyHash) external payable {
        Arena storage arena = arenas[_arenaId];
        
        require(arena.phase == Phase.Waiting, "Arena not in Waiting phase");
        require(msg.value == arena.entryFee, "Incorrect entry fee");
        require(gladiators[_arenaId][msg.sender].owner == address(0), "Already joined");

        gladiators[_arenaId][msg.sender] = Gladiator({
            owner: msg.sender,
            strategyHash: _strategyHash,
            stake: msg.value,
            lastMove: 0,
            isRevealed: false,
            hasCommitted: false,
            score: 0
        });

        arenaPlayers[_arenaId][arena.playerCount] = msg.sender;
        arena.playerCount++;
        arena.totalPool += msg.value;

        if (arena.playerCount == arena.maxPlayers) {
            arena.phase = Phase.Commit;
            arena.phaseDeadline = block.timestamp + 30;
        }

        emit GladiatorJoined(_arenaId, msg.sender, _strategyHash);
    }

    function commitMove(uint256 _arenaId, bytes32 _commitHash) external {
        Arena storage arena = arenas[_arenaId];

        require(arena.phase == Phase.Commit, "Not in Commit phase");
        require(block.timestamp <= arena.phaseDeadline, "Commit phase expired");
        require(gladiators[_arenaId][msg.sender].owner != address(0), "Not a player");
        require(!gladiators[_arenaId][msg.sender].hasCommitted, "Already committed");

        commits[_arenaId][msg.sender] = _commitHash;
        gladiators[_arenaId][msg.sender].hasCommitted = true;
        commitCount[_arenaId]++;

        if (commitCount[_arenaId] == arena.playerCount) {
            arena.phase = Phase.Reveal;
            arena.phaseDeadline = block.timestamp + 15;
        }

        emit MoveCommitted(_arenaId, msg.sender, _commitHash);
    }

    function revealMove(uint256 _arenaId, uint8 _move, bytes32 _nonce) external {
        Arena storage arena = arenas[_arenaId];

        require(arena.phase == Phase.Reveal, "Not in Reveal phase");
        require(block.timestamp <= arena.phaseDeadline, "Reveal phase expired");
        require(_move == 1 || _move == 2, "Invalid move");
        require(
            keccak256(abi.encodePacked(_move, _nonce)) == commits[_arenaId][msg.sender],
            "Invalid reveal"
        );
        require(!gladiators[_arenaId][msg.sender].isRevealed, "Already revealed");

        gladiators[_arenaId][msg.sender].lastMove = _move;
        gladiators[_arenaId][msg.sender].isRevealed = true;
        revealCount[_arenaId]++;

        emit MoveRevealed(_arenaId, msg.sender, _move, block.number);

        if (revealCount[_arenaId] == arena.playerCount) {
            _settleRound(_arenaId);
        }
    }

    function placeBet(uint256 _arenaId, address _predictedWinner) external payable {
        Arena storage arena = arenas[_arenaId];

        require(msg.value >= 0.01 ether, "Minimum bet is 0.01 ether");
        require(arena.phase != Phase.Finished && arena.phase != Phase.Waiting, "Betting not allowed");
        require(gladiators[_arenaId][_predictedWinner].owner != address(0), "Invalid player");
        require(bets[_arenaId][msg.sender] == address(0), "Already placed bet");

        bets[_arenaId][msg.sender] = _predictedWinner;
        betAmounts[_arenaId][msg.sender] = msg.value;
        bettors[_arenaId][betCount[_arenaId]] = msg.sender;
        betCount[_arenaId]++;
        betPool[_arenaId] += msg.value;

        emit BetPlaced(_arenaId, msg.sender, _predictedWinner, msg.value);
    }

    function forceSettle(uint256 _arenaId) external {
        Arena storage arena = arenas[_arenaId];
        
        require(block.timestamp > arena.phaseDeadline, "Phase not expired");
        require(arena.phase == Phase.Commit || arena.phase == Phase.Reveal, "Invalid phase");

        uint8 playerCount = arena.playerCount;

        if (arena.phase == Phase.Commit) {
            for (uint8 i = 0; i < playerCount; i++) {
                address player = arenaPlayers[_arenaId][i];
                if (!gladiators[_arenaId][player].hasCommitted) {
                    gladiators[_arenaId][player].score -= 30;
                    gladiators[_arenaId][player].lastMove = 1;
                    gladiators[_arenaId][player].hasCommitted = true;
                    gladiators[_arenaId][player].isRevealed = true;
                } else {
                    gladiators[_arenaId][player].lastMove = 1;
                    gladiators[_arenaId][player].isRevealed = true;
                }
            }
        } else if (arena.phase == Phase.Reveal) {
            for (uint8 i = 0; i < playerCount; i++) {
                address player = arenaPlayers[_arenaId][i];
                if (!gladiators[_arenaId][player].isRevealed) {
                    gladiators[_arenaId][player].score -= 30;
                    gladiators[_arenaId][player].lastMove = 1;
                    gladiators[_arenaId][player].isRevealed = true;
                }
            }
        }

        _settleRound(_arenaId);
    }

    function claimReward(uint256 _arenaId) external nonReentrant {
        uint256 amount = pendingRewards[_arenaId][msg.sender];
        require(amount > 0, "No reward to claim");

        pendingRewards[_arenaId][msg.sender] = 0;
        
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        emit RewardClaimed(_arenaId, msg.sender, amount);
    }

    // ============ Internal Functions ============

    function _settleRound(uint256 _arenaId) internal {
        Arena storage arena = arenas[_arenaId];
        uint8 playerCount = arena.playerCount;

        for (uint8 i = 0; i < playerCount; i++) {
            for (uint8 j = i + 1; j < playerCount; j++) {
                address playerI = arenaPlayers[_arenaId][i];
                address playerJ = arenaPlayers[_arenaId][j];

                uint8 moveI = gladiators[_arenaId][playerI].lastMove;
                uint8 moveJ = gladiators[_arenaId][playerJ].lastMove;

                if (moveI == 1 && moveJ == 1) {
                    gladiators[_arenaId][playerI].score += 15;
                    gladiators[_arenaId][playerJ].score += 15;
                } else if (moveI == 2 && moveJ == 1) {
                    gladiators[_arenaId][playerI].score += 30;
                    gladiators[_arenaId][playerJ].score -= 20;
                } else if (moveI == 1 && moveJ == 2) {
                    gladiators[_arenaId][playerI].score -= 20;
                    gladiators[_arenaId][playerJ].score += 30;
                } else if (moveI == 2 && moveJ == 2) {
                    gladiators[_arenaId][playerI].score -= 10;
                    gladiators[_arenaId][playerJ].score -= 10;
                }
            }
        }

        arena.currentRound++;

        emit RoundSettled(_arenaId, arena.currentRound, block.timestamp);

        if (arena.currentRound >= arena.totalRounds) {
            _finishArena(_arenaId);
        } else {
            arena.phase = Phase.Commit;
            arena.phaseDeadline = block.timestamp + 30;

            for (uint8 i = 0; i < playerCount; i++) {
                address player = arenaPlayers[_arenaId][i];
                gladiators[_arenaId][player].hasCommitted = false;
                gladiators[_arenaId][player].isRevealed = false;
                gladiators[_arenaId][player].lastMove = 0;
            }
            commitCount[_arenaId] = 0;
            revealCount[_arenaId] = 0;
        }
    }

    function _finishArena(uint256 _arenaId) internal {
        Arena storage arena = arenas[_arenaId];
        arena.phase = Phase.Finished;

        uint8 playerCount = arena.playerCount;
        int256 highestScore = type(int256).min;
        uint8 winnerCount = 0;
        address firstWinner;

        for (uint8 i = 0; i < playerCount; i++) {
            address player = arenaPlayers[_arenaId][i];
            int256 score = gladiators[_arenaId][player].score;
            if (score > highestScore) {
                highestScore = score;
                winnerCount = 1;
                firstWinner = player;
            } else if (score == highestScore) {
                winnerCount++;
            }
        }

        uint256 prizePerWinner = arena.totalPool / winnerCount;
        for (uint8 i = 0; i < playerCount; i++) {
            address player = arenaPlayers[_arenaId][i];
            if (gladiators[_arenaId][player].score == highestScore) {
                pendingRewards[_arenaId][player] += prizePerWinner;
            }
        }

        // Spectator bet settlement
        if (betPool[_arenaId] > 0) {
            uint256 totalCorrectBets = 0;
            uint8 numBettors = betCount[_arenaId];

            for (uint8 i = 0; i < numBettors; i++) {
                address bettor = bettors[_arenaId][i];
                address predicted = bets[_arenaId][bettor];
                if (gladiators[_arenaId][predicted].score == highestScore) {
                    totalCorrectBets += betAmounts[_arenaId][bettor];
                }
            }

            if (totalCorrectBets > 0) {
                for (uint8 i = 0; i < numBettors; i++) {
                    address bettor = bettors[_arenaId][i];
                    address predicted = bets[_arenaId][bettor];
                    if (gladiators[_arenaId][predicted].score == highestScore) {
                        uint256 reward = (betAmounts[_arenaId][bettor] * betPool[_arenaId]) / totalCorrectBets;
                        pendingRewards[_arenaId][bettor] += reward;
                    }
                }
            }
        }

        emit ArenaFinished(_arenaId, firstWinner, arena.totalPool);
    }

    // ============ View Functions ============

    function getArenaInfo(uint256 _arenaId) external view returns (
        uint256 id,
        uint256 entryFee,
        uint256 totalPool,
        uint8 maxPlayers,
        uint8 playerCount,
        uint8 currentRound,
        uint8 totalRounds,
        uint256 phaseDeadline,
        Phase phase
    ) {
        Arena storage arena = arenas[_arenaId];
        return (
            arena.id,
            arena.entryFee,
            arena.totalPool,
            arena.maxPlayers,
            arena.playerCount,
            arena.currentRound,
            arena.totalRounds,
            arena.phaseDeadline,
            arena.phase
        );
    }

    function getGladiator(uint256 _arenaId, address _player) external view returns (Gladiator memory) {
        return gladiators[_arenaId][_player];
    }

    function getPlayers(uint256 _arenaId) external view returns (address[] memory) {
        uint8 playerCount = arenas[_arenaId].playerCount;
        address[] memory players = new address[](playerCount);
        
        for (uint8 i = 0; i < playerCount; i++) {
            players[i] = arenaPlayers[_arenaId][i];
        }
        
        return players;
    }

    function getScores(uint256 _arenaId) external view returns (
        address[] memory players,
        int256[] memory scores
    ) {
        uint8 playerCount = arenas[_arenaId].playerCount;
        players = new address[](playerCount);
        scores = new int256[](playerCount);
        
        for (uint8 i = 0; i < playerCount; i++) {
            address player = arenaPlayers[_arenaId][i];
            players[i] = player;
            scores[i] = gladiators[_arenaId][player].score;
        }
        
        return (players, scores);
    }
}
