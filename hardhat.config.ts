// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-ethers";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
const MONAD_TESTNET_RPC = process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz";

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.20",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
                details: {
                    yul: true,
                    yulDetails: {
                        stackAllocation: true,
                        optimizerSteps: "dhfoDgvulfnTUtnIf"
                    }
                }
            },
            viaIR: true,  // Enabled to fix Stack Too Deep
            evmVersion: "paris"
        }
    },
    networks: {
        hardhat: {
            chainId: 31337,
            mining: {
                auto: true,
                interval: 1000
            }
        },
        monad_testnet: {
            url: MONAD_TESTNET_RPC,
            chainId: 10143,
            accounts: [PRIVATE_KEY],
            gasPrice: "auto"
        },
        localhost: {
            url: "http://127.0.0.1:8545",
            chainId: 31337
        }
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS === "true",
        currency: "USD",
        gasPrice: 21
    },
    paths: {
        sources: "./contracts",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts"
    },
    typechain: {
        outDir: "typechain-types",
        target: "ethers-v6"
    }
};

export default config;
