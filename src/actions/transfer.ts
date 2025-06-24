import {
  type Action,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type State,
  parseKeyValueXml,
  composePromptFromState,
} from "@elizaos/core";
import { type Hex, encodeFunctionData, formatEther, getAddress, parseEther, parseUnits } from "viem";

import { type WalletProvider, initWalletProvider } from "../providers/wallet";
import { transferTemplate } from "../templates";
import type { Transaction, TransferParams } from "../types";
import { supportedChains } from "@lifi/data-types";
import { printer } from "prettier/doc.js";

export const getTransferData = async (amount: bigint | number, recipientAddress: string, tokenDecimals: number): Promise<Hex> => {

  const abi = [
    {
        "constant": false,
        "inputs": [
            {
                "name": "to",
                "type": "address"
            },
            {
                "name": "amount",
                "type": "uint256"
            }
        ],
        "name": "transfer",
        "outputs": [],
        "payable": true,
        "stateMutability": "nonpayable",
        "type": "function"
    }
    ]

    return encodeFunctionData({
      abi: abi,
      functionName: 'transfer',
      args: [
        recipientAddress,
        parseUnits(String(amount), tokenDecimals)
      ]
    }) 
  };


// Exported for tests

const isNativeTransfer = (transferParams: TransferParams) => {
  return (transferParams.toAddress === transferParams.recipientAddress)
}
export class TransferAction {
  constructor(private walletProvider: WalletProvider) {}

  async transfer(params: TransferParams): Promise<Transaction> {

    if (!params.amount) {
        throw new Error("0 transfer!")
    }

    const walletClient = this.walletProvider.getWalletClient(params.fromChain);

    if (!walletClient.account) {
      throw new Error("Wallet account is not available");
    }
  
    try {

      const value = isNativeTransfer(params) ? parseEther(params.amount.toString()) : BigInt(0)

      const hash = await walletClient.sendTransaction({
        account: walletClient.account,
        to: params.toAddress,
        value,
        data: params.data,
        chain: walletClient.chain,
      });

      return {
        hash,
        from: walletClient.account.address,
        to: params.toAddress,
        value,
        data: params.data as Hex,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Transfer failed: ${errorMessage}`);
    }
  }
}

export const buildTransferDetails = async (
  state: State,
  _message: Memory,
  runtime: IAgentRuntime,
  wp: WalletProvider,
): Promise<TransferParams> => {
  const chains = wp.getSupportedChains();

  // Add balances to state for better context in template
  const balances = await wp.getWalletBalances();
  state.chainBalances = Object.entries(balances)
    .map(([chain, balance]) => {
      const chainConfig = wp.getChainConfigs(chain as any);
      return `${chain}: ${balance} ${chainConfig.nativeCurrency.symbol}`;
    })
    .join(", ");

  state = await runtime.composeState(_message, ["RECENT_MESSAGES"], true);
  state.supportedChains = chains.join(" | ");

  const context = composePromptFromState({
    state,
    template: transferTemplate,
  });

  const xmlResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
    prompt: context,
  });

  const parsedXml = parseKeyValueXml(xmlResponse);
  

  if (!parsedXml) {
    throw new Error(
      "Failed to parse XML response from LLM for transfer details.",
    );
  }

  const transferDetails = {
    ...parsedXml,
    fromChain: parsedXml.fromChain,
    amount: BigInt(parsedXml.amount),
    recipientAddress: getAddress(parsedXml.recipientAddress),
    tokenDecimals: Number(parsedXml.tokenDecimals),
    toAddress: getAddress(parsedXml.toAddress),
    token: parsedXml.token
  } as TransferParams;

  const data = await getTransferData(transferDetails.amount, transferDetails.recipientAddress, transferDetails.tokenDecimals)

  transferDetails.data = data 

  // Normalize chain name to lowercase to handle case sensitivity issues
  const normalizedChainName = transferDetails.fromChain.toLowerCase();

  // Check if the normalized chain name exists in the supported chains
  const existingChain = wp.chains[normalizedChainName];

  if (!existingChain) {
    throw new Error(
      "The chain " +
        transferDetails.fromChain +
        " not configured yet. Add the chain or choose one from configured: " +
        chains.toString(),
    );
  }

  // Update the transferDetails with the normalized chain name
  transferDetails.fromChain = normalizedChainName as any;

  return transferDetails;
};

export const transferAction: Action = {
  name: "EVM_TRANSFER_TOKENS",
  description: "Transfer tokens between addresses on the same chain",
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    _options: any,
    callback?: HandlerCallback,
  ) => {
    if (!state) {
      state = (await runtime.composeState(message)) as State;
    }

    const walletProvider = await initWalletProvider(runtime);
    const action = new TransferAction(walletProvider);

    // Compose transfer context
    const paramOptions = await buildTransferDetails(
      state,
      message,
      runtime,
      walletProvider,
    );

    try {
      const transferResp = await action.transfer(paramOptions);
      if (callback) {

        callback({
          text: `Successfully transferred ${paramOptions.amount} tokens to ${paramOptions.recipientAddress} Transaction Hash: ${transferResp.hash}`,
          content: {
            success: true,
            hash: transferResp.hash,
            amount: paramOptions.amount,
            recipient: paramOptions.recipientAddress,
            chain: paramOptions.fromChain,
          },
        });
      }
      return true;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Error during token transfer:", errorMessage);
      if (callback) {
        callback({
          text: `Error transferring tokens: ${errorMessage}`,
          content: { error: errorMessage },
        });
      }
      return false;
    }
  },
  validate: async (runtime: IAgentRuntime) => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    return typeof privateKey === "string" && privateKey.startsWith("0x");
  },
  examples: [
    [
      {
        name: "assistant",
        content: {
          text: "I'll help you transfer 1 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
          action: "SEND_TOKENS",
        },
      },
      {
        name: "user",
        content: {
          text: "Transfer 1 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
          action: "SEND_TOKENS",
        },
      },
    ],
  ],
  similes: [
    "EVM_TRANSFER",
    "EVM_SEND_TOKENS",
    "EVM_TOKEN_TRANSFER",
    "EVM_MOVE_TOKENS",
  ],
};
