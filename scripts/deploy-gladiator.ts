// scripts/deploy-gladiator.ts
import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
    console.log("Deploying GladiatorFactory to Monad Testnet...");

    const [deployer] = await ethers.getSigners();
    console.log("Deployer address:", deployer.address);

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("Deployer balance:", ethers.formatEther(balance), "ETH");

    const GladiatorFactory = await ethers.getContractFactory("GladiatorFactory");
    const factory = await GladiatorFactory.deploy();

    await factory.waitForDeployment();

    const address = await factory.getAddress();
    console.log("GladiatorFactory deployed to:", address);

    // Save address to file
    fs.writeFileSync("deployed-address.txt", address);
    console.log("Address saved to deployed-address.txt");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
