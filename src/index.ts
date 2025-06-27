export * from './actions/bridge';
export * from './actions/swap';
export * from './actions/transfer';
export * from './providers/wallet';
export * from './service';
export * from './types';

import { IAgentRuntime, ModelType, type Plugin } from '@elizaos/core';
import { bridgeAction } from './actions/bridge';
import { swapAction } from './actions/swap';
import { transferAction } from './actions/transfer';
import { evmWalletProvider } from './providers/wallet';
import { EVMService } from './service';
import OpenAI from 'openai';

export const evmPlugin: Plugin = {
  name: 'evm',
  description: 'EVM blockchain integration plugin',
  providers: [evmWalletProvider],
  evaluators: [],
  services: [EVMService],
  actions: [transferAction, bridgeAction, swapAction],
  models: {
    [ModelType.TEXT_SMALL]: async (runtime: IAgentRuntime, { prompt }) => {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await client.responses.create({
        model: 'gpt-4.1',
        tools: [{ type: 'web_search_preview' }],
        input: prompt,
        tool_choice: 'auto',
        temperature: 0.7,
      });
      return response.output_text;
    },
  },
};

export default evmPlugin;
