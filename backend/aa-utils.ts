/**
 * aa-utils.ts - Account Abstraction Utilities for Autonomous Agent Signing
 * 
 * Implements ERC-4337 compatible session keys for AI agents to sign transactions
 * without user approval. Uses SimpleAccount standard.
 * 
 * @author Monad Colosseum Team
 */

import { ethers, Wallet, Provider, Contract } from 'ethers';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface UserOperation {
    sender: string;
    nonce: bigint;
    initCode: string;
    callData: string;
    callGasLimit: bigint;
    verificationGasLimit: bigint;
    preVerificationGas: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    paymasterAndData: string;
    signature: string;
}

export interface AAConfig {
    entryPointAddress: string;
    accountFactoryAddress: string;
    bundlerUrl: string;
    chainId: number;
}

export interface SessionKey {
    privateKey: string;
    address: string;
    validUntil: number;
    permissions: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS (Monad Testnet)
// ═══════════════════════════════════════════════════════════════════════════════

export const MONAD_TESTNET_CONFIG: AAConfig = {
    entryPointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789', // Standard ERC-4337
    accountFactoryAddress: '0x9406Cc6185a346906296840746125a0E44976454', // SimpleAccountFactory
    bundlerUrl: 'https://monad-bundler.example.com/rpc', // Replace with actual
    chainId: 10143
};

// ═══════════════════════════════════════════════════════════════════════════════
// SIMPLE ACCOUNT ABI (Minimal)
// ═══════════════════════════════════════════════════════════════════════════════

const SIMPLE_ACCOUNT_ABI = [
    'function execute(address dest, uint256 value, bytes calldata func) external',
    'function executeBatch(address[] calldata dest, bytes[] calldata func) external',
    'function getNonce() view returns (uint256)',
    'function owner() view returns (address)'
];

const ENTRY_POINT_ABI = [
    'function getNonce(address sender, uint192 key) view returns (uint256)',
    'function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] ops, address beneficiary) external',
    'function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature) userOp) view returns (bytes32)'
];

// ═══════════════════════════════════════════════════════════════════════════════
// AA SIGNER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export class AASigner {
    private provider: Provider;
    private sessionKey: Wallet;
    private accountAddress: string;
    private config: AAConfig;
    private entryPoint: Contract;
    private account: Contract;

    // ═══════════════════════════════════════════════════════════════════════════
    // SESSION KEY SPENDING LIMITS (Security)
    // ═══════════════════════════════════════════════════════════════════════════

    private readonly MAX_SPEND_PER_SESSION: bigint = ethers.parseEther('10'); // 10 MONAD max
    private readonly SESSION_DURATION: number = 24 * 60 * 60 * 1000; // 24 hours

    private sessionStartTime: number;
    private totalSpentThisSession: bigint = 0n;
    private transactionCount: number = 0;
    private readonly MAX_TX_PER_SESSION: number = 100;

    constructor(
        provider: Provider,
        sessionKeyPrivateKey: string,
        accountAddress: string,
        config: AAConfig = MONAD_TESTNET_CONFIG
    ) {
        this.provider = provider;
        this.sessionKey = new Wallet(sessionKeyPrivateKey, provider);
        this.accountAddress = accountAddress;
        this.config = config;
        this.sessionStartTime = Date.now();

        this.entryPoint = new Contract(
            config.entryPointAddress,
            ENTRY_POINT_ABI,
            provider
        );

        this.account = new Contract(
            accountAddress,
            SIMPLE_ACCOUNT_ABI,
            provider
        );

        console.log(`[AA] Session started at ${new Date(this.sessionStartTime).toISOString()}`);
        console.log(`[AA] Max spend: ${ethers.formatEther(this.MAX_SPEND_PER_SESSION)} MONAD`);
    }

    /**
     * Check if session is still valid
     */
    isSessionValid(): boolean {
        const elapsed = Date.now() - this.sessionStartTime;
        return elapsed < this.SESSION_DURATION &&
            this.transactionCount < this.MAX_TX_PER_SESSION;
    }

    /**
     * Check if spending limit allows this transaction
     */
    canSpend(amount: bigint): boolean {
        return this.totalSpentThisSession + amount <= this.MAX_SPEND_PER_SESSION;
    }

    /**
     * Get remaining spend allowance
     */
    getRemainingSpendAllowance(): bigint {
        return this.MAX_SPEND_PER_SESSION - this.totalSpentThisSession;
    }

    /**
     * Get session info for debugging
     */
    getSessionInfo(): {
        started: string;
        expiresIn: number;
        totalSpent: string;
        transactionCount: number;
        remainingAllowance: string;
    } {
        const elapsed = Date.now() - this.sessionStartTime;
        return {
            started: new Date(this.sessionStartTime).toISOString(),
            expiresIn: Math.max(0, this.SESSION_DURATION - elapsed),
            totalSpent: ethers.formatEther(this.totalSpentThisSession),
            transactionCount: this.transactionCount,
            remainingAllowance: ethers.formatEther(this.getRemainingSpendAllowance())
        };
    }

    /**
     * Track spending after successful transaction
     */
    private trackSpending(amount: bigint): void {
        this.totalSpentThisSession += amount;
        this.transactionCount++;
        console.log(`[AA] Spent ${ethers.formatEther(amount)}, total: ${ethers.formatEther(this.totalSpentThisSession)}`);
    }

    /**
     * Get current nonce for the account
     */
    async getNonce(): Promise<bigint> {
        return await this.entryPoint.getNonce(this.accountAddress, 0);
    }

    /**
     * Build a UserOperation for executing a single call
     */
    async buildUserOp(
        target: string,
        value: bigint,
        data: string
    ): Promise<UserOperation> {
        // Encode the execute call
        const callData = this.account.interface.encodeFunctionData('execute', [
            target,
            value,
            data
        ]);

        const nonce = await this.getNonce();
        const feeData = await this.provider.getFeeData();

        const userOp: UserOperation = {
            sender: this.accountAddress,
            nonce,
            initCode: '0x', // Account already deployed
            callData,
            callGasLimit: 200000n,
            verificationGasLimit: 150000n,
            preVerificationGas: 50000n,
            maxFeePerGas: feeData.maxFeePerGas || 1000000000n,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || 1000000000n,
            paymasterAndData: '0x', // Self-paying
            signature: '0x' // Will be filled after signing
        };

        return userOp;
    }

    /**
     * Build a UserOperation for executing multiple calls (batch)
     */
    async buildBatchUserOp(
        targets: string[],
        datas: string[]
    ): Promise<UserOperation> {
        const callData = this.account.interface.encodeFunctionData('executeBatch', [
            targets,
            datas
        ]);

        const nonce = await this.getNonce();
        const feeData = await this.provider.getFeeData();

        const userOp: UserOperation = {
            sender: this.accountAddress,
            nonce,
            initCode: '0x',
            callData,
            callGasLimit: 300000n,
            verificationGasLimit: 150000n,
            preVerificationGas: 50000n,
            maxFeePerGas: feeData.maxFeePerGas || 1000000000n,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || 1000000000n,
            paymasterAndData: '0x',
            signature: '0x'
        };

        return userOp;
    }

    /**
     * Sign a UserOperation with the session key
     */
    async signUserOp(userOp: UserOperation): Promise<UserOperation> {
        // Get the hash that needs to be signed
        const userOpHash = await this.getUserOpHash(userOp);

        // Sign with session key
        const signature = await this.sessionKey.signMessage(
            ethers.getBytes(userOpHash)
        );

        return {
            ...userOp,
            signature
        };
    }

    /**
     * Calculate UserOperation hash
     */
    async getUserOpHash(userOp: UserOperation): Promise<string> {
        const packed = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'uint256', 'bytes32', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32'],
            [
                userOp.sender,
                userOp.nonce,
                ethers.keccak256(userOp.initCode),
                ethers.keccak256(userOp.callData),
                userOp.callGasLimit,
                userOp.verificationGasLimit,
                userOp.preVerificationGas,
                userOp.maxFeePerGas,
                userOp.maxPriorityFeePerGas,
                ethers.keccak256(userOp.paymasterAndData)
            ]
        );

        const opHash = ethers.keccak256(packed);

        return ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['bytes32', 'address', 'uint256'],
                [opHash, this.config.entryPointAddress, this.config.chainId]
            )
        );
    }

    /**
     * Submit UserOperation to bundler (autonomous execution!)
     */
    async submitUserOp(userOp: UserOperation): Promise<string> {
        const response = await fetch(this.config.bundlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'eth_sendUserOperation',
                params: [
                    this.serializeUserOp(userOp),
                    this.config.entryPointAddress
                ]
            })
        });

        const result = await response.json();

        if (result.error) {
            throw new Error(`Bundler error: ${result.error.message}`);
        }

        return result.result; // UserOp hash
    }

    /**
     * Wait for UserOperation to be included on-chain
     */
    async waitForUserOp(userOpHash: string, timeout: number = 60000): Promise<string> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const response = await fetch(this.config.bundlerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'eth_getUserOperationReceipt',
                    params: [userOpHash]
                })
            });

            const result = await response.json();

            if (result.result) {
                return result.result.receipt.transactionHash;
            }

            // Wait 2 seconds before polling again
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        throw new Error('UserOperation timed out');
    }

    /**
     * Execute a call autonomously (no user approval!)
     */
    async executeAutonomous(
        target: string,
        value: bigint,
        data: string
    ): Promise<string> {
        console.log(`[AA] Building UserOp for ${target}`);

        // Build UserOp
        const userOp = await this.buildUserOp(target, value, data);

        // Sign with session key
        const signedOp = await this.signUserOp(userOp);

        // Submit to bundler
        console.log('[AA] Submitting to bundler...');
        const opHash = await this.submitUserOp(signedOp);
        console.log(`[AA] UserOp submitted: ${opHash}`);

        // Wait for inclusion
        const txHash = await this.waitForUserOp(opHash);
        console.log(`[AA] Transaction confirmed: ${txHash}`);

        return txHash;
    }

    /**
     * Execute batch calls autonomously
     */
    async executeBatchAutonomous(
        targets: string[],
        datas: string[]
    ): Promise<string> {
        const userOp = await this.buildBatchUserOp(targets, datas);
        const signedOp = await this.signUserOp(userOp);
        const opHash = await this.submitUserOp(signedOp);
        return await this.waitForUserOp(opHash);
    }

    /**
     * Serialize UserOp for JSON-RPC
     */
    private serializeUserOp(userOp: UserOperation): Record<string, string> {
        return {
            sender: userOp.sender,
            nonce: '0x' + userOp.nonce.toString(16),
            initCode: userOp.initCode,
            callData: userOp.callData,
            callGasLimit: '0x' + userOp.callGasLimit.toString(16),
            verificationGasLimit: '0x' + userOp.verificationGasLimit.toString(16),
            preVerificationGas: '0x' + userOp.preVerificationGas.toString(16),
            maxFeePerGas: '0x' + userOp.maxFeePerGas.toString(16),
            maxPriorityFeePerGas: '0x' + userOp.maxPriorityFeePerGas.toString(16),
            paymasterAndData: userOp.paymasterAndData,
            signature: userOp.signature
        };
    }

    /**
     * Get account address
     */
    getAccountAddress(): string {
        return this.accountAddress;
    }

    /**
     * Get session key address
     */
    getSessionKeyAddress(): string {
        return this.sessionKey.address;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an AA signer for autonomous execution
 */
export function createAASigner(
    providerUrl: string,
    sessionKeyPrivateKey: string,
    accountAddress: string,
    config?: AAConfig
): AASigner {
    const provider = new ethers.JsonRpcProvider(providerUrl);
    return new AASigner(provider, sessionKeyPrivateKey, accountAddress, config);
}

/**
 * Generate a new session key
 */
export function generateSessionKey(): SessionKey {
    const wallet = Wallet.createRandom();
    return {
        privateKey: wallet.privateKey,
        address: wallet.address,
        validUntil: Math.floor(Date.now() / 1000) + 86400 * 7, // 7 days
        permissions: ['execute', 'bribe', 'attack', 'defend']
    };
}
