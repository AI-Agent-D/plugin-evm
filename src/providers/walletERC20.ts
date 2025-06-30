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

export const getTokenDecimalsAddress = async (
  runtime: IAgentRuntime,
  _message: Memory,
  state?: State
): Promise<TokenData> => {
  // Look through all recent messages and figure out which tokens have been mentioned and on which chains.
  // Find the token decimals and addresses.
  // Format in the token data field.


  state = (await runtime.composeState(_message)) as State;
  
  const context = composePromptFromState({
    state,
    template: searchAddressTokenTemplate,
  });

  console.log("here is the context", context)

  const xmlResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
    ...state,
    prompt: context,
  });

  const parsedXml = parseKeyValueXml(xmlResponse);

  if (!parsedXml) {
    throw new Error('Failed to parse XML response from LLM for transfer details.');
  }

  return parsedXml as TokenData;
};

export const evmWalletERC20Provider: Provider = {
  name: 'EVM_ERC20_TRANSFER_TOKENS',
  async get(runtime: IAgentRuntime, _message: Memory, state: State): Promise<ProviderResult> {
    try {
      const walletProvider = await initWalletProvider(runtime);
      const agentName = state?.agentName || 'The agent';
      const tokenDataByChain = await getTokenDecimalsAddress(runtime, _message, state);

      console.log("token data", tokenDataByChain)

      const allChainTokenBalances = await Promise.all(
        Object.entries(tokenDataByChain).map(async ([chainName, tokenDataByTokenSymbol]) => {
          elizaLogger.log(`Currently querying: ${chainName}`)
          const tokenBalancesToQuery = Object.entries(tokenDataByTokenSymbol).map(
            ([tokenSymbol, { tokenAddress, tokenDecimals }]) => ({
              tokenSymbol,
              tokenAddress,
              tokenDecimals,
            })
          );

          const tokenBalances = await walletProvider.getWalletERC20BalancesForChain(
            chainName as SupportedChain,
            tokenBalancesToQuery
          );

          return `${chainName} Balances: ${tokenBalances.join(', ')}`;
        })
      );

      return {
        text: `${agentName}'s EVM Wallet Address: ${walletProvider.account.address}\n ${allChainTokenBalances.join('\n')}`,
      };

    } catch (error) {
      console.log('Error in EVM wallet provider:', error); //change this to elizalogger later.
      return {
        text: 'Error getting EVM wallet provider',
        data: {},
        values: {},
      };
    }
  },
};
