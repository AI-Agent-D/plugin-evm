import {
  type IAgentRuntime,
  type Provider,
  type Memory,
  type State,
  type ProviderResult,
  composePromptFromState,
  ModelType,
  parseKeyValueXml,
  elizaLogger,
} from '@elizaos/core';
import { initWalletProvider } from './wallet';
import { type SupportedChain } from 'src/types';
import { searchAddressTokenTemplate } from 'src/templates';

interface TokenData {
  [chain: string]: {
  [token: string]: {
  tokenDecimals: number;
  tokenAddress: string;
  };
  };
  }

const getTokenDecimalsAddress = async(
  runtime: IAgentRuntime,
  _message: Memory,
  state?: State,
): Promise<TokenData> =>  {

  // Look through all recent messages and figure out which tokens have been mentioned and on which chains.
  // Find the token decimals and addresses.
  // Format in the token data field.

  if (!state) {
    state = (await runtime.composeState(_message)) as State;
  } 

  const context = composePromptFromState({
      state,
      template: searchAddressTokenTemplate,
    });
  
    const xmlResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
      ...state,
      prompt: context,
    });

    const parsedXml = parseKeyValueXml(xmlResponse);

    if (!parsedXml) {
      throw new Error('Failed to parse XML response from LLM for transfer details.');
    }

    return parsedXml as TokenData;
}

export const evmWalletERC20Provider: Provider = {
  name: "EVM_ERC20_TRANSFER_TOKENS",
  async get(runtime: IAgentRuntime, _message: Memory, state: State): Promise<ProviderResult> {
    try {
      const walletProvider = await initWalletProvider(runtime);
      const agentName = state?.agentName || 'The agent';
      const tokenAddresses = await getTokenDecimalsAddress(runtime, _message, state)
      
      let queriedChainBalances = ``

      for (const currentChain in tokenAddresses) {
        const chain = currentChain as unknown as SupportedChain

        const balances = await Promise.all(
        Object.keys(tokenAddresses).map(async (tokenName) => {
          const { tokenAddress, tokenDecimals } = tokenAddresses[tokenName].token;

          elizaLogger.log(`Querying balance for ${tokenAddresses[tokenName]} at address ${tokenAddress}`);

          const balances = await walletProvider.getWalletBalanceForERC20(
            chain,
            tokenDecimals,
            tokenAddress
          );
          return `${balances} ${tokenName}`;
        })
        );

        queriedChainBalances += `${agentName}'s wallet holdings consists of ${balances} on chain ${chain}`
    }

      return {
        text: queriedChainBalances,
        data: {},
        values: {},
      };

    } catch (error) {
      console.error('Error in EVM wallet provider:', error);
      return {
        text: 'Error getting EVM wallet provider',
        data: {},
        values: {},
      };
    }
  },
};
