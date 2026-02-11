// scripts/deploy.ts
import { ethers } from "hardhat";

async function main() {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("       🏛️  MONAD COLOSSEUM - DEPLOYMENT SCRIPT  🏛️            ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");

    const [deployer] = await ethers.getSigners();
    console.log("📍 Deploying contracts with:", deployer.address);
    console.log("💰 Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MON");
    console.log("");

    // ═══════════════════════════════════════════════════════════════════════════
    // DEPLOY BRIBE ESCROW
    // ═══════════════════════════════════════════════════════════════════════════

    console.log("1️⃣  Deploying BribeEscrow...");

    // For now, deployer is admin, arena, and oracle
    // In production, these would be separate addresses
    const admin = deployer.address;
    const arena = deployer.address; // Will be updated after Arena deployment
    const oracle = deployer.address; // Will be a Chainlink oracle or similar

    const BribeEscrow = await ethers.getContractFactory("BribeEscrow");
    const escrow = await BribeEscrow.deploy(admin, arena, oracle);
    await escrow.waitForDeployment();

    const escrowAddress = await escrow.getAddress();
    console.log("   ✅ BribeEscrow deployed to:", escrowAddress);

    // ═══════════════════════════════════════════════════════════════════════════
    // VERIFICATION INFO
    // ═══════════════════════════════════════════════════════════════════════════

    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("                    📋 DEPLOYMENT SUMMARY                       ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");
    console.log("🔐 BribeEscrow:", escrowAddress);
    console.log("");
    console.log("📝 Constructor Arguments:");
    console.log("   - Admin:", admin);
    console.log("   - Arena:", arena);
    console.log("   - Oracle:", oracle);
    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");
    console.log("⚡ Verify on explorer:");
    console.log(`   npx hardhat verify --network monad ${escrowAddress} ${admin} ${arena} ${oracle}`);
    console.log("");

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIAL CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    console.log("2️⃣  Initial Configuration...");

    // Get default penalty config
    const penalty = await escrow.betrayalPenalty();
    console.log("   📊 Betrayal Penalties:");
    console.log(`      - Reputation Loss: ${penalty.reputationLoss} points`);
    console.log(`      - Fund Penalty: ${penalty.fundPenaltyPercent}%`);
    console.log(`      - Cooldown: ${penalty.cooldownRounds} rounds`);

    const stats = await escrow.getStats();
    console.log("   📈 Initial Stats:");
    console.log(`      - Total Deals: ${stats._totalDeals}`);
    console.log(`      - Total Betrayals: ${stats._totalBetrayals}`);
    console.log(`      - Total Volume: ${ethers.formatEther(stats._totalVolume)} MON`);

    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("              ✅ DEPLOYMENT COMPLETE                            ");
    console.log("═══════════════════════════════════════════════════════════════");

    // Return addresses for programmatic use
    return {
        escrow: escrowAddress,
        admin,
        arena,
        oracle
    };
}

main()
    .then((addresses) => {
        console.log("\n📦 Exported Addresses:", JSON.stringify(addresses, null, 2));
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
