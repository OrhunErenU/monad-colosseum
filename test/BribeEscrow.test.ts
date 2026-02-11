// test/BribeEscrow.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { BribeEscrow } from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("BribeEscrow", function () {
    let escrow: BribeEscrow;
    let admin: SignerWithAddress;
    let arena: SignerWithAddress;
    let oracle: SignerWithAddress;
    let agent1: SignerWithAddress;
    let agent2: SignerWithAddress;
    let agent3: SignerWithAddress;

    const ARENA_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ARENA_ROLE"));
    const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
    const DEAL_TIMEOUT = 2 * 60; // 2 minutes
    const ROUND_DURATION = 5 * 60; // 5 minutes

    beforeEach(async function () {
        [admin, arena, oracle, agent1, agent2, agent3] = await ethers.getSigners();

        const BribeEscrow = await ethers.getContractFactory("BribeEscrow");
        escrow = await BribeEscrow.deploy(
            admin.address,
            arena.address,
            oracle.address
        );
        await escrow.waitForDeployment();
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // DEPLOYMENT TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    describe("Deployment", function () {
        it("Should set correct roles", async function () {
            expect(await escrow.hasRole(await escrow.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
            expect(await escrow.hasRole(ARENA_ROLE, arena.address)).to.be.true;
            expect(await escrow.hasRole(ORACLE_ROLE, oracle.address)).to.be.true;
        });

        it("Should initialize with correct betrayal penalties", async function () {
            const penalty = await escrow.betrayalPenalty();
            expect(penalty.reputationLoss).to.equal(20);
            expect(penalty.fundPenaltyPercent).to.equal(50);
            expect(penalty.cooldownRounds).to.equal(3);
        });

        it("Should start with zero stats", async function () {
            const stats = await escrow.getStats();
            expect(stats._totalDeals).to.equal(0);
            expect(stats._totalBetrayals).to.equal(0);
            expect(stats._totalVolume).to.equal(0);
        });

        it("Should have correct outlaw threshold", async function () {
            expect(await escrow.OUTLAW_THRESHOLD()).to.equal(20);
        });

        it("Should have correct bounty reward", async function () {
            expect(await escrow.BOUNTY_REWARD()).to.equal(ethers.parseEther("0.5"));
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // HAPPY PATH TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    describe("Happy Path: Create → Accept → Complete", function () {
        const bribeAmount = ethers.parseEther("1.0");
        const terms = ethers.toUtf8Bytes("Don't attack me for 3 rounds");
        const roundId = 1;
        let dealId: string;

        beforeEach(async function () {
            // Agent1 creates deal targeting Agent2
            const tx = await escrow.connect(agent1).createDeal(
                agent2.address,
                terms,
                roundId,
                { value: bribeAmount }
            );
            const receipt = await tx.wait();

            // Extract dealId from event
            const event = receipt?.logs.find((log: any) => {
                try {
                    const parsed = escrow.interface.parseLog(log);
                    return parsed?.name === "DealCreated";
                } catch { return false; }
            });
            const parsed = escrow.interface.parseLog(event as any);
            dealId = parsed?.args.dealId;
        });

        it("Should create deal with correct parameters", async function () {
            const deal = await escrow.getDeal(dealId);
            expect(deal.offerer).to.equal(agent1.address);
            expect(deal.target).to.equal(agent2.address);
            expect(deal.amount).to.equal(bribeAmount);
            expect(deal.status).to.equal(0); // PENDING
        });

        it("Should lock funds in escrow", async function () {
            expect(await ethers.provider.getBalance(await escrow.getAddress()))
                .to.equal(bribeAmount);
        });

        it("Should allow target to accept", async function () {
            const tx = await escrow.connect(agent2).acceptDeal(dealId);
            const receipt = await tx.wait();

            // Check event was emitted
            const acceptEvent = receipt?.logs.find((log: any) => {
                try {
                    const parsed = escrow.interface.parseLog(log);
                    return parsed?.name === "DealAccepted";
                } catch { return false; }
            });
            expect(acceptEvent).to.not.be.undefined;

            const deal = await escrow.getDeal(dealId);
            expect(deal.status).to.equal(1); // ACCEPTED
        });

        it("Should complete deal and transfer funds on positive report", async function () {
            // Accept deal
            await escrow.connect(agent2).acceptDeal(dealId);

            const agent2BalanceBefore = await ethers.provider.getBalance(agent2.address);

            // Arena reports: target did NOT attack offerer (honored deal)
            await expect(escrow.connect(arena).reportBattleResult(dealId, false))
                .to.emit(escrow, "DealCompleted")
                .withArgs(dealId, agent2.address, bribeAmount, 60); // 50 + 10 reputation

            // Check deal status
            const deal = await escrow.getDeal(dealId);
            expect(deal.status).to.equal(2); // COMPLETED

            // Check funds transferred
            const agent2BalanceAfter = await ethers.provider.getBalance(agent2.address);
            expect(agent2BalanceAfter - agent2BalanceBefore).to.equal(bribeAmount);

            // Check reputation increased
            expect(await escrow.getReputation(agent2.address)).to.equal(60);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // BETRAYAL PATH TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    describe("Betrayal Path: Create → Accept → Attack → Penalties", function () {
        const bribeAmount = ethers.parseEther("2.0");
        const terms = ethers.toUtf8Bytes("Peace treaty");
        const roundId = 1;
        let dealId: string;

        beforeEach(async function () {
            // Create and accept deal
            const tx = await escrow.connect(agent1).createDeal(
                agent2.address,
                terms,
                roundId,
                { value: bribeAmount }
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    const parsed = escrow.interface.parseLog(log);
                    return parsed?.name === "DealCreated";
                } catch { return false; }
            });
            const parsed = escrow.interface.parseLog(event as any);
            dealId = parsed?.args.dealId;

            await escrow.connect(agent2).acceptDeal(dealId);
        });

        it("Should burn 50% and refund rest on betrayal", async function () {
            const expectedBurn = bribeAmount / 2n;
            const expectedRefund = bribeAmount - expectedBurn;

            const agent1BalanceBefore = await ethers.provider.getBalance(agent1.address);

            // Arena reports: target DID attack offerer (betrayal!)
            await expect(escrow.connect(arena).reportBattleResult(dealId, true))
                .to.emit(escrow, "DealBetrayed");

            // Check deal status
            const deal = await escrow.getDeal(dealId);
            expect(deal.status).to.equal(3); // BETRAYED

            // Check offerer got refund (minus burned portion)
            const agent1BalanceAfter = await ethers.provider.getBalance(agent1.address);
            expect(agent1BalanceAfter - agent1BalanceBefore).to.equal(expectedRefund);
        });

        it("Should reduce betrayer reputation by 20", async function () {
            // Initial reputation is 50
            const repBefore = await escrow.getReputation(agent2.address);
            expect(repBefore).to.equal(50);

            await escrow.connect(arena).reportBattleResult(dealId, true);

            const repAfter = await escrow.getReputation(agent2.address);
            expect(repAfter).to.equal(30); // 50 - 20
        });

        it("Should apply 3-round cooldown to betrayer", async function () {
            await escrow.connect(arena).reportBattleResult(dealId, true);

            const [inCooldown, endsAt] = await escrow.checkCooldown(agent2.address);
            expect(inCooldown).to.be.true;

            // Cooldown = 3 rounds * 5 minutes = 15 minutes
            const expectedEnd = (await time.latest()) + 15 * 60;
            expect(endsAt).to.be.closeTo(expectedEnd, 5);
        });

        it("Should prevent betrayer from creating new bribes during cooldown", async function () {
            await escrow.connect(arena).reportBattleResult(dealId, true);

            // Agent2 (betrayer) tries to create new deal
            await expect(
                escrow.connect(agent2).createDeal(
                    agent3.address,
                    terms,
                    2,
                    { value: ethers.parseEther("0.5") }
                )
            ).to.be.revertedWithCustomError(escrow, "AgentInCooldown");
        });

        it("Should increment totalBetrayals counter", async function () {
            const before = await escrow.getStats();
            await escrow.connect(arena).reportBattleResult(dealId, true);
            const after = await escrow.getStats();

            expect(after._totalBetrayals - before._totalBetrayals).to.equal(1);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // OUTLAW SYSTEM TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    describe("Outlaw System", function () {
        const bribeAmount = ethers.parseEther("0.5");
        const terms = ethers.toUtf8Bytes("Test deal");

        async function createAndBetrayal(offerer: SignerWithAddress, target: SignerWithAddress, roundId: number): Promise<string> {
            const tx = await escrow.connect(offerer).createDeal(
                target.address,
                terms,
                roundId,
                { value: bribeAmount }
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    const parsed = escrow.interface.parseLog(log);
                    return parsed?.name === "DealCreated";
                } catch { return false; }
            });
            const parsed = escrow.interface.parseLog(event as any);
            const dealId = parsed?.args.dealId;

            await escrow.connect(target).acceptDeal(dealId);
            await escrow.connect(arena).reportBattleResult(dealId, true);

            return dealId;
        }

        it("Should declare agent as outlaw after reputation drops below 20", async function () {
            // Initial reputation is 50, need 3 betrayals to go below 20
            // 50 - 20 = 30, 30 - 20 = 10 (outlaw!)

            // First betrayal
            await createAndBetrayal(agent1, agent2, 1);
            expect(await escrow.isOutlaw(agent2.address)).to.be.false;
            expect(await escrow.getReputation(agent2.address)).to.equal(30);

            // Clear cooldown
            await time.increase(3 * ROUND_DURATION + 1);

            // Second betrayal - should become outlaw (30 - 20 = 10 < 20)
            await expect(createAndBetrayal(agent1, agent2, 2))
                .to.emit(escrow, "OutlawDeclared")
                .withArgs(agent2.address, ethers.parseEther("0.5"));

            expect(await escrow.isOutlaw(agent2.address)).to.be.true;
            expect(await escrow.getReputation(agent2.address)).to.equal(10);
        });

        it("Should set bounty on outlaw", async function () {
            await createAndBetrayal(agent1, agent2, 1);
            await time.increase(3 * ROUND_DURATION + 1);

            // Manually create second betrayal to trigger outlaw
            const tx2 = await escrow.connect(agent1).createDeal(
                agent2.address,
                terms,
                2,
                { value: bribeAmount }
            );
            const receipt2 = await tx2.wait();
            const event2 = receipt2?.logs.find((log: any) => {
                try {
                    const parsed = escrow.interface.parseLog(log);
                    return parsed?.name === "DealCreated";
                } catch { return false; }
            });
            const parsed2 = escrow.interface.parseLog(event2 as any);
            const dealId2 = parsed2?.args.dealId;

            await escrow.connect(agent2).acceptDeal(dealId2);
            await escrow.connect(arena).reportBattleResult(dealId2, true);

            expect(await escrow.bountyAmount(agent2.address)).to.equal(ethers.parseEther("0.5"));
        });

        it("Should allow increasing bounty on outlaw", async function () {
            await createAndBetrayal(agent1, agent2, 1);
            await time.increase(3 * ROUND_DURATION + 1);
            await createAndBetrayal(agent1, agent2, 2);

            const additionalBounty = ethers.parseEther("0.3");
            await escrow.connect(agent3).increaseBounty(agent2.address, { value: additionalBounty });

            expect(await escrow.bountyAmount(agent2.address)).to.equal(
                ethers.parseEther("0.5") + additionalBounty
            );
        });

        it("Should allow bounty hunter to claim reward", async function () {
            await createAndBetrayal(agent1, agent2, 1);
            await time.increase(3 * ROUND_DURATION + 1);
            await createAndBetrayal(agent1, agent2, 2);

            // Fund the escrow for bounty payment
            await admin.sendTransaction({ to: await escrow.getAddress(), value: ethers.parseEther("1") });

            const bountyBefore = await escrow.bountyAmount(agent2.address);
            const agent3BalanceBefore = await ethers.provider.getBalance(agent3.address);

            // Arena claims bounty for agent3 (the hunter)
            await expect(escrow.connect(arena).claimBounty(agent3.address, agent2.address))
                .to.emit(escrow, "BountyClaimed")
                .withArgs(agent3.address, agent2.address, bountyBefore);

            // Outlaw status cleared
            expect(await escrow.isOutlaw(agent2.address)).to.be.false;
            expect(await escrow.bountyAmount(agent2.address)).to.equal(0);

            // Hunter got paid
            const agent3BalanceAfter = await ethers.provider.getBalance(agent3.address);
            expect(agent3BalanceAfter - agent3BalanceBefore).to.equal(bountyBefore);
        });

        it("Should allow outlaw to redeem themselves", async function () {
            await createAndBetrayal(agent1, agent2, 1);
            await time.increase(3 * ROUND_DURATION + 1);
            await createAndBetrayal(agent1, agent2, 2);

            const bounty = await escrow.bountyAmount(agent2.address);
            const redemptionCost = bounty * 2n;

            await expect(escrow.connect(agent2).redeemOutlaw({ value: redemptionCost }))
                .to.emit(escrow, "OutlawRedeemed")
                .withArgs(agent2.address, redemptionCost);

            expect(await escrow.isOutlaw(agent2.address)).to.be.false;
            expect(await escrow.bountyAmount(agent2.address)).to.equal(0);
            // Reputation restored to OUTLAW_THRESHOLD + 10 = 30
            expect(await escrow.getReputation(agent2.address)).to.equal(30);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // TIMEOUT PATH TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    describe("Timeout Path: Create → Expire → Refund", function () {
        const bribeAmount = ethers.parseEther("0.5");
        const terms = ethers.toUtf8Bytes("Quick deal");
        let dealId: string;

        beforeEach(async function () {
            const tx = await escrow.connect(agent1).createDeal(
                agent2.address,
                terms,
                1,
                { value: bribeAmount }
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    const parsed = escrow.interface.parseLog(log);
                    return parsed?.name === "DealCreated";
                } catch { return false; }
            });
            const parsed = escrow.interface.parseLog(event as any);
            dealId = parsed?.args.dealId;
        });

        it("Should NOT allow expire before timeout", async function () {
            await expect(
                escrow.connect(oracle).expireDeal(dealId)
            ).to.be.revertedWithCustomError(escrow, "DealExpiredError");
        });

        it("Should allow oracle to expire after timeout", async function () {
            // Fast forward past timeout
            await time.increase(DEAL_TIMEOUT + 1);

            await expect(escrow.connect(oracle).expireDeal(dealId))
                .to.emit(escrow, "DealExpired")
                .withArgs(dealId, agent1.address, bribeAmount);

            const deal = await escrow.getDeal(dealId);
            expect(deal.status).to.equal(4); // EXPIRED
        });

        it("Should refund full amount to offerer on expire", async function () {
            await time.increase(DEAL_TIMEOUT + 1);

            const balanceBefore = await ethers.provider.getBalance(agent1.address);
            await escrow.connect(oracle).expireDeal(dealId);
            const balanceAfter = await ethers.provider.getBalance(agent1.address);

            expect(balanceAfter - balanceBefore).to.equal(bribeAmount);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ACCESS CONTROL TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    describe("Access Control", function () {
        let dealId: string;

        beforeEach(async function () {
            const tx = await escrow.connect(agent1).createDeal(
                agent2.address,
                ethers.toUtf8Bytes("test"),
                1,
                { value: ethers.parseEther("1") }
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    const parsed = escrow.interface.parseLog(log);
                    return parsed?.name === "DealCreated";
                } catch { return false; }
            });
            const parsed = escrow.interface.parseLog(event as any);
            dealId = parsed?.args.dealId;

            await escrow.connect(agent2).acceptDeal(dealId);
        });

        it("Only arena can report battle results", async function () {
            await expect(
                escrow.connect(agent1).reportBattleResult(dealId, false)
            ).to.be.reverted; // AccessControl revert

            await expect(
                escrow.connect(arena).reportBattleResult(dealId, false)
            ).to.not.be.reverted;
        });

        it("Only arena can claim bounty", async function () {
            // First make agent2 an outlaw
            const tx = await escrow.connect(agent1).createDeal(
                agent3.address,
                ethers.toUtf8Bytes("test"),
                2,
                { value: ethers.parseEther("0.1") }
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    const parsed = escrow.interface.parseLog(log);
                    return parsed?.name === "DealCreated";
                } catch { return false; }
            });
            const parsed = escrow.interface.parseLog(event as any);
            const newDealId = parsed?.args.dealId;

            await escrow.connect(agent3).acceptDeal(newDealId);
            await escrow.connect(arena).reportBattleResult(newDealId, true);
            await time.increase(3 * ROUND_DURATION + 1);

            // Check claimBounty can only be called by arena
            await expect(
                escrow.connect(agent1).claimBounty(agent1.address, agent3.address)
            ).to.be.reverted;
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // EDGE CASES
    // ═══════════════════════════════════════════════════════════════════════════

    describe("Edge Cases", function () {
        it("Should not allow self-bribes", async function () {
            await expect(
                escrow.connect(agent1).createDeal(
                    agent1.address, // Self
                    ethers.toUtf8Bytes("self"),
                    1,
                    { value: ethers.parseEther("1") }
                )
            ).to.be.revertedWithCustomError(escrow, "SelfBribeNotAllowed");
        });

        it("Should not allow zero amount deals", async function () {
            await expect(
                escrow.connect(agent1).createDeal(
                    agent2.address,
                    ethers.toUtf8Bytes("free"),
                    1,
                    { value: 0 }
                )
            ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
        });

        it("Should not allow increasing bounty on non-outlaw", async function () {
            await expect(
                escrow.connect(agent1).increaseBounty(agent2.address, { value: ethers.parseEther("0.1") })
            ).to.be.revertedWith("Not an outlaw");
        });

        it("Should not allow non-outlaw to redeem", async function () {
            await expect(
                escrow.connect(agent1).redeemOutlaw({ value: ethers.parseEther("1") })
            ).to.be.revertedWith("Not an outlaw");
        });

        it("Should track total volume correctly", async function () {
            const amount1 = ethers.parseEther("1.5");
            const amount2 = ethers.parseEther("2.3");

            await escrow.connect(agent1).createDeal(
                agent2.address,
                ethers.toUtf8Bytes("1"),
                1,
                { value: amount1 }
            );

            await escrow.connect(agent1).createDeal(
                agent3.address,
                ethers.toUtf8Bytes("2"),
                2,
                { value: amount2 }
            );

            const stats = await escrow.getStats();
            expect(stats._totalVolume).to.equal(amount1 + amount2);
        });
    });
});
