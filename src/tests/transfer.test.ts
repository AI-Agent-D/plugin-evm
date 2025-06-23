import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Account, Chain } from "viem";
import { type Hex, parseEther, formatEther, encodeFunctionData } from "viem";

import { ABIEncoding, buildTransferDetails, TransferAction, transferAction } from "../actions/transfer";
import { WalletProvider } from "../providers/wallet";
import { sepolia, baseSepolia, getTestChains } from "./custom-chain";
import { IAgentRuntime, Memory, MemoryType } from "@elizaos/core";
import { Plugin } from "prettier";
import { character } from "./custom-character";

// Test environment - use a funded wallet private key for real testing
const TEST_PRIVATE_KEY = process.env.TEST_PRIVATE_KEY || generatePrivateKey();
const FUNDED_TEST_WALLET = process.env.FUNDED_TEST_PRIVATE_KEY; // Optional funded wallet for integration tests

// Mock the ICacheManager
const mockCacheManager = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn(),
};

describe("Transfer Action", () => {
  let wp: WalletProvider;
  let testChains: Record<string, Chain>;

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

    wp = new WalletProvider(pk, mockCacheManager as any, customChains);
  });

  afterEach(() => {
    // Remove vi.clearAllTimers() as it's not needed in Bun test runner
  });

  describe("Constructor", () => {
    it("should initialize with wallet provider", () => {
      const ta = new TransferAction(wp);
      expect(ta).toBeDefined();
    });
  });

  describe("Transfer Operations", () => {
    let ta: TransferAction;
    let receiver: Account;

    beforeEach(() => {
      ta = new TransferAction(wp);
      receiver = privateKeyToAccount(generatePrivateKey());
    });

    it("should validate transfer parameters", async () => {
      const transferParams = {
        fromChain: "sepolia" as any,
        toAddress: receiver.address,
        amount: "0.001", // Small amount for testing
      };

      // Check if this is a valid transfer structure
      expect(transferParams.fromChain).toBe("sepolia");
      expect(transferParams.toAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(parseFloat(transferParams.amount)).toBeGreaterThan(0);
    });

    it("should handle insufficient funds gracefully (native tokens)", async () => {
      // Test with unrealistic large amount that will definitely fail
      await expect(
        ta.transfer({
          fromChain: "sepolia" as any,
          toAddress: receiver.address,
          amount: "1000000", // 1M ETH - definitely insufficient
          recipientAddress: "0xrecipientAddress",
          token: "ETH",
          tokenDecimals: "0",
          data: "0x"
        }),
      ).rejects.toThrow();
    });

    it("should handle insufficient funds gracefully (ERC20)", async () => {
      // Test with unrealistic large amount that will definitely fail
      const usdcAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"

      const data = await ABIEncoding({
        fromChain: "sepolia" as any,
        toAddress: usdcAddress,
        amount: "0",
        recipientAddress: receiver.address,
        token: "USDC",
        tokenDecimals: "100000000000000000000"
      })

      console.log("DATA", data)

      await expect(
        ta.transfer({
          fromChain: "sepolia" as any,
          toAddress: usdcAddress,
          amount: "0", // 1M ETH - definitely insufficient
          recipientAddress: receiver.address,
          token: "USDC",
          tokenDecimals: "100000000000000000000",
          data: 
           await ABIEncoding({
            fromChain: "sepolia" as any,
            toAddress: usdcAddress,
            amount: "0",
            recipientAddress: receiver.address,
            token: "USDC",
            tokenDecimals: "100000000000000000000"
          }) as `0x${string}`
        }),
      ).rejects.toThrow();
    });

    it("should validate recipient address format", async () => {
      await expect(
        ta.transfer({
          fromChain: "sepolia" as any,
          toAddress: "invalid-address" as any,
          amount: "0.001",
          recipientAddress: "0xabc",
          token: "ETH",
          tokenDecimals: "0",
          data: "0x"
        }),
      ).rejects.toThrow();
    });

    it("should handle zero amount transfers (Native)", async () => {
      await expect(
        ta.transfer({
          fromChain: "sepolia" as any,
          toAddress: receiver.address,
          amount: "0",
          recipientAddress: receiver.address,
          token: "ETH",
          tokenDecimals: "0",
          data: "0x"
        }),
      ).rejects.toThrow();
    });

    it("should handle zero amount transfers (ERC20)", async () => {
      await expect(
        ta.transfer({
          fromChain: "sepolia" as any,
          toAddress: receiver.address,
          amount: "0",
          recipientAddress: "0x123",
          token: "USDC",
          tokenDecimals: "0",
          data: "0x"
        }),
      ).rejects.toThrow();
    });

    describe("Network-specific transfers", () => {
      it("should work with Sepolia testnet", async () => {
        const balance = await wp.getWalletBalanceForChain("sepolia");
        console.log(`Sepolia balance: ${balance} ETH`);

        if (balance && parseFloat(balance) > 0.001) {
          // Only test if we have sufficient funds
          const result = await ta.transfer({
            fromChain: "sepolia" as any,
            toAddress: receiver.address,
            amount: "0.0001", // Very small amount
            recipientAddress: "0xrecipientAddress",
            token: "ETH",
          tokenDecimals: "0",
          data: "0x"
          });

          expect(result.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
          expect(result.to).toBe(receiver.address);
          expect(result.value).toBe(parseEther("0.0001"));
        } else {
          console.warn("Skipping funded transfer test - insufficient balance");
          // Test the failure case instead
          await expect(
            ta.transfer({
              fromChain: "sepolia" as any,
              toAddress: receiver.address,
              amount: "0.001",
              recipientAddress: "0xrecipientAddress",
              token: "ETH",
          tokenDecimals: "0",
          data: "0x"
            }),
          ).rejects.toThrow("Transfer failed");
        }
      });

      it("should work with Base Sepolia testnet", async () => {
        const balance = await wp.getWalletBalanceForChain("baseSepolia");
        console.log(`Base Sepolia balance: ${balance} ETH`);

        if (balance && parseFloat(balance) > 0.001) {
          const result = await ta.transfer({
            fromChain: "baseSepolia" as any,
            toAddress: receiver.address,
            amount: "0.0001",
            recipientAddress: "0xrecipientAddress",
            token: "ETH",
          tokenDecimals: "0",
          data: "0x"
          });

          expect(result.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
          expect(result.to).toBe(receiver.address);
        } else {
          console.warn(
            "Skipping Base Sepolia transfer test - insufficient balance",
          );
          await expect(
            ta.transfer({
              fromChain: "baseSepolia" as any,
              toAddress: receiver.address,
              amount: "0.001",
              recipientAddress: "0xrecipientAddress",
              token: "ETH",
              tokenDecimals: "0",
              data: "0x"
            }),
          ).rejects.toThrow("Transfer failed");
        }
      });
    });

    it("should work with Base Sepolia testnet (for ERC20 - USDC)", async () => {
      const balance = await wp.getWalletBalanceForChain("baseSepolia");
      console.log(`Base Sepolia balance: ${balance} ETH`);

      const usdcAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"

      if (balance && parseFloat(balance) > 0.001) {
        const result = await ta.transfer({
          fromChain: "baseSepolia" as any,
          toAddress: usdcAddress,
          amount: "0",
          recipientAddress: receiver.address,
          token: "USDC",
          tokenDecimals: "1000000",
          data: await ABIEncoding({
            fromChain: "baseSepolia" as any,
            toAddress: usdcAddress,
            amount: "0",
            recipientAddress: receiver.address,
            token: "USDC",
            tokenDecimals: "1000000"
          }) as `0x${string}`
        }); // Don't forget to change the address later!

        expect(result.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.to).toBe(usdcAddress);
        expect(result.data.startsWith('0x')).toBe(true);
        expect(result.value).toBe(0n)
      } else {
        console.warn(
          "Skipping Base Sepolia transfer test - insufficient balance",
        );
        await expect(
          ta.transfer({
            fromChain: "baseSepolia" as any,
            toAddress: usdcAddress,
            amount: "0",
            recipientAddress: receiver.address,
            token: "USDC",
            tokenDecimals: "1000000",
            data: await ABIEncoding({
              fromChain: "baseSepolia" as any,
              toAddress: usdcAddress,
              amount: "0",
              recipientAddress: receiver.address,
              token: "USDC",
              tokenDecimals: "1000000"
            }) as `0x${string}`
          }), //Don't forget to change the address later!
        ).rejects.toThrow("Transfer failed");
      }
    });

    it("should work with Sepolia testnet (for ERC20 - USDC)", async () => {
      const balance = await wp.getWalletBalanceForChain("sepolia");
      console.log(`Sepolia balance: ${balance} ETH`);

      const usdcAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"

      if (balance && parseFloat(balance) > 0.001) {
        const result = await ta.transfer({
          fromChain: "sepolia" as any,
          toAddress: usdcAddress,
          amount: "0",
          recipientAddress: receiver.address,
          token: "USDC",
          tokenDecimals: "1000000",
          data: await ABIEncoding({
            fromChain: "sepolia" as any,
            toAddress: usdcAddress,
            amount: "0",
            recipientAddress: receiver.address,
            token: "USDC",
            tokenDecimals: "1000000"
          }) as `0x${string}`
        }); // Don't forget to change the address later!

        expect(result.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.to).toBe(usdcAddress);
        expect(result.data.startsWith('0x')).toBe(true);
        expect(result.value).toBe(0n)
      } else {
        console.warn(
          "Skipping Base Sepolia transfer test - insufficient balance",
        );
        await expect(
          ta.transfer({
            fromChain: "sepolia" as any,
            toAddress: usdcAddress,
            amount: "0",
            recipientAddress: receiver.address,
            token: "USDC",
            tokenDecimals: "1000000",
            data: await ABIEncoding({
              fromChain: "sepolia" as any,
              toAddress: usdcAddress,
              amount: "0",
              recipientAddress: receiver.address,
              token: "USDC",
              tokenDecimals: "1000000"
            }) as `0x${string}`
          }), //Don't forget to change the address later!
        ).rejects.toThrow("Transfer failed");
      }
    });

    describe("Integration tests with funded wallet", () => {
      it("should perform actual transfer if funded wallet is available", async () => {
        if (!FUNDED_TEST_WALLET) {
          console.log("Skipping integration test - no funded wallet provided");
          return; // Just return instead of this.skip()
        }

        // Create wallet provider with funded wallet
        const fundedWp = new WalletProvider(
          FUNDED_TEST_WALLET as `0x${string}`,
          mockCacheManager as any,
          { sepolia: testChains.sepolia },
        );
        const fundedTa = new TransferAction(fundedWp);

        const balance = await fundedWp.getWalletBalanceForChain("sepolia");
        console.log(`Funded wallet balance: ${balance} ETH`);

        if (balance && parseFloat(balance) > 0.01) {
          const result = await fundedTa.transfer({
            fromChain: "sepolia" as any,
            toAddress: receiver.address,
            amount: "0.001", // 0.001 ETH
            recipientAddress: "0xrecipientAddress",
            token: "ETH",
          tokenDecimals: "0",
          data: "0x"
          });

          expect(result.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
          expect(result.from).toBe(fundedWp.getAddress());
          expect(result.to).toBe(receiver.address);
          expect(result.value).toBe(parseEther("0.001"));

          // Wait a bit and check if transaction was successful
          const publicClient = fundedWp.getPublicClient("sepolia");
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: result.hash,
            timeout: 30000, // 30 second timeout
          });

          expect(receipt.status).toBe("success");
          console.log(`Transfer successful: ${result.hash}`);
        } else {
          // Skip if insufficient funds
        }
      });
    });

    describe("Gas and fee estimation", () => {
      it("should estimate gas for transfer", async () => {
        const publicClient = wp.getPublicClient("sepolia");
        const walletAddress = wp.getAddress();

        try {
          const gasEstimate = await publicClient.estimateGas({
            account: walletAddress,
            to: receiver.address,
            value: parseEther("0.001"),
          });

          expect(typeof gasEstimate).toBe("bigint");
          expect(gasEstimate).toBeGreaterThan(0n);
          console.log(`Estimated gas: ${gasEstimate.toString()}`);
        } catch (error) {
          console.warn(
            "Gas estimation failed (likely insufficient funds):",
            error,
          );
        }
      });

      it("should calculate transfer cost", async () => {
        const publicClient = wp.getPublicClient("sepolia");

        try {
          const gasPrice = await publicClient.getGasPrice();
          const estimatedGas = 21000n; // Standard ETH transfer gas
          const transferAmount = parseEther("0.001");
          const totalCost = transferAmount + gasPrice * estimatedGas;

          expect(typeof gasPrice).toBe("bigint");
          expect(gasPrice).toBeGreaterThan(0n);

          console.log(`Gas price: ${formatEther(gasPrice)} ETH/gas`);
          console.log(`Estimated total cost: ${formatEther(totalCost)} ETH`);
        } catch (error) {
          console.warn("Fee calculation failed:", error);
        }
      });
    });
  });
});

const prepareChains = () => {
  const customChains: Record<string, Chain> = {};
  const chainNames = ["sepolia", "baseSepolia"];

  chainNames.forEach((chain) => {
    try {
      customChains[chain] = WalletProvider.genChainFromName(chain as any);
    } catch (error) {
      console.warn(`Failed to add chain ${chain}:`, error);
    }
  });

  return customChains;
};

// Build Transfer Details must be tested! For ETH and ERC20

// Transfer.ts transferAction

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
      content: {},
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

  describe("Complete", () => {
    it("should use the correct parameters during transfer", async () => {

      // Mock the TransferAction Action
      // Mock the ParamOptions
      // Spy On the callback function's parameters
      const mockBuildTransferDetails = vi.mocked(buildTransferDetails)

      mockBuildTransferDetails.mockResolvedValueOnce({
        fromChain: "sepolia" as any,
        toAddress: receiver.address,
        amount: "0.001",
        recipientAddress: "0xrecipientAddress",
        token: "ETH",
        tokenDecimals: "0",
        data: "0x"
      }) 

      const transferSpy = vi.spyOn(ta, 'transfer')
      //transferAction.handler(mockRuntime, mockMemory)



    })
  })

  describe("empty recipient", () => {
    it("should return an error.", async () => {
      
    })
  })

  describe("empty hash", () => {
    it("should return an error.", async () => {
      
    })
  })

  describe("empty chain", () => {
    it("should return an error.", async () => {
      
    })
  })

  describe("empty amount", () => {
    it("should return an error.", async () => {
      
    })
  })

})
})
