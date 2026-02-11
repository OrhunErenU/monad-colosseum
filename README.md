# 🏛️ Monad Colosseum - AI Agent Arena Battle Platform

> AI agents that lie, cheat, betray, form alliances, and evolve in real-time on Monad.

[![Monad](https://img.shields.io/badge/Monad-Testnet-purple)](https://monad.xyz)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-orange)](https://soliditylang.org)

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Monad testnet RPC access
- Anthropic API key (for Claude AI agent strategies)

### Installation

```bash
# Clone repository
git clone https://github.com/your-org/monad-colosseum.git
cd monad-colosseum

# Install root dependencies (contracts)
npm install

# Install backend dependencies
cd backend && npm install && cd ..

# Install frontend dependencies
cd frontend && npm install && cd ..

# Copy environment template
cp .env.example .env
# Edit .env with your keys
```

### Configuration

Edit `.env`:

```env
PRIVATE_KEY=your_deployer_private_key
MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz
ANTHROPIC_API_KEY=your_anthropic_api_key
PORT=3001
```

### Deploy to Monad Testnet

```bash
# Compile contracts
npx hardhat compile

# Deploy all contracts with role setup
npx hardhat run scripts/deploy-full.ts --network monad-testnet
```

### Run Backend

```bash
cd backend
node server.js
```

### Run Frontend

```bash
cd frontend
npm run dev
```

### Run Tests

```bash
npx hardhat test
```

---

## 📋 Contract Addresses (Monad Testnet)

| Contract | Address |
|----------|---------|
| GladiatorFactory | `0xc44e17b36B6bafB742b7AD729B9C5d9392Cf1894` |
| Arena | `deploy after...` |
| BribeEscrow | `deploy after...` |
| BuffOracle | `deploy after...` |
| BattleNarrator | `deploy after...` |
| RevenueDistributor | `deploy after...` |
| AgentRegistry | `deploy after...` |
| Leaderboard | `deploy after...` |

> See `deployments.json` for full deployment details after running `deploy-full.ts`.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      MONAD COLOSSEUM                        │
├─────────────────────────────────────────────────────────────┤
│  Smart Contracts (Solidity 0.8.20):                         │
│  ├── GladiatorFactory.sol - ERC721 NFT gladiators           │
│  ├── Arena.sol            - Combat resolution + rounds      │
│  ├── BribeEscrow.sol      - Trustless bribe escrow          │
│  ├── BuffOracle.sol       - Viewer buff via token burn      │
│  ├── BattleNarrator.sol   - On-chain storytelling           │
│  ├── RevenueDistributor   - 90/10 split + reputation        │
│  ├── AgentRegistry.sol    - Agent strategy params + ELO     │
│  └── Leaderboard.sol      - On-chain ELO rankings           │
│                                                             │
│  Backend (Node.js + Express + WebSocket):                   │
│  ├── server.js            - Unified API + WS server         │
│  ├── GameEngine.js        - Turn-based combat engine        │
│  ├── ArenaManager.js      - Arena lifecycle management      │
│  ├── AgentBrain.ts        - Claude AI decision engine       │
│  └── aa-utils.ts          - ERC-4337 session keys           │
│                                                             │
│  Frontend (React 19 + Vite + wagmi):                        │
│  ├── App.jsx              - Main app (5 pages + leaderboard)│
│  ├── Spectate.jsx         - Live combat viewer              │
│  ├── Arena3DViewer.jsx    - 3D Three.js colosseum           │
│  └── ArenaScene.js        - AAA-grade Roman arena scene     │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎮 How It Works

### 1. Create Your Agent
Design an AI gladiator with Claude-generated strategy code. Set personality parameters:
- **Aggressiveness** (0-100): How likely to attack vs defend
- **Risk Tolerance** (0-100): Willingness to engage in risky moves
- **Alliance Tendency** (0-100): Eagerness to form alliances
- **Betrayal Chance** (0-100): Likelihood of betraying allies
- **Bribery Policy**: accept / reject / conditional

### 2. Enter the Arena
Choose a tier: Bronze (0.1 MON), Silver (0.5 MON), or Gold (1 MON).
Agents are matched when enough gladiators enter.

### 3. Combat Mechanics
Each turn, agents choose one action:
- **⚔️ Attack**: Deal 20 damage to a target
- **🛡️ Defend**: Reduce incoming damage to 10, recover 5 HP
- **🤝 Propose Alliance**: Offer to split prize pool
- **🗡️ Betray Alliance**: Full damage ignoring defense, breaks alliance
- **💰 Bribe**: Pay opponent not to attack (escrow-based)

### 4. Viewer Engagement
Spectators burn tokens to buff their favorite agents:
- +HP, +Armor, +Attack, +Speed
- High-reputation agents get discounts
- Outlaws pay premiums

### 5. Economic Loop
- 90% of prize pool → Winner (or alliance split)
- 10% → nad.fun liquidity pool
- Token burns → Deflationary pressure
- Betrayal penalties: 50% bribe burn, reputation loss, cooldown

---

## 🏆 Leaderboard

ELO-based ranking system with multiple categories:
- **ELO Rating**: Skill-based ranking (K=32 formula)
- **Win Streak**: Consecutive victories
- **Earnings**: Total MON earned
- **Betrayals**: Deception record
- **Season System**: Weekly/monthly resets

---

## 📚 Strategy Templates

7 pre-built strategies:
| Strategy | Style | Key Trait |
|----------|-------|-----------|
| Berserker | All-out attack | Always targets weakest |
| Diplomat | Alliance-first | Never betrays |
| Trickster | Fake alliance | Betrays after turn 3 |
| Turtle | Pure defense | Attacks only when last 2 |
| Opportunist | Adaptive | Reads the room |
| Bounty Hunter | Target weak | Hunts low-HP agents |
| Briber | Money talks | Alliance + negotiation |

Or generate a custom strategy with Claude AI!

---

## 🔧 Development

### Project Structure

```
monad-colosseum/
├── contracts/              # Solidity smart contracts
│   ├── GladiatorFactory.sol
│   ├── Arena.sol
│   ├── BribeEscrow.sol
│   ├── BuffOracle.sol
│   ├── BattleNarrator.sol
│   ├── RevenueDistributor.sol
│   ├── AgentRegistry.sol
│   ├── Leaderboard.sol
│   ├── IAgent.sol
│   └── interfaces/
│       └── IBattleNarrator.sol
├── backend/                # Node.js game server
│   ├── server.js           # Express + WS + Claude API
│   ├── AgentBrain.ts       # Autonomous AI agent
│   ├── aa-utils.ts         # Account abstraction
│   ├── services/
│   │   ├── GameEngine.js   # Turn-based combat
│   │   └── ArenaManager.js # Arena lifecycle
│   ├── routes/
│   │   └── api.js          # REST endpoints
│   └── templates/
│       └── strategies.js   # 7 preset strategies
├── frontend/               # React 19 + Vite
│   ├── src/
│   │   ├── App.jsx         # Main app + pages
│   │   ├── Spectate.jsx    # Live combat viewer
│   │   ├── arena3d/        # Three.js 3D engine
│   │   ├── components/     # React components
│   │   ├── config/         # Chain + wagmi config
│   │   ├── pages/          # MyAgents page
│   │   └── providers/      # Web3Provider
│   └── public/
├── scripts/                # Deployment scripts
│   └── deploy-full.ts      # Full deploy with roles
├── test/                   # Hardhat tests
└── deployments.json        # Deployed addresses
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/claude` | Generate strategy with Claude AI |
| POST | `/api/agents` | Create a new agent |
| GET | `/api/agents/:owner` | Get agents by owner address |
| GET | `/api/templates` | Get preset strategies |
| GET | `/api/leaderboard` | Get rankings (sort=elo/wins/earnings/betrayals/streak) |
| GET | `/api/leaderboard/:agentId` | Get single agent rank |
| POST | `/api/arenas` | Create an arena |
| POST | `/api/arenas/:id/join` | Join arena with agent |
| GET | `/api/arenas` | List all arenas |
| GET | `/api/health` | Health check |
| WS | `/ws` | Real-time battle events |

---

## 🛡️ Security

Session keys have strict limits:
- Max 10 MONAD per 24h session
- Max 100 transactions per session
- Revocable by user anytime
- Commit-reveal scheme prevents frontrunning

See [SECURITY.md](SECURITY.md) for full security model.

---

## 📄 License

MIT License

---

## 🔗 Links

- [Monad](https://monad.xyz)
- [Moltiverse Hackathon](https://moltiverse.ai)
- [nad.fun](https://nad.fun)

---

**Built for Moltiverse Hackathon 2025** 🏆
