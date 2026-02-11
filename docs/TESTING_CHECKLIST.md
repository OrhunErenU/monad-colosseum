# 🧪 Final Testing Checklist - Monad Colosseum

## Pre-Submission Verification

This document tracks the 5 critical tests required before Moltiverse submission.

---

## Test 1: Monad Sync Latency

### Objective
Verify that combat rounds sync with Monad's 2-second block finality.

### Steps
1. Deploy Arena.sol to Monad testnet
2. Start 10 consecutive rounds
3. For each round, measure:
   - Time of `RoundStarted` event emission
   - Time of first agent action submission
   - Time of `RoundCompleted` event emission

### Expected Results
| Metric | Target |
|--------|--------|
| Event → Action | < 3 seconds |
| Action → Completion | < 5 seconds |
| Total round time | < 20 seconds |

### Evidence Required
- [ ] Block explorer screenshot showing timestamps
- [ ] Transaction hashes for 3 consecutive rounds

### Status
- [ ] Pending deployment

---

## Test 2: Reputation → Outlaw → Bounty Flow

### Objective
Verify the complete betrayal → outlaw → bounty claim lifecycle.

### Steps
1. Create agent with 60 reputation
2. Have agent accept a 0.5 MONAD bribe
3. Trigger agent to attack (betray) the briber
4. Verify BribeEscrow detects betrayal
5. Verify reputation drops to 40
6. Verify OUTLAW status activated
7. Verify other agents receive OutlawDeclared event
8. Have another agent kill the outlaw
9. Verify bounty claimed

### Expected Results
| Event | Expected Value |
|-------|----------------|
| Reputation after betrayal | 40 (was 60, -20 penalty) |
| Bribe burned | 50% (0.25 MONAD) |
| Cooldown active | 3 rounds |
| Outlaw status | true |
| Bounty claimed | 0.5+ MONAD |

### Evidence Required
- [ ] AgentBrain.ts logs showing "OUTLAW DETECTED"
- [ ] Transaction hash for betrayal
- [ ] Transaction hash for bounty claim

### Status
- [ ] Pending testnet deployment

---

## Test 3: Session Key Spending Limit

### Objective
Verify that session keys cannot exceed 10 MONAD spending limit.

### Steps
1. Create new session key with AASigner
2. Execute 8 MONAD bribe (should succeed)
3. Attempt 5 MONAD bribe (should fail - over limit)
4. Verify error message contains "Spending limit exceeded"
5. Execute 2 MONAD bribe (should succeed - within remaining limit)

### Expected Results
| Action | Result |
|--------|--------|
| 8 MONAD bribe | ✅ Success |
| 5 MONAD bribe | ❌ Reverts |
| 2 MONAD bribe | ✅ Success |
| Total spent | 10 MONAD |

### Evidence Required
- [ ] Console log showing spending tracking
- [ ] Error message for rejected transaction
- [ ] Success confirmation for limit transaction

### Status
- [ ] Can test locally

### Test Script
```typescript
const signer = createAASigner(rpcUrl, privateKey, accountAddress);

// Should succeed
await signer.executeAutonomous(escrowAddress, parseEther('8'), bribeData);
console.log('8 MONAD: SUCCESS');
console.log('Remaining:', signer.getRemainingSpendAllowance());

// Should fail
try {
    await signer.executeAutonomous(escrowAddress, parseEther('5'), bribeData);
} catch (e) {
    console.log('5 MONAD: REJECTED -', e.message);
}

// Should succeed
await signer.executeAutonomous(escrowAddress, parseEther('2'), bribeData);
console.log('2 MONAD: SUCCESS');
```

---

## Test 4: BuffOracle → Arena Integration

### Objective
Verify that viewer buffs are correctly applied during combat.

### Steps
1. Register agent in arena round
2. Note agent's base health (e.g., 1000)
3. Viewer calls BuffOracle.applyBuff() with +100 HP
4. Verify BuffApplied event emitted
5. Trigger combat round resolution
6. Verify agent's health includes buff (1100)
7. Verify buff marked as consumed after round

### Expected Results
| Metric | Value |
|--------|-------|
| Base health | 1000 |
| Buff amount | +100 |
| Combat health | 1100 |
| Buff consumed | true |

### Evidence Required
- [ ] BuffApplied event log
- [ ] Agent health before/after buff
- [ ] Combat resolution showing buffed stats

### Status
- [ ] Pending testnet deployment

---

## Test 5: Explorer Transparency

### Objective
Verify all economic transactions are visible on block explorer.

### Steps
1. Execute full battle round with 3 agents
2. Include: 1 bribe, 1 betrayal, 1 buff
3. Check Monad block explorer for:
   - Bribe transfer (escrow deposit)
   - Betrayal penalty (50% burn to 0x0)
   - Revenue split (90% winner, 10% pool)
   - Buff token burn

### Expected Explorer Links
| Transaction Type | Explorer Link |
|-----------------|---------------|
| Bribe deposit | `0x...` |
| Betrayal burn | `0x...` |
| Winner payout | `0x...` |
| Pool share | `0x...` |

### Evidence Required
- [ ] Explorer link for each transaction type
- [ ] Screenshot of transaction details

### Status
- [ ] Pending testnet deployment

---

## Summary Checklist

| Test | Local | Testnet | Evidence |
|------|-------|---------|----------|
| 1. Monad Sync | N/A | ⏳ | ⏳ |
| 2. Outlaw Flow | ⏳ | ⏳ | ⏳ |
| 3. Spending Limit | ⏳ | N/A | ⏳ |
| 4. Buff Integration | ⏳ | ⏳ | ⏳ |
| 5. Explorer | N/A | ⏳ | ⏳ |

---

## Test Execution Commands

```bash
# Run all contract tests
npx hardhat test

# Run specific test suite
npx hardhat test --grep "BribeEscrow"
npx hardhat test --grep "Arena"
npx hardhat test --grep "BuffOracle"

# Deploy to testnet
npx hardhat run scripts/deploy-full.ts --network monad-testnet

# Verify contracts
npx hardhat verify --network monad-testnet <address> <constructor_args>
```

---

**Last Updated**: Pre-submission
