import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Account, Chain } from 'viem';
import { parseEther } from 'viem';

import {
  buildTransferDetails,
  getTransferCallData,
  TransferAction,
} from '../../actions/transfer';
import { WalletProvider } from '../../providers/wallet';
import { getTestChains } from '../custom-chain';
import {
  AgentRuntime,
  IAgentRuntime,
  IDatabaseAdapter,
  Memory,
  State,
  stringToUuid,
} from '@elizaos/core';
import { character } from '../custom-character';
import evmPlugin from 'src';

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
const THRESHOLD = process.env.THRESHOLD;
const NUMBER_OF_TIMES_RUN = process.env.NUMBER_OF_TIMES_RUN;


// Mock the ICacheManager
const mockCacheManager = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn(),
  getCache: vi.fn(),
  setCache: vi.fn(),
  getService: vi.fn(),
};

const mockAdapter = {
  log: vi.fn(),
};

describe('transferAction Action Test', () => {
  let wp: WalletProvider;
  let testChains: Record<string, Chain>;
  let ta: TransferAction;
  let receiver: Account;
  let mockAgentRuntime: IAgentRuntime;
  let mockMemory: Memory;
  let mockState: State;

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

    mockAgentRuntime = new AgentRuntime({
      character: character,
      adapter: mockAdapter as unknown as IDatabaseAdapter,
    });
    mockAgentRuntime.registerPlugin(evmPlugin);

    mockMemory = {
      agentId: mockAgentRuntime.agentId,
      entityId: stringToUuid('Entity-Id'),
      roomId: stringToUuid('Room-ID'),
      content: {
        text: `Please transfer 0.0001 ETH to address: ${receiver.address} on the sepolia network`,
      },
    } as unknown as Memory;

    // Set the memory and runtime variables
    mockState = createMockState() as State;
  });

  afterEach(() => {
    // Remove vi.clearAllTimers() as it's not needed in Bun test runner
  });

  describe('Native Token Case (ETH) - Using LLMs', () => {
    it('should return a json file containing the ETH transfer information (eg, correct token decimals) on sepolia', async () => {
      const correctChain = 'sepolia';
      let counter = 0;
      const numberOfTimesRun = NUMBER_OF_TIMES_RUN as unknown as number;
      const threshold = THRESHOLD as unknown as number;

      const correctAnswers = {
        fromChain: correctChain,
        amount: parseEther('0.0001'),
        token: 'ETH',
        tokenDecimals: 18,
        recipientAddress: receiver.address,
        data: await getTransferCallData(parseEther('0.0001'), receiver.address),
      };

      mockState.recentMessages = `Please transfer 0.0001 ETH to address: ${receiver.address} on the sepolia network`;
      mockAgentRuntime.composeState = vi.fn().mockResolvedValue(mockState);

      for (let i = 0; i < numberOfTimesRun; i++) {
        const transferDetails = await buildTransferDetails(
          mockState,
          mockMemory,
          mockAgentRuntime,
          wp
        );

        if (
          correctAnswers.fromChain === transferDetails.fromChain &&
          correctAnswers.amount === transferDetails.amount &&
          correctAnswers.token === transferDetails.token &&
          correctAnswers.tokenDecimals === transferDetails.tokenDecimals &&
          correctAnswers.recipientAddress === transferDetails.recipientAddress &&
          transferDetails.data === correctAnswers.data
        ) {
          console.log(`Iteration ${i} is correct`);
          counter += 1;
        } else {
          if (correctAnswers.fromChain !== transferDetails.fromChain)
            console.log(
              'fromChain mismatch:',
              correctAnswers.fromChain,
              'vs',
              transferDetails.fromChain
            );
          if (correctAnswers.amount !== transferDetails.amount)
            console.log('amount mismatch:', correctAnswers.amount, 'vs', transferDetails.amount);
          if (correctAnswers.token !== transferDetails.token)
            console.log('token mismatch:', correctAnswers.token, 'vs', transferDetails.token);
          if (correctAnswers.tokenDecimals !== transferDetails.tokenDecimals)
            console.log(
              'tokenDecimals mismatch:',
              correctAnswers.tokenDecimals,
              'vs',
              transferDetails.tokenDecimals
            );
          if (correctAnswers.recipientAddress !== transferDetails.recipientAddress)
            console.log(
              'recipientAddress mismatch:',
              correctAnswers.recipientAddress,
              'vs',
              transferDetails.recipientAddress
            );
          if (transferDetails.data !== correctAnswers.data)
            console.log('data mismatch:', transferDetails.data, 'vs', correctAnswers.data);
          console.log(`Iteration ${i} is incorrect`);
        }
      }

      const final = counter / numberOfTimesRun;
      expect(final).toBeGreaterThanOrEqual(threshold);
    });
  });

  describe('USDC Token Case - Using LLMs', () => {
    it.only('should return a json file containing the USDC transfer information (eg, correct token decimals) on baseSepolia', async () => {
      const chain = 'baseSepolia';
      let counter = 0;
      const numberOfTimesRun = NUMBER_OF_TIMES_RUN as unknown as number;
      const threshold = THRESHOLD as unknown as number;

      console.log("Here is the threshold", threshold)
      console.log("Here is the number of times run", numberOfTimesRun)

      const correctAnswers = {
        fromChain: chain,
        amount: 10n, // 0.0001 USDC
        token: 'USDC',
        tokenDecimals: 6,
        recipientAddress: receiver.address,
        data: await getTransferCallData(10n, receiver.address),
      };

      mockState.recentMessages = `Please transfer 0.0001 USDC to address: ${receiver.address} on the Base Sepolia network`;
      mockAgentRuntime.composeState = vi.fn().mockResolvedValue(mockState);

      for (let i = 0; i < numberOfTimesRun; i++) {
        const transferDetails = await buildTransferDetails(
          mockState,
          mockMemory,
          mockAgentRuntime,
          wp
        );

        if (
          correctAnswers.fromChain === transferDetails.fromChain &&
          correctAnswers.amount === transferDetails.amount &&
          correctAnswers.token === transferDetails.token &&
          correctAnswers.tokenDecimals === transferDetails.tokenDecimals &&
          correctAnswers.recipientAddress === transferDetails.recipientAddress &&
          transferDetails.data === correctAnswers.data
        ) {
          console.log(`Iteration ${i} is correct`);
          counter += 1;
        } else {
          if (correctAnswers.fromChain !== transferDetails.fromChain)
            console.log(
              'fromChain mismatch:',
              correctAnswers.fromChain,
              'vs',
              transferDetails.fromChain
            );
          if (correctAnswers.amount !== transferDetails.amount)
            console.log('amount mismatch:', correctAnswers.amount, 'vs', transferDetails.amount);
          if (correctAnswers.token !== transferDetails.token)
            console.log('token mismatch:', correctAnswers.token, 'vs', transferDetails.token);
          if (correctAnswers.tokenDecimals !== transferDetails.tokenDecimals)
            console.log(
              'tokenDecimals mismatch:',
              correctAnswers.tokenDecimals,
              'vs',
              transferDetails.tokenDecimals
            );
          if (correctAnswers.recipientAddress !== transferDetails.recipientAddress)
            console.log(
              'recipientAddress mismatch:',
              correctAnswers.recipientAddress,
              'vs',
              transferDetails.recipientAddress
            );
          if (transferDetails.data !== correctAnswers.data)
            console.log('data mismatch:', transferDetails.data, 'vs', correctAnswers.data);
          console.log(`Iteration ${i} is incorrect`);
        }
      }

      const final = counter / numberOfTimesRun;
      expect(final).toBeGreaterThanOrEqual(threshold);
    });
  });
});
