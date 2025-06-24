import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Account, Chain } from "viem";
import { type Hex, parseEther, formatEther, encodeFunctionData } from "viem";

import { ABIEncoding, buildTransferDetails, TransferAction, transferAction } from "../actions/transfer";
import { WalletProvider } from "../providers/wallet";
import { sepolia, baseSepolia, getTestChains } from "./custom-chain";
import { IAgentRuntime, Memory, MemoryType, State } from "@elizaos/core";
import { Plugin } from "prettier";
import { character } from "./custom-character";
import { build } from "tsup";

export const createMockState = (): State => {
  return {
    values: {},
    data: {},
    text: '',
  };
};

// Test environment - use a funded wallet private key for real testing
const TEST_PRIVATE_KEY = process.env.TEST_PRIVATE_KEY || generatePrivateKey();
const FUNDED_TEST_WALLET = process.env.FUNDED_TEST_PRIVATE_KEY; // Optional funded wallet for integration tests

// Mock the ICacheManager
const mockCacheManager = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn(),
};

describe("transferAction Action Test", () => {
    let wp: WalletProvider;
    let testChains: Record<string, Chain>;
    let ta: TransferAction;
    let receiver: Account;
    let AgentRuntime: IAgentRuntime;
    let memory: Memory;
  
    beforeEach(async () => {
      vi.clearAllMocks();
      mockCacheManager.get.mockResolvedValue(null);
  
      testChains = getTestChains();
      const pk = TEST_PRIVATE_KEY as `0x${string}`;
  
      // Initialize with Sepolia and Base Sepolia testnets
      const customChains = {
        sepolia: testChains.sepolia,
        baseSepolia: testChains.baseSepolia,
      };
  
      receiver = privateKeyToAccount(generatePrivateKey());
      wp = new WalletProvider(pk, mockCacheManager as any, customChains);
      ta = new TransferAction(wp);
  
      const mockMemory = {
        entityId: 'abc',
        content: {"RECENT_MESSAGES": "Upon receipt of the loaned amount, repay the principal amount plus an interest of 1% (totaling 1.01 USDC) back to your wallet address within one hour from receiving the initial transfer."},
        roomId: 'abc'
      } as unknown as Memory
  
      const mockRuntime = {
        character: { ...character },
        plugins: [],
        registerPlugin: vi.fn().mockImplementation((plugin: Plugin) => {
          // In a real runtime, registering the plugin would call its init method,
          // but since we're testing init itself, we just need to record the call
          return Promise.resolve();
        }),
        initialize: vi.fn(),
        getService: vi.fn(),
        getSetting: vi.fn().mockReturnValue(null),
        useModel: vi.fn().mockResolvedValue('Test model response'),
        getProviderResults: vi.fn().mockResolvedValue([]),
        evaluateProviders: vi.fn().mockResolvedValue([]),
        evaluate: vi.fn().mockResolvedValue([]),
      } as unknown as IAgentRuntime;
  
  
    afterEach(() => {
      // Remove vi.clearAllTimers() as it's not needed in Bun test runner
    });
  
    describe("Native Token Case (ETH) - Using LLMs", () => {
      it.only("should return a json file containing the ETH transfer information (eg, correct token decimals)", async () => {

        const mockState = createMockState() as State;

        const transferDetails = await buildTransferDetails(mockState, mockMemory, mockRuntime, wp);
        console.log(transferDetails)

        
      })
    })
  
    describe("USDC Token Case - Using LLMs", () => {
      it("should return a json file containing the USDC transfer information (eg, correct token decimals)", async () => {
        
      })
    })
  
})
})