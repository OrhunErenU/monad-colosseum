/**
 * deploy-full.ts - Full Deployment Script for Monad Colosseum
 * 
 * Deploys all contracts in correct order with role setup
 * 
 * Usage: npx hardhat run scripts/deploy-full.ts --network monad-testnet
 * 
 * @author Monad Colosseum Team
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface DeploymentAddresses {
    network: string;
    chainId: number;
    timestamp: string;
    deployer: string;
    contracts: {
        BattleNarrator: string;
        BuffOracle: string;
        BribeEscrow: string;
        RevenueDistributor: string;
        Arena: string;
        AgentRegistry: string;
        Leaderboard: string;
    };
    roles: {
        admin: string;
        gameMaster: string;
        oracle: string;
    };
}

async function main() {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("        MONAD COLOSSEUM - FULL DEPLOYMENT");
    console.log("═══════════════════════════════════════════════════════════════");

    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log(`\n📍 Network: ${network.name} (chainId: ${network.chainId})`);
    console.log(`🔑 Deployer: ${deployer.address}`);
    console.log(`💰 Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} MONAD\n`);

    // Deployment addresses storage
    const addresses: DeploymentAddresses = {
        network: network.name,
        chainId: Number(network.chainId),
        timestamp: new Date().toISOString(),
        deployer: deployer.address,
        contracts: {
            BattleNarrator: "",
            BuffOracle: "",
            BribeEscrow: "",
            RevenueDistributor: "",
            Arena: "",
            AgentRegistry: "",
            Leaderboard: ""
        },
        roles: {
            admin: deployer.address,
            gameMaster: deployer.address,
            oracle: ""  // Will be set to Arena
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Deploy BattleNarrator
    // ═══════════════════════════════════════════════════════════════
    console.log("📜 [1/5] Deploying BattleNarrator...");
    const BattleNarrator = await ethers.getContractFactory("BattleNarrator");
    const narrator = await BattleNarrator.deploy(
        deployer.address,   // admin
        deployer.address,   // arena (temporary placeholder, will update)
        deployer.address    // escrow (temporary placeholder, will update)
    );
    await narrator.waitForDeployment();
    addresses.contracts.BattleNarrator = await narrator.getAddress();
    console.log(`   ✅ BattleNarrator: ${addresses.contracts.BattleNarrator}`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Deploy BuffOracle
    // ═══════════════════════════════════════════════════════════════
    console.log("\n✨ [2/5] Deploying BuffOracle...");
    const BuffOracle = await ethers.getContractFactory("BuffOracle");
    const buffOracle = await BuffOracle.deploy(
        deployer.address,   // admin
        deployer.address    // arena (temporary placeholder, will update)
    );
    await buffOracle.waitForDeployment();
    addresses.contracts.BuffOracle = await buffOracle.getAddress();
    console.log(`   ✅ BuffOracle: ${addresses.contracts.BuffOracle}`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Deploy BribeEscrow
    // ═══════════════════════════════════════════════════════════════
    console.log("\n💰 [3/5] Deploying BribeEscrow...");
    const BribeEscrow = await ethers.getContractFactory("BribeEscrow");
    const escrow = await BribeEscrow.deploy(
        deployer.address,  // admin
        deployer.address,  // arena (temporary placeholder, will grant ARENA_ROLE later)
        deployer.address   // oracle (temporary placeholder, will grant ORACLE_ROLE later)
    );
    await escrow.waitForDeployment();
    addresses.contracts.BribeEscrow = await escrow.getAddress();
    console.log(`   ✅ BribeEscrow: ${addresses.contracts.BribeEscrow}`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: Deploy RevenueDistributor
    // ═══════════════════════════════════════════════════════════════
    console.log("\n💸 [4/5] Deploying RevenueDistributor...");

    // Create a mock nad.fun pool address (replace with actual in production)
    const nadFunPool = deployer.address; // Placeholder - use actual nad.fun pool

    const RevenueDistributor = await ethers.getContractFactory("RevenueDistributor");
    const revenueDistributor = await RevenueDistributor.deploy(
        deployer.address,  // admin
        deployer.address,  // arena (temporary, will update)
        nadFunPool         // nad.fun pool
    );
    await revenueDistributor.waitForDeployment();
    addresses.contracts.RevenueDistributor = await revenueDistributor.getAddress();
    console.log(`   ✅ RevenueDistributor: ${addresses.contracts.RevenueDistributor}`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 5: Deploy AgentRegistry
    // ═══════════════════════════════════════════════════════════════
    console.log("\n🤖 [5/7] Deploying AgentRegistry...");
    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    const creationFee = ethers.parseEther("0.01"); // 0.01 MONAD creation fee
    const agentRegistry = await AgentRegistry.deploy(
        deployer.address,   // admin
        deployer.address,   // treasury
        creationFee          // creation fee
    );
    await agentRegistry.waitForDeployment();
    addresses.contracts.AgentRegistry = await agentRegistry.getAddress();
    console.log(`   ✅ AgentRegistry: ${addresses.contracts.AgentRegistry}`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 6: Deploy Leaderboard
    // ═══════════════════════════════════════════════════════════════
    console.log("\n🏆 [6/7] Deploying Leaderboard...");
    const Leaderboard = await ethers.getContractFactory("Leaderboard");
    const leaderboard = await Leaderboard.deploy(deployer.address);
    await leaderboard.waitForDeployment();
    addresses.contracts.Leaderboard = await leaderboard.getAddress();
    console.log(`   ✅ Leaderboard: ${addresses.contracts.Leaderboard}`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 7: Deploy Arena (depends on all other contracts)
    // ═══════════════════════════════════════════════════════════════
    console.log("\n⚔️  [7/7] Deploying Arena...");
    const Arena = await ethers.getContractFactory("Arena");
    const arena = await Arena.deploy(
        deployer.address,                       // admin
        deployer.address,                       // gameMaster
        addresses.contracts.BuffOracle,         // buffOracle
        addresses.contracts.BribeEscrow,        // escrow
        addresses.contracts.BattleNarrator,     // narrator
        addresses.contracts.RevenueDistributor, // revenueDistributor
        addresses.contracts.AgentRegistry,      // agentRegistry
        addresses.contracts.Leaderboard         // leaderboard
    );
    await arena.waitForDeployment();
    addresses.contracts.Arena = await arena.getAddress();
    addresses.roles.oracle = addresses.contracts.Arena;
    console.log(`   ✅ Arena: ${addresses.contracts.Arena}`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 8: Setup Roles
    // ═══════════════════════════════════════════════════════════════
    console.log("\n🔐 Setting up roles...");

    // Grant ORACLE_ROLE to Arena on BribeEscrow
    const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
    const escrowContract = await ethers.getContractAt("BribeEscrow", addresses.contracts.BribeEscrow);
    await escrowContract.grantRole(ORACLE_ROLE, addresses.contracts.Arena);
    console.log(`   ✅ Granted ORACLE_ROLE to Arena on BribeEscrow`);

    // Grant BATTLE_REPORTER_ROLE to Arena on BattleNarrator
    const BATTLE_REPORTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BATTLE_REPORTER_ROLE"));
    const narratorContract = await ethers.getContractAt("BattleNarrator", addresses.contracts.BattleNarrator);
    await narratorContract.grantRole(BATTLE_REPORTER_ROLE, addresses.contracts.Arena);
    console.log(`   ✅ Granted BATTLE_REPORTER_ROLE to Arena on BattleNarrator`);

    // Grant ARENA_ROLE to Arena on RevenueDistributor
    const ARENA_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ARENA_ROLE"));
    const revenueContract = await ethers.getContractAt("RevenueDistributor", addresses.contracts.RevenueDistributor);
    await revenueContract.grantRole(ARENA_ROLE, addresses.contracts.Arena);
    console.log(`   ✅ Granted ARENA_ROLE to Arena on RevenueDistributor`);

    // Grant GAME_MASTER_ROLE to Arena on BuffOracle
    const GAME_MASTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GAME_MASTER_ROLE"));
    const buffOracleContract = await ethers.getContractAt("BuffOracle", addresses.contracts.BuffOracle);
    await buffOracleContract.grantRole(GAME_MASTER_ROLE, addresses.contracts.Arena);
    console.log(`   ✅ Granted GAME_MASTER_ROLE to Arena on BuffOracle`);

    // Set escrow on RevenueDistributor for reputation lookups
    await revenueContract.setEscrowContract(addresses.contracts.BribeEscrow);
    console.log(`   ✅ Set EscrowContract on RevenueDistributor`);

    // Grant ARENA_ROLE to Arena on AgentRegistry
    const ARENA_ROLE_REGISTRY = ethers.keccak256(ethers.toUtf8Bytes("ARENA_ROLE"));
    const agentRegistryContract = await ethers.getContractAt("AgentRegistry", addresses.contracts.AgentRegistry);
    await agentRegistryContract.grantRole(ARENA_ROLE_REGISTRY, addresses.contracts.Arena);
    console.log(`   ✅ Granted ARENA_ROLE to Arena on AgentRegistry`);

    // Grant UPDATER_ROLE to Arena on Leaderboard
    const UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("UPDATER_ROLE"));
    const leaderboardContract = await ethers.getContractAt("Leaderboard", addresses.contracts.Leaderboard);
    await leaderboardContract.grantRole(UPDATER_ROLE, addresses.contracts.Arena);
    console.log(`   ✅ Granted UPDATER_ROLE to Arena on Leaderboard`);

    // ═══════════════════════════════════════════════════════════════
    // SAVE DEPLOYMENT
    // ═══════════════════════════════════════════════════════════════
    const deploymentsPath = path.join(__dirname, "..", "deployments.json");
    fs.writeFileSync(deploymentsPath, JSON.stringify(addresses, null, 2));
    console.log(`\n📁 Deployment saved to: ${deploymentsPath}`);

    // ═══════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("                    DEPLOYMENT COMPLETE");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("\n📋 Contract Addresses:\n");
    console.log(`   BattleNarrator:     ${addresses.contracts.BattleNarrator}`);
    console.log(`   BuffOracle:         ${addresses.contracts.BuffOracle}`);
    console.log(`   BribeEscrow:        ${addresses.contracts.BribeEscrow}`);
    console.log(`   RevenueDistributor: ${addresses.contracts.RevenueDistributor}`);
    console.log(`   Arena:              ${addresses.contracts.Arena}`);
    console.log(`   AgentRegistry:      ${addresses.contracts.AgentRegistry}`);
    console.log(`   Leaderboard:        ${addresses.contracts.Leaderboard}`);
    console.log("\n═══════════════════════════════════════════════════════════════");

    // Verification commands
    console.log("\n🔍 To verify on block explorer, run:");
    console.log(`   npx hardhat verify --network monad-testnet ${addresses.contracts.Arena} ${deployer.address} ${deployer.address} ${addresses.contracts.BuffOracle} ${addresses.contracts.BribeEscrow} ${addresses.contracts.BattleNarrator} ${addresses.contracts.RevenueDistributor} ${addresses.contracts.AgentRegistry} ${addresses.contracts.Leaderboard}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
