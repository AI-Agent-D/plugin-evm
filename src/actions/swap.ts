import type {
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import {
  ModelType,
  composePromptFromState,
  elizaLogger,
  parseKeyValueXml,
} from "@elizaos/core";
import {
  type ExtendedChain,
  type Route,
  createConfig,
  getRoutes,
  getStepTransaction,
  getToken,
} from "@lifi/sdk";

import {
  type Address,
  type ByteArray,
  type Hex,
  encodeFunctionData,
  parseAbi,
  parseUnits,
} from "viem";
import { type WalletProvider, initWalletProvider } from "../providers/wallet";
import { swapTemplate } from "../templates";
import type { SwapParams, SwapQuote, Transaction } from "../types";
import type { BebopRoute } from "../types/index";

export { swapTemplate };

export class SwapAction {
  private lifiConfig;
  private bebopChainsMap;

  constructor(private walletProvider: WalletProvider) {
    this.walletProvider = walletProvider;
    const lifiChains: ExtendedChain[] = [];
    for (const config of Object.values(this.walletProvider.chains)) {
      try {
        lifiChains.push({
          id: config.id,
          name: config.name,
          key: config.name.toLowerCase(),
          chainType: "EVM" as const,
          nativeToken: {
            ...config.nativeCurrency,
            chainId: config.id,
            address: "0x0000000000000000000000000000000000000000",
            coinKey: config.nativeCurrency.symbol,
            priceUSD: "0",
            logoURI: "",
            symbol: config.nativeCurrency.symbol,
            decimals: config.nativeCurrency.decimals,
            name: config.nativeCurrency.name,
          },
          rpcUrls: {
            public: { http: [config.rpcUrls.default.http[0]] },
          },
          blockExplorerUrls: config.blockExplorers?.default?.url
            ? [config.blockExplorers.default.url]
            : [],
          metamask: {
            chainId: `0x${config.id.toString(16)}`,
            chainName: config.name,
            nativeCurrency: config.nativeCurrency,
            rpcUrls: [config.rpcUrls.default.http[0]],
            blockExplorerUrls: config.blockExplorers?.default?.url
              ? [config.blockExplorers.default.url]
              : [],
          },
          coin: config.nativeCurrency.symbol,
          mainnet: true,
          diamondAddress: "0x0000000000000000000000000000000000000000",
        } as ExtendedChain);
      } catch {
        // Skip chains with missing config in viem
      }
    }
    this.lifiConfig = createConfig({
      integrator: "eliza",
      chains: lifiChains,
    });
    this.bebopChainsMap = {
      mainnet: "ethereum",
      optimism: "optimism",
      polygon: "polygon",
      arbitrum: "arbitrum",
      base: "base",
      linea: "linea",
    };
  }

  /**
   * Resolves a token symbol or address to a valid contract address using LiFi SDK
   */
  private async resolveTokenAddress(
    tokenSymbolOrAddress: string,
    chainId: number,
  ): Promise<string> {
    // If it's already a valid address (starts with 0x and is 42 chars), return as is
    if (
      tokenSymbolOrAddress.startsWith("0x") &&
      tokenSymbolOrAddress.length === 42
    ) {
      return tokenSymbolOrAddress;
    }

    // If it's the zero address (native token), return as is
    if (tokenSymbolOrAddress === "0x0000000000000000000000000000000000000000") {
      return tokenSymbolOrAddress;
    }

    try {
      // Use LiFi SDK to resolve token symbol to address
      const token = await getToken(chainId, tokenSymbolOrAddress);
      return token.address;
    } catch (error) {
      elizaLogger.error(
        `Failed to resolve token ${tokenSymbolOrAddress} on chain ${chainId}:`,
        error,
      );
      // If LiFi fails, return original value and let downstream handle the error
      return tokenSymbolOrAddress;
    }
  }

  async swap(params: SwapParams): Promise<Transaction> {
    const walletClient = this.walletProvider.getWalletClient(params.chain);
    const [fromAddress] = await walletClient.getAddresses();

    // Resolve token symbols to addresses first
    const chainConfig = this.walletProvider.getChainConfigs(params.chain);
    const chainId = chainConfig.id;

    const resolvedFromToken = await this.resolveTokenAddress(
      params.fromToken,
      chainId,
    );
    const resolvedToToken = await this.resolveTokenAddress(
      params.toToken,
      chainId,
    );

    console.log(
      `###### RESOLVED TOKENS: ${params.fromToken} -> ${resolvedFromToken}, ${params.toToken} -> ${resolvedToToken}`,
    );

    // Update params with resolved addresses
    const resolvedParams = {
      ...params,
      fromToken: resolvedFromToken as Address,
      toToken: resolvedToToken as Address,
    };

    // Try swap with progressively higher slippage if needed
    const slippageLevels = [0.01, 0.015, 0.02]; // 1%, 1.5%, 2%
    let lastError: Error | undefined;

    for (const slippage of slippageLevels) {
      try {
        // Getting quotes from different aggregators with current slippage
        const sortedQuotes: SwapQuote[] = await this.getSortedQuotes(
          fromAddress,
          resolvedParams,
          slippage,
        );

        // Trying to execute the best quote by amount, fallback to the next one if it fails
        for (const quote of sortedQuotes) {
          let res;
          switch (quote.aggregator) {
            case "lifi":
              res = await this.executeLifiQuote(quote);
              break;
            case "bebop":
              res = await this.executeBebopQuote(quote, resolvedParams);
              break;
            default:
              throw new Error("No aggregator found");
          }
          if (res !== undefined) return res;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // If it's a slippage error, revert, or MEV issue and we have more slippage levels to try, continue
        if (
          lastError.message.includes("price movement") ||
          lastError.message.includes("Return amount is not enough") ||
          lastError.message.includes("reverted") ||
          lastError.message.includes("MEV frontrunning")
        ) {
          console.log(
            `###### SWAP FAILED WITH ${slippage * 100}% SLIPPAGE: ${lastError.message}`,
          );
          console.log(`###### RETRYING WITH FRESH QUOTES AND HIGHER SLIPPAGE`);

          // Add small delay to avoid rapid retries
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }

        // If it's not a recoverable error, throw immediately
        throw lastError;
      }
    }

    // If all slippage levels failed, throw the last error
    throw lastError || new Error("Execution failed");
  }

  private async getSortedQuotes(
    fromAddress: Address,
    params: SwapParams,
    slippage: number = 0.01,
  ): Promise<SwapQuote[]> {
    const decimalsAbi = parseAbi(["function decimals() view returns (uint8)"]);
    let fromTokenDecimals: number;

    const chainConfig = this.walletProvider.getChainConfigs(params.chain);

    // Check if the fromToken is the native currency
    if (
      params.fromToken.toUpperCase() ===
        chainConfig.nativeCurrency.symbol.toUpperCase() ||
      params.fromToken === "0x0000000000000000000000000000000000000000"
    ) {
      fromTokenDecimals = chainConfig.nativeCurrency.decimals;
    } else {
      fromTokenDecimals = await this.walletProvider
        .getPublicClient(params.chain)
        .readContract({
          address: params.fromToken as Address,
          abi: decimalsAbi,
          functionName: "decimals",
        });
    }

    const quotesPromises: Promise<SwapQuote | undefined>[] = [
      this.getLifiQuote(fromAddress, params, fromTokenDecimals, slippage),
      this.getBebopQuote(fromAddress, params, fromTokenDecimals),
    ];
    const quotesResults = await Promise.all(quotesPromises);
    const sortedQuotes: SwapQuote[] = quotesResults.filter(
      (quote): quote is SwapQuote => quote !== undefined,
    );
    sortedQuotes.sort((a, b) =>
      BigInt(a.minOutputAmount) > BigInt(b.minOutputAmount) ? -1 : 1,
    );
    if (sortedQuotes.length === 0) throw new Error("No routes found");
    return sortedQuotes;
  }

  private async getLifiQuote(
    fromAddress: Address,
    params: SwapParams,
    fromTokenDecimals: number,
    slippage: number = 0.01,
  ): Promise<SwapQuote | undefined> {
    try {
      const routes = await getRoutes({
        fromChainId: this.walletProvider.getChainConfigs(params.chain).id,
        toChainId: this.walletProvider.getChainConfigs(params.chain).id,
        fromTokenAddress: params.fromToken,
        toTokenAddress: params.toToken,
        fromAmount: parseUnits(params.amount, fromTokenDecimals).toString(),
        fromAddress: fromAddress,
        options: {
          slippage: slippage,
          order: "RECOMMENDED",
        },
      });
      if (!routes.routes.length) throw new Error("No routes found");
      return {
        aggregator: "lifi",
        minOutputAmount: routes.routes[0].steps[0].estimate.toAmountMin,
        swapData: routes.routes[0],
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check for specific slippage-related errors
      if (
        errorMessage.includes("Return amount is not enough") ||
        errorMessage.includes("INSUFFICIENT_OUTPUT_AMOUNT") ||
        errorMessage.includes("slippage")
      ) {
        elizaLogger.error(
          `LiFi swap failed due to slippage protection. Consider increasing slippage tolerance. Error: ${errorMessage}`,
        );
      }

      elizaLogger.error("Error in getLifiQuote:", errorMessage);
      return undefined;
    }
  }

  private async getBebopQuote(
    fromAddress: Address,
    params: SwapParams,
    fromTokenDecimals: number,
  ): Promise<SwapQuote | undefined> {
    try {
      const chainName =
        (this.bebopChainsMap as any)[params.chain] ?? params.chain;
      const url = `https://api.bebop.xyz/router/${chainName}/v1/quote`;
      const reqParams = new URLSearchParams({
        sell_tokens: params.fromToken,
        buy_tokens: params.toToken,
        sell_amounts: parseUnits(params.amount, fromTokenDecimals).toString(),
        taker_address: fromAddress,
        approval_type: "Standard",
        skip_validation: "true",
        gasless: "false",
        source: "eliza",
      });
      const response = await fetch(`${url}?${reqParams.toString()}`, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw Error(
          `Bebop API error: ${response.status} ${response.statusText}`,
        );
      }

      const data: any = await response.json();

      // Improved error handling for Bebop API response
      if (
        !data.routes ||
        !Array.isArray(data.routes) ||
        data.routes.length === 0
      ) {
        throw new Error("No routes found in Bebop API response");
      }

      const firstRoute = data.routes[0];
      if (!firstRoute?.quote?.tx) {
        throw new Error("Invalid route structure in Bebop API response");
      }

      const route: BebopRoute = {
        data: firstRoute.quote.tx.data,
        sellAmount: parseUnits(params.amount, fromTokenDecimals).toString(),
        approvalTarget: firstRoute.quote.approvalTarget as `0x${string}`,
        from: firstRoute.quote.tx.from as `0x${string}`,
        value: firstRoute.quote.tx.value.toString(),
        to: firstRoute.quote.tx.to as `0x${string}`,
        gas: firstRoute.quote.tx.gas.toString(),
        gasPrice: firstRoute.quote.tx.gasPrice.toString(),
      };

      // Check if buyTokens exists and has the expected structure
      if (
        !firstRoute.quote.buyTokens ||
        !firstRoute.quote.buyTokens[params.toToken]
      ) {
        throw new Error("Missing buyTokens information in Bebop API response");
      }

      return {
        aggregator: "bebop",
        minOutputAmount:
          firstRoute.quote.buyTokens[params.toToken].minimumAmount.toString(),
        swapData: route,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      elizaLogger.error("Error in getBebopQuote:", errorMessage);
      return undefined;
    }
  }

  private async executeLifiQuote(
    quote: SwapQuote,
  ): Promise<Transaction | undefined> {
    try {
      const route: Route = quote.swapData as Route;

      // Get the first step and request transaction data for it
      const step = route.steps[0];
      if (!step) {
        throw new Error("No steps found in route");
      }

      // Use getStepTransaction to get the actual transaction data
      const stepWithTx = await getStepTransaction(step);

      if (!stepWithTx.transactionRequest) {
        throw new Error(
          "No transaction request found in step after getStepTransaction",
        );
      }

      // Get wallet client for the correct chain
      const chainId = route.fromChainId;
      const chainName = Object.keys(this.walletProvider.chains).find(
        (name) =>
          this.walletProvider.getChainConfigs(name as any).id === chainId,
      );

      if (!chainName) {
        throw new Error(
          `Chain with ID ${chainId} not found in wallet provider`,
        );
      }

      const walletClient = this.walletProvider.getWalletClient(
        chainName as any,
      );

      if (!walletClient.account) {
        throw new Error("Wallet account is not available");
      }

      const txRequest = stepWithTx.transactionRequest;

      // Check if we need to approve tokens for LiFi contract (for ERC20 tokens, not native ETH)
      const fromToken = route.fromToken;
      if (fromToken.address !== "0x0000000000000000000000000000000000000000") {
        // This is an ERC20 token, check allowance
        const allowanceAbi = parseAbi([
          "function allowance(address,address) view returns (uint256)",
        ]);
        const spenderAddress = txRequest.to as Address; // LiFi contract address

        const allowance: bigint = await this.walletProvider
          .getPublicClient(chainName as any)
          .readContract({
            address: fromToken.address as Address,
            abi: allowanceAbi,
            functionName: "allowance",
            args: [walletClient.account.address, spenderAddress],
          });

        const requiredAmount = BigInt(route.fromAmount);

        if (allowance < requiredAmount) {
          console.log(`###### APPROVING ${fromToken.symbol} FOR LIFI CONTRACT`);
          const approvalData = encodeFunctionData({
            abi: parseAbi(["function approve(address,uint256)"]),
            functionName: "approve",
            args: [spenderAddress, requiredAmount],
          });

          const approvalTx = await walletClient.sendTransaction({
            account: walletClient.account,
            to: fromToken.address as Address,
            value: 0n,
            data: approvalData,
            chain: walletClient.chain,
          });
        }
      }

      const hash = await walletClient.sendTransaction({
        account: walletClient.account,
        to: txRequest.to as `0x${string}`,
        value: BigInt(txRequest.value || "0"),
        data: txRequest.data as `0x${string}`,
        chain: walletClient.chain,
        gas: BigInt(Math.floor(Number(txRequest.gasLimit || "0") * 1.2)), // Add 20% gas buffer
        gasPrice: txRequest.gasPrice
          ? BigInt(Math.floor(Number(txRequest.gasPrice) * 1.1))
          : undefined, // 10% higher gas price for MEV protection
      });

      // Wait for transaction receipt to verify success
      console.log(`###### WAITING FOR TRANSACTION RECEIPT: ${hash}`);
      const publicClient = this.walletProvider.getPublicClient(
        chainName as any,
      );
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: hash,
        timeout: 60000, // 60 second timeout
      });

      if (receipt.status === "reverted") {
        throw new Error(
          `Transaction reverted on-chain. Hash: ${hash}. This could be due to price movement, insufficient gas, or MEV frontrunning. Please try again.`,
        );
      }

      console.log(
        `###### TRANSACTION CONFIRMED: ${hash}, Gas Used: ${receipt.gasUsed}`,
      );

      return {
        hash,
        from: walletClient.account.address,
        to: txRequest.to as `0x${string}`,
        value: BigInt(txRequest.value || "0"),
        data: txRequest.data as `0x${string}`,
        chainId: route.fromChainId,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check for specific slippage-related errors
      if (
        errorMessage.includes("Return amount is not enough") ||
        errorMessage.includes("INSUFFICIENT_OUTPUT_AMOUNT") ||
        errorMessage.includes("slippage")
      ) {
        elizaLogger.error(
          `LiFi swap failed due to slippage protection. Consider increasing slippage tolerance. Error: ${errorMessage}`,
        );
        throw new Error(
          "Swap failed due to price movement. Try again or increase slippage tolerance.",
        );
      }

      elizaLogger.error(`Failed to execute lifi quote: ${errorMessage}`);
      return undefined;
    }
  }

  private async executeBebopQuote(
    quote: SwapQuote,
    params: SwapParams,
  ): Promise<Transaction | undefined> {
    try {
      const bebopRoute: BebopRoute = quote.swapData as BebopRoute;
      const allowanceAbi = parseAbi([
        "function allowance(address,address) view returns (uint256)",
      ]);
      const allowance: bigint = await this.walletProvider
        .getPublicClient(params.chain)
        .readContract({
          address: params.fromToken as Address,
          abi: allowanceAbi,
          functionName: "allowance",
          args: [bebopRoute.from, bebopRoute.approvalTarget],
        });

      const walletClient = this.walletProvider.getWalletClient(params.chain);

      if (!walletClient.account) {
        throw new Error("Wallet account is not available");
      }

      if (allowance < BigInt(bebopRoute.sellAmount)) {
        const approvalData = encodeFunctionData({
          abi: parseAbi(["function approve(address,uint256)"]),
          functionName: "approve",
          args: [bebopRoute.approvalTarget, BigInt(bebopRoute.sellAmount)],
        });
        await walletClient.sendTransaction({
          account: walletClient.account,
          to: params.fromToken as Address,
          value: 0n,
          data: approvalData,
          chain: walletClient.chain,
        });
      }

      const hash = await walletClient.sendTransaction({
        account: walletClient.account,
        to: bebopRoute.to,
        value: BigInt(bebopRoute.value),
        data: bebopRoute.data as Hex,
        chain: walletClient.chain,
      });

      return {
        hash,
        from: walletClient.account.address,
        to: bebopRoute.to,
        value: BigInt(bebopRoute.value),
        data: bebopRoute.data as Hex,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      elizaLogger.error(`Failed to execute bebop quote: ${errorMessage}`);
      return undefined;
    }
  }
}

const buildSwapDetails = async (
  state: State,
  _message: Memory,
  runtime: IAgentRuntime,
  wp: WalletProvider,
): Promise<SwapParams> => {
  const chains = wp.getSupportedChains();

  // Add balances to state for better context in template
  const balances = await wp.getWalletBalances();

  state = await runtime.composeState(_message, ["RECENT_MESSAGES"], true);
  state.supportedChains = chains.join(" | ");
  console.log("###### STATE", state);
  state.chainBalances = Object.entries(balances)
    .map(([chain, balance]) => {
      const chainConfig = wp.getChainConfigs(chain as any);
      return `${chain}: ${balance} ${chainConfig.nativeCurrency.symbol}`;
    })
    .join(", ");

  const context = composePromptFromState({
    state,
    template: swapTemplate,
  });

  const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
    prompt: context,
  });

  const parsedXml = parseKeyValueXml(xmlResponse);

  if (!parsedXml) {
    throw new Error("Failed to parse XML response from LLM for swap details.");
  }

  // Map parsed XML fields to SwapParams fields
  let swapDetails: SwapParams = {
    fromToken: parsedXml.inputToken,
    toToken: parsedXml.outputToken,
    amount: parsedXml.amount,
    chain: parsedXml.chain,
  };

  // Normalize chain name to lowercase to handle case sensitivity issues
  if (swapDetails.chain) {
    const normalizedChainName = swapDetails.chain.toLowerCase();

    // Validate chain exists
    if (!wp.chains[normalizedChainName]) {
      throw new Error(
        `Chain ${swapDetails.chain} not configured. Available chains: ${chains.join(", ")}`,
      );
    }

    // Update swapDetails with normalized chain name
    swapDetails.chain = normalizedChainName as any;
  }

  // Handle missing or null amount by calculating from balance
  if (
    !swapDetails.amount ||
    swapDetails.amount === "null" ||
    swapDetails.amount === ""
  ) {
    // Get the original message text to check for balance-related requests
    const messageText = (_message.content.text || "").toLowerCase();

    if (messageText.includes("half") || messageText.includes("50%")) {
      // User wants half their balance
      const balance = balances[swapDetails.chain];
      if (balance) {
        const halfBalance = (parseFloat(balance) / 2).toString();
        swapDetails.amount = halfBalance;
      }
    } else if (
      messageText.includes("all") ||
      messageText.includes("100%") ||
      messageText.includes("everything")
    ) {
      // User wants all their balance (minus some for gas)
      const balance = balances[swapDetails.chain];
      if (balance) {
        const mostBalance = (parseFloat(balance) * 0.9).toString(); // Leave 10% for gas
        swapDetails.amount = mostBalance;
      }
    } else if (messageText.match(/(\d+)%/)) {
      // User specified a percentage
      const match = messageText.match(/(\d+)%/);
      if (match) {
        const percentage = parseInt(match[1]) / 100;
        const balance = balances[swapDetails.chain];
        if (balance) {
          const percentageBalance = (
            parseFloat(balance) * percentage
          ).toString();
          swapDetails.amount = percentageBalance;
        }
      }
    }
  }

  return swapDetails;
};

export const swapAction = {
  name: "EVM_SWAP_TOKENS",
  description: "Swap tokens on the same chain",
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    state?: State,
    _options?: any,
    callback?: HandlerCallback,
  ) => {
    const walletProvider = await initWalletProvider(runtime);
    const action = new SwapAction(walletProvider);

    try {
      // Get swap parameters
      if (!state) {
        state = await runtime.composeState(_message);
      }

      const swapOptions = await buildSwapDetails(
        state,
        _message,
        runtime,
        walletProvider,
      );

      const swapResp = await action.swap(swapOptions);

      if (callback) {
        callback({
          text: `Successfully swapped ${swapOptions.amount} ${swapOptions.fromToken} for ${swapOptions.toToken} on ${swapOptions.chain}\nTransaction Hash: ${swapResp.hash}`,
          content: {
            success: true,
            hash: swapResp.hash,
            chain: swapOptions.chain,
          },
        });
      }
      return true;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Error in swap handler:", errorMessage);
      if (callback) {
        callback({
          text: `Error: ${errorMessage}`,
          content: { error: errorMessage },
        });
      }
      return false;
    }
  },
  template: swapTemplate,
  validate: async (runtime: IAgentRuntime) => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    return typeof privateKey === "string" && privateKey.startsWith("0x");
  },
  examples: [
    [
      {
        name: "user",
        user: "user",
        content: {
          text: "Swap 1 WETH for USDC on Arbitrum",
          action: "TOKEN_SWAP",
        },
      },
    ],
  ],
  similes: ["TOKEN_SWAP", "EXCHANGE_TOKENS", "TRADE_TOKENS"],
};
