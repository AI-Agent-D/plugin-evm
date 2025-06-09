import {
  type IAgentRuntime,
  type Provider,
  type Memory,
  type State,
  elizaLogger,
} from "@elizaos/core";
import {
  Account,
  Address,
  Chain,
  formatUnits,
  getAddress,
  getContract,
  HttpTransport,
  PublicClient,
} from "viem";
import { initWalletProvider } from "./wallet";
import { type SupportedChain } from "src/types";

export const getWalletERC20Balance = async (
  tokenAddress: string,
  tokenDecimals = 18,
  account: Address,
  client: PublicClient<HttpTransport, Chain, Account | undefined>,
): Promise<string | null> => {
  try {
    const contract = getContract({
      address: getAddress(tokenAddress) as `0x${string}`,
      abi: [
        {
          type: "function",
          name: "balanceOf",
          inputs: [
            {
              name: "account",
              type: "address",
              internalType: "address",
            },
          ],
          outputs: [
            {
              name: "",
              type: "uint256",
              internalType: "uint256",
            },
          ],
          stateMutability: "view",
        },
      ],
      client: {
        public: client as never,
      },
    }) as any;

    const balance = await contract.read.balanceOf([account]);
    const balanceFormatted = formatUnits(balance, tokenDecimals);
    elizaLogger.log(
      "Wallet ERC 20 balance cached for chain: ",
      client.chain.name,
    );
    return balanceFormatted;
  } catch (error) {
    console.error("Error getting wallet ERC20 balance:", error);
    return null;
  }
};

const TOKEN_ADDRS = {
  "Arbitrum One": {
    USDC: {
      tokenDecimals: 6,
      tokenAddress: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    },
  },
};

export const evmWalletERC20Provider: Provider = {
  async get(
    runtime: IAgentRuntime,
    _message: Memory,
    state?: State,
  ): Promise<string | null> {
    try {
      const walletProvider = await initWalletProvider(runtime);
      const chain = walletProvider.getCurrentChain();
      const agentName = state?.agentName || "The agent";
      const tokenAddresses = TOKEN_ADDRS[chain.name];

      const balances = await Promise.all(
        Object.keys(tokenAddresses).map(async (tokenName) => {
          const { tokenAddress, tokenDecimals } = tokenAddresses[tokenName];

          console.log(
            `Querying balance for ${tokenName} at address ${tokenAddress}`,
          );

          const client = walletProvider.getPublicClient(
            chain as unknown as SupportedChain,
          );
          const balance = await getWalletERC20Balance(
            tokenAddress,
            tokenDecimals,
            walletProvider.account.address,
            client,
          );
          return `${balance} ${tokenName}`;
        }),
      );

      return `${agentName}'s wallet holdings consists of ${balances.join(", ")} on chain ${chain.name}`;
    } catch (error) {
      console.error("Error in EVM wallet provider:", error);
      return null;
    }
  },
};
