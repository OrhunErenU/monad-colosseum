// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/**
 * @title GladiatorFactory
 * @notice AI Gladiator arena with ERC721 NFT integration
 * @dev Each gladiator is minted as an NFT when entering an arena
 */
contract GladiatorFactory is ERC721, ERC721URIStorage, Ownable, ReentrancyGuard, Pausable, AccessControl {
    using Strings for uint256;
    using Strings for int256;

    // ============ Enums ============
    enum Phase { Waiting, Commit, Reveal, Settled, Finished }

    // ============ Structs ============
    struct Gladiator {
        uint256 tokenId;        // NFT Token ID
        address owner;
        bytes32 strategyHash;
        string strategyName;    // Strategy name for metadata
        uint256 stake;
        uint8 lastMove;         // 0=None, 1=Cooperate, 2=Defect
        bool isRevealed;
        bool hasCommitted;
        int256 score;
        uint256 totalWins;      // Lifetime wins
        uint256 totalEarnings;  // Lifetime earnings
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
        string tier;                 // 'bronze', 'silver', 'gold'
        uint256 winnerBonusPercent;   // e.g. 20 = 20%
        uint256 redistributionPercent; // e.g. 80 = 80%
    }

    // ============ NFT State Variables ============
    uint256 public nextTokenId;
    mapping(uint256 => uint256) public tokenToArena;  // tokenId => arenaId
    mapping(address => uint256[]) public ownerTokens; // owner => tokenIds

    // ============ Arena State Variables ============
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

    // ============ Access Control Roles ============
    bytes32 public constant ARENA_ADMIN = keccak256("ARENA_ADMIN");
    bytes32 public constant EMERGENCY_OPERATOR = keccak256("EMERGENCY_OPERATOR");

    // ============ Events ============
    event ArenaCreated(uint256 indexed arenaId, uint256 fee, uint8 maxPlayers, uint8 totalRounds, string tier);
    event GladiatorMinted(uint256 indexed tokenId, address indexed owner, uint256 indexed arenaId, string strategyName);
    event GladiatorJoined(uint256 indexed arenaId, address indexed player, uint256 tokenId, bytes32 strategyHash);
    event MoveCommitted(uint256 indexed arenaId, address indexed player, bytes32 commitHash);
    event MoveRevealed(uint256 indexed arenaId, address indexed player, uint8 move, uint256 blockNumber);
    event RoundSettled(uint256 indexed arenaId, uint8 round, uint256 timestamp);
    event ArenaFinished(
        uint256 indexed arenaId,
        uint8 winnerCount,
        uint256 totalPool,
        uint256 winnerBonus,
        uint256 redistributionPerPlayer
    );
    event RewardClaimed(uint256 indexed arenaId, address indexed player, uint256 amount);
    event BetPlaced(uint256 indexed arenaId, address indexed bettor, address predictedWinner, uint256 amount);

    // ============ Constructor ============
    constructor() ERC721("Gladiator", "GLAD") Ownable(msg.sender) {
        // Grant all admin roles to deployer
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ARENA_ADMIN, msg.sender);
        _grantRole(EMERGENCY_OPERATOR, msg.sender);
    }

    // ============ NFT Functions ============

    /**
     * @notice Mint a new Gladiator NFT
     * @param to The address to mint to
     * @param strategyName The name of the strategy
     * @param arenaId The arena the gladiator is joining
     * @return tokenId The new token ID
     */
    function _mintGladiator(
        address to, 
        string memory strategyName,
        uint256 arenaId
    ) internal returns (uint256) {
        uint256 tokenId = nextTokenId++;
        _safeMint(to, tokenId);
        
        tokenToArena[tokenId] = arenaId;
        ownerTokens[to].push(tokenId);

        emit GladiatorMinted(tokenId, to, arenaId, strategyName);
        return tokenId;
    }

    /**
     * @notice Generate on-chain metadata for a gladiator
     * @param tokenId The token ID
     * @return The token URI with base64 encoded JSON
     */
    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        require(ownerOf(tokenId) != address(0), "Token does not exist");

        uint256 arenaId = tokenToArena[tokenId];
        address gladOwner = ownerOf(tokenId);
        Gladiator memory glad = gladiators[arenaId][gladOwner];
        Arena memory arena = arenas[arenaId];

        string memory scoreStr = glad.score >= 0 
            ? uint256(glad.score).toString() 
            : string(abi.encodePacked("-", uint256(-glad.score).toString()));

        string memory json = string(abi.encodePacked(
            '{"name": "Gladiator #', tokenId.toString(), '",',
            '"description": "AI Gladiator from Monad Colosseum",',
            '"image": "https://via.placeholder.com/500/1a1a2e/ffffff?text=GLAD%23', tokenId.toString(), '",',
            '"attributes": [',
                '{"trait_type": "Strategy", "value": "', glad.strategyName, '"},',
                '{"trait_type": "Tier", "value": "', arena.tier, '"},',
                '{"trait_type": "Score", "value": ', scoreStr, '},',
                '{"trait_type": "Wins", "value": ', glad.totalWins.toString(), '},',
                '{"trait_type": "Earnings", "value": ', glad.totalEarnings.toString(), '},',
                '{"trait_type": "Arena ID", "value": ', arenaId.toString(), '}',
            ']}'
        ));

        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }

    /**
     * @notice Get all tokens owned by an address
     * @param owner The owner address
     * @return Array of token IDs
     */
    function getTokensByOwner(address owner) external view returns (uint256[] memory) {
        return ownerTokens[owner];
    }

    // ============ Arena Functions ============

    /**
     * @notice Create a new arena with the given parameters.
     * @dev    Only callable when contract is not paused. Protected against reentrancy.
     * @param _entryFee    Entry fee in wei that each player must pay
     * @param _maxPlayers  Maximum number of players (2-10)
     * @param _totalRounds Total rounds of the Prisoner's Dilemma game (1-10)
     * @return The newly created arena ID
     */
    function createArena(
        uint256 _entryFee,
        uint8 _maxPlayers,
        uint8 _totalRounds
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(_maxPlayers >= 2 && _maxPlayers <= 10, "Invalid maxPlayers");
        require(_totalRounds >= 1 && _totalRounds <= 10, "Invalid totalRounds");

        uint256 arenaId = nextArenaId++;

        // Determine tier based on entry fee
        string memory tier = "bronze";
        if (_entryFee >= 100 ether) {
            tier = "gold";
        } else if (_entryFee >= 10 ether) {
            tier = "silver";
        }

        arenas[arenaId] = Arena({
            id: arenaId,
            entryFee: _entryFee,
            totalPool: 0,
            maxPlayers: _maxPlayers,
            playerCount: 0,
            currentRound: 0,
            totalRounds: _totalRounds,
            phaseDeadline: 0,
            phase: Phase.Waiting,
            tier: tier,
            winnerBonusPercent: 20,
            redistributionPercent: 80
        });

        emit ArenaCreated(arenaId, _entryFee, _maxPlayers, _totalRounds, tier);
        return arenaId;
    }

    /**
     * @notice Enter an arena as a gladiator. Mints an NFT for the player.
     * @dev    Only callable when contract is not paused. Protected against reentrancy.
     *         Requires exact entry fee to be sent as msg.value.
     * @param _arenaId       The ID of the arena to join
     * @param _strategyHash  keccak256 hash of the player's strategy for commit-reveal
     * @param _strategyName  Human-readable strategy name stored in NFT metadata
     */
    function enterArena(
        uint256 _arenaId, 
        bytes32 _strategyHash,
        string memory _strategyName
    ) external payable nonReentrant whenNotPaused {
        Arena storage arena = arenas[_arenaId];
        
        require(arena.phase == Phase.Waiting, "Arena not in Waiting phase");
        require(msg.value == arena.entryFee, "Incorrect entry fee");
        require(gladiators[_arenaId][msg.sender].owner == address(0), "Already joined");

        // Mint NFT for the gladiator
        uint256 tokenId = _mintGladiator(msg.sender, _strategyName, _arenaId);

        gladiators[_arenaId][msg.sender] = Gladiator({
            tokenId: tokenId,
            owner: msg.sender,
            strategyHash: _strategyHash,
            strategyName: _strategyName,
            stake: msg.value,
            lastMove: 0,
            isRevealed: false,
            hasCommitted: false,
            score: 0,
            totalWins: 0,
            totalEarnings: 0
        });

        arenaPlayers[_arenaId][arena.playerCount] = msg.sender;
        arena.playerCount++;
        arena.totalPool += msg.value;

        if (arena.playerCount == arena.maxPlayers) {
            arena.phase = Phase.Commit;
            arena.phaseDeadline = block.timestamp + 30;
        }

        emit GladiatorJoined(_arenaId, msg.sender, tokenId, _strategyHash);
    }

    /**
     * @notice Commit a hashed move for the current round.
     * @dev    Player must be in the arena and not have committed yet.
     *         Automatically advances to Reveal phase when all players commit.
     * @param _arenaId    The arena ID
     * @param _commitHash keccak256(abi.encodePacked(move, nonce))
     */
    function commitMove(uint256 _arenaId, bytes32 _commitHash) external whenNotPaused {
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

    /**
     * @notice Reveal a previously committed move.
     * @dev    The hash of (move, nonce) must match the stored commit.
     *         Automatically settles the round when all players reveal.
     * @param _arenaId The arena ID
     * @param _move    1 = Cooperate, 2 = Defect
     * @param _nonce   The secret nonce used during commit
     */
    function revealMove(uint256 _arenaId, uint8 _move, bytes32 _nonce) external whenNotPaused {
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

    /**
     * @notice Place a spectator bet on the predicted winner of an arena.
     * @dev    Minimum bet is 0.01 ether. Each spectator can only bet once per arena.
     * @param _arenaId         The arena to bet on
     * @param _predictedWinner Address of the player predicted to win
     */
    function placeBet(uint256 _arenaId, address _predictedWinner) external payable whenNotPaused {
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

    /**
     * @notice Force-settle a round when the phase deadline has expired.
     * @dev    Players who did not commit/reveal receive a -30 score penalty
     *         and are assumed to have played Cooperate. Anyone can call this
     *         after the deadline passes.
     * @param _arenaId The arena ID to force-settle
     */
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

    /**
     * @notice Claim accumulated rewards from a finished arena.
     * @dev    Uses OpenZeppelin ReentrancyGuard to prevent reentrancy attacks.
     *         Follows checks-effects-interactions pattern.
     * @param _arenaId The arena ID to claim rewards from
     */
    function claimReward(uint256 _arenaId) external nonReentrant {
        uint256 amount = pendingRewards[_arenaId][msg.sender];
        require(amount > 0, "No reward to claim");

        pendingRewards[_arenaId][msg.sender] = 0;
        
        // Update gladiator earnings
        gladiators[_arenaId][msg.sender].totalEarnings += amount;
        
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

    /**
     * @notice Finish an arena using the Redistribution Economy model.
     *
     *  Pool split:
     *    - winnerBonusPercent  (default 20%) → split equally among highest-score players
     *    - redistributionPercent (default 80%) → split equally among ALL players
     *
     *  This ensures no player walks away with nothing.
     */
    function _finishArena(uint256 _arenaId) internal {
        Arena storage arena = arenas[_arenaId];
        arena.phase = Phase.Finished;

        uint8 playerCount = arena.playerCount;
        require(playerCount > 0, "No players in arena");

        // ── Step 1: Find highest score & winner count ──
        int256 highestScore = type(int256).min;
        uint8 winnerCount = 0;

        for (uint8 i = 0; i < playerCount; i++) {
            address player = arenaPlayers[_arenaId][i];
            int256 score = gladiators[_arenaId][player].score;
            if (score > highestScore) {
                highestScore = score;
                winnerCount = 1;
            } else if (score == highestScore) {
                winnerCount++;
            }
        }

        // ── Step 2: Calculate redistribution pools ──
        uint256 winnerBonusPool = (arena.totalPool * arena.winnerBonusPercent) / 100;
        uint256 redistributionPool = arena.totalPool - winnerBonusPool;
        uint256 redistributionPerPlayer = redistributionPool / playerCount;
        uint256 winnerBonusEach = winnerBonusPool / winnerCount;

        // ── Step 3: Distribute rewards ──
        for (uint8 i = 0; i < playerCount; i++) {
            address player = arenaPlayers[_arenaId][i];
            uint256 totalReward = redistributionPerPlayer;

            if (gladiators[_arenaId][player].score == highestScore) {
                totalReward += winnerBonusEach;
                gladiators[_arenaId][player].totalWins++;
            }

            pendingRewards[_arenaId][player] += totalReward;
        }

        // ── Step 4: Spectator bet settlement (unchanged) ──
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

        emit ArenaFinished(_arenaId, winnerCount, arena.totalPool, winnerBonusEach, redistributionPerPlayer);
    }

    // ============ Override Functions ============

    function _update(address to, uint256 tokenId, address auth) 
        internal override(ERC721) returns (address) 
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) 
        internal override(ERC721) 
    {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ============ Pause / Unpause ============

    /**
     * @notice Pause all state-changing operations on the contract.
     * @dev    Only callable by DEFAULT_ADMIN_ROLE.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Resume normal operations after a pause.
     * @dev    Only callable by DEFAULT_ADMIN_ROLE.
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ============ View Functions ============

    /**
     * @notice Get summary information for a specific arena.
     * @param _arenaId The arena ID to query
     * @return id             Arena ID
     * @return entryFee        Entry fee in wei
     * @return totalPool       Total prize pool
     * @return maxPlayers      Maximum players allowed
     * @return playerCount     Current number of players
     * @return currentRound    Current round number
     * @return totalRounds     Total rounds
     * @return phaseDeadline   Current phase deadline timestamp
     * @return phase           Current arena phase
     */
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

    /**
     * @notice Get full gladiator data for a player in an arena.
     * @param _arenaId The arena ID
     * @param _player  The player address
     * @return The Gladiator struct
     */
    function getGladiator(uint256 _arenaId, address _player) external view returns (Gladiator memory) {
        return gladiators[_arenaId][_player];
    }

    /**
     * @notice Get the list of player addresses in an arena.
     * @param _arenaId The arena ID
     * @return Array of player addresses
     */
    function getPlayers(uint256 _arenaId) external view returns (address[] memory) {
        uint8 playerCount = arenas[_arenaId].playerCount;
        address[] memory players = new address[](playerCount);
        
        for (uint8 i = 0; i < playerCount; i++) {
            players[i] = arenaPlayers[_arenaId][i];
        }
        
        return players;
    }

    /**
     * @notice Get all player addresses and their scores for an arena.
     * @param _arenaId The arena ID
     * @return players Array of player addresses
     * @return scores  Corresponding array of player scores
     */
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

    /**
     * @notice Calculate potential rewards for a player in an arena.
     * @dev    Can be called at any time; uses the current score state.
     *         If the arena is not yet finished the values are *estimates*.
     * @param _arenaId Arena ID
     * @param _player  Player address
     * @return redistribution Amount from the 80% redistribution pool
     * @return winnerBonus   Amount from the 20% winner-bonus pool (0 if not winning)
     * @return totalReward   redistribution + winnerBonus
     */
    function calculateRewards(
        uint256 _arenaId,
        address _player
    ) external view returns (
        uint256 redistribution,
        uint256 winnerBonus,
        uint256 totalReward
    ) {
        Arena storage arena = arenas[_arenaId];
        uint8 playerCount = arena.playerCount;
        require(playerCount > 0, "No players in arena");
        require(gladiators[_arenaId][_player].owner != address(0), "Not a player");

        // Determine highest score & winner count
        int256 highestScore = type(int256).min;
        uint8 winnerCount = 0;

        for (uint8 i = 0; i < playerCount; i++) {
            address p = arenaPlayers[_arenaId][i];
            int256 s = gladiators[_arenaId][p].score;
            if (s > highestScore) {
                highestScore = s;
                winnerCount = 1;
            } else if (s == highestScore) {
                winnerCount++;
            }
        }

        uint256 winnerBonusPool = (arena.totalPool * arena.winnerBonusPercent) / 100;
        uint256 redistributionPool = arena.totalPool - winnerBonusPool;

        redistribution = redistributionPool / playerCount;

        if (gladiators[_arenaId][_player].score == highestScore) {
            winnerBonus = winnerBonusPool / winnerCount;
        }

        totalReward = redistribution + winnerBonus;
    }

    /**
     * @notice Get the redistribution economy parameters for an arena.
     * @param _arenaId Arena ID
     * @return bonusPercent        Winner bonus percentage (e.g. 20)
     * @return redistPercent       Redistribution percentage (e.g. 80)
     * @return totalPool           Total value locked in the arena
     * @return estRedistPerPlayer  Estimated redistribution per player at current count
     */
    function getRedistributionInfo(uint256 _arenaId) external view returns (
        uint256 bonusPercent,
        uint256 redistPercent,
        uint256 totalPool,
        uint256 estRedistPerPlayer
    ) {
        Arena storage arena = arenas[_arenaId];
        bonusPercent = arena.winnerBonusPercent;
        redistPercent = arena.redistributionPercent;
        totalPool = arena.totalPool;
        if (arena.playerCount > 0) {
            uint256 redistPool = (totalPool * redistPercent) / 100;
            estRedistPerPlayer = redistPool / arena.playerCount;
        }
    }
}
