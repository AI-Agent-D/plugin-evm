// src/actions/bridge.ts
import {
  composePromptFromState,
  ModelType,
  parseKeyValueXml,
  elizaLogger as elizaLogger2,
  logger
} from "@elizaos/core";
import {
  createConfig,
  executeRoute,
  getRoutes,
  getStatus,
  resumeRoute,
  getToken,
  EVM
} from "@lifi/sdk";
import { parseUnits, formatUnits as formatUnits2, parseAbi } from "viem";

// src/providers/wallet.ts
import * as path from "node:path";
import {
  elizaLogger,
  TEEMode,
  ServiceType
} from "@elizaos/core";
import {
  http,
  createPublicClient,
  createTestClient,
  createWalletClient,
  formatUnits,
  publicActions,
  walletActions
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as viemChains from "viem/chains";

// src/constants.ts
var EVM_WALLET_DATA_CACHE_KEY = "evm/wallet/data";
var EVM_SERVICE_NAME = "evmService";
var CACHE_REFRESH_INTERVAL_MS = 60 * 1e3;

// src/providers/wallet.ts
var WalletProvider = class {
  cacheKey = "evm/wallet";
  chains = {};
  account;
  runtime;
  constructor(accountOrPrivateKey, runtime, chains) {
    this.setAccount(accountOrPrivateKey);
    if (chains) {
      this.chains = chains;
    }
    this.runtime = runtime;
  }
  getAddress() {
    return this.account.address;
  }
  getPublicClient(chainName) {
    const transport = this.createHttpTransport(chainName);
    const publicClient = createPublicClient({
      chain: this.chains[chainName],
      transport
    });
    return publicClient;
  }
  getWalletClient(chainName) {
    const transport = this.createHttpTransport(chainName);
    const walletClient = createWalletClient({
      chain: this.chains[chainName],
      transport,
      account: this.account
    });
    return walletClient;
  }
  getTestClient() {
    return createTestClient({
      chain: viemChains.hardhat,
      mode: "hardhat",
      transport: http()
    }).extend(publicActions).extend(walletActions);
  }
  getChainConfigs(chainName) {
    const chain = this.chains[chainName];
    if (!chain?.id) {
      throw new Error(`Invalid chain name: ${chainName}`);
    }
    return chain;
  }
  getSupportedChains() {
    return Object.keys(this.chains);
  }
  async getWalletBalances() {
    const cacheKey = path.join(this.cacheKey, "walletBalances");
    const cachedData = await this.runtime.getCache(cacheKey);
    if (cachedData) {
      elizaLogger.log(`Returning cached wallet balances`);
      return cachedData;
    }
    const balances = {};
    const chainNames = this.getSupportedChains();
    await Promise.all(
      chainNames.map(async (chainName) => {
        try {
          const balance = await this.getWalletBalanceForChain(chainName);
          if (balance !== null) {
            balances[chainName] = balance;
          }
        } catch (error) {
          elizaLogger.error(`Error getting balance for ${chainName}:`, error);
        }
      })
    );
    await this.runtime.setCache(cacheKey, balances);
    elizaLogger.log("Wallet balances cached");
    return balances;
  }
  async getWalletBalanceForChain(chainName) {
    try {
      const client = this.getPublicClient(chainName);
      const balance = await client.getBalance({
        address: this.account.address
      });
      return formatUnits(balance, 18);
    } catch (error) {
      console.error(`Error getting wallet balance for ${chainName}:`, error);
      return null;
    }
  }
  addChain(chain) {
    this.addChains(chain);
  }
  setAccount = (accountOrPrivateKey) => {
    if (typeof accountOrPrivateKey === "string") {
      this.account = privateKeyToAccount(accountOrPrivateKey);
    } else {
      this.account = accountOrPrivateKey;
    }
  };
  addChains = (chains) => {
    if (!chains) {
      return;
    }
    this.chains = { ...this.chains, ...chains };
  };
  createHttpTransport = (chainName) => {
    const chain = this.chains[chainName];
    if (!chain) {
      throw new Error(`Chain not found: ${chainName}`);
    }
    if (chain.rpcUrls.custom) {
      return http(chain.rpcUrls.custom.http[0]);
    }
    return http(chain.rpcUrls.default.http[0]);
  };
  static genChainFromName(chainName, customRpcUrl) {
    const baseChain = viemChains[chainName];
    if (!baseChain?.id) {
      throw new Error("Invalid chain name");
    }
    const viemChain = customRpcUrl ? {
      ...baseChain,
      rpcUrls: {
        ...baseChain.rpcUrls,
        custom: {
          http: [customRpcUrl]
        }
      }
    } : baseChain;
    return viemChain;
  }
};
var genChainsFromRuntime = (runtime) => {
  const configuredChains = runtime?.character?.settings?.chains?.evm || [];
  const chainsToUse = configuredChains.length > 0 ? configuredChains : ["mainnet", "base"];
  if (!configuredChains.length) {
    elizaLogger.warn("No EVM chains configured in settings, defaulting to mainnet and base");
  }
  const chains = {};
  for (const chainName of chainsToUse) {
    try {
      let rpcUrl = runtime.getSetting(`ETHEREUM_PROVIDER_${chainName.toUpperCase()}`);
      if (!rpcUrl) {
        rpcUrl = runtime.getSetting(`EVM_PROVIDER_${chainName.toUpperCase()}`);
      }
      if (!viemChains[chainName]) {
        elizaLogger.warn(`Chain ${chainName} not found in viem chains, skipping`);
        continue;
      }
      const chain = WalletProvider.genChainFromName(chainName, rpcUrl);
      chains[chainName] = chain;
      elizaLogger.log(`Configured chain: ${chainName}`);
    } catch (error) {
      elizaLogger.error(`Error configuring chain ${chainName}:`, error);
    }
  }
  return chains;
};
var initWalletProvider = async (runtime) => {
  const teeMode = runtime.getSetting("TEE_MODE") || TEEMode.OFF;
  const chains = genChainsFromRuntime(runtime);
  if (teeMode !== TEEMode.OFF) {
    const walletSecretSalt = runtime.getSetting("WALLET_SECRET_SALT");
    if (!walletSecretSalt) {
      throw new Error("WALLET_SECRET_SALT required when TEE_MODE is enabled");
    }
    return new LazyTeeWalletProvider(runtime, walletSecretSalt, chains);
  }
  const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
  if (!privateKey) {
    throw new Error("EVM_PRIVATE_KEY is missing");
  }
  return new WalletProvider(privateKey, runtime, chains);
};
var LazyTeeWalletProvider = class extends WalletProvider {
  teeWallet = null;
  initPromise = null;
  walletSecretSalt;
  constructor(runtime, walletSecretSalt, chains) {
    super(
      "0x0000000000000000000000000000000000000000000000000000000000000001",
      runtime,
      chains
    );
    this.walletSecretSalt = walletSecretSalt;
  }
  async ensureInitialized() {
    if (this.teeWallet) return;
    if (!this.initPromise) {
      this.initPromise = this.initializeTeeWallet();
    }
    await this.initPromise;
  }
  async initializeTeeWallet() {
    const teeService = this.runtime.getService(ServiceType.TEE);
    if (!teeService) {
      throw new Error(
        "TEE service not found - ensure TEE plugin is registered before using TEE-dependent features"
      );
    }
    if (typeof teeService.deriveEcdsaKeypair !== "function") {
      throw new Error("TEE service does not implement deriveEcdsaKeypair method");
    }
    const { keypair, attestation } = await teeService.deriveEcdsaKeypair(
      this.walletSecretSalt,
      "evm",
      this.runtime.agentId
    );
    this.teeWallet = new WalletProvider(keypair, this.runtime, this.chains);
    this.account = this.teeWallet.account;
  }
  // Override methods that need the initialized wallet
  getAddress() {
    if (!this.teeWallet) {
      throw new Error(
        "TEE wallet not initialized yet. Ensure async operations complete before using synchronous methods."
      );
    }
    return this.teeWallet.getAddress();
  }
  getPublicClient(chainName) {
    if (!this.teeWallet) {
      return super.getPublicClient(chainName);
    }
    return this.teeWallet.getPublicClient(chainName);
  }
  getWalletClient(chainName) {
    if (!this.teeWallet) {
      throw new Error(
        "TEE wallet not initialized yet. Ensure async operations complete before using wallet client."
      );
    }
    return this.teeWallet.getWalletClient(chainName);
  }
  async getWalletBalances() {
    await this.ensureInitialized();
    return this.teeWallet.getWalletBalances();
  }
  async getWalletBalanceForChain(chainName) {
    await this.ensureInitialized();
    return this.teeWallet.getWalletBalanceForChain(chainName);
  }
};
var evmWalletProvider = {
  name: "EVMWalletProvider",
  async get(runtime, _message, state) {
    try {
      const evmService = runtime.getService(EVM_SERVICE_NAME);
      if (!evmService) {
        elizaLogger.warn("EVM service not found, falling back to direct fetching");
        return await directFetchWalletData(runtime, state);
      }
      const walletData = await evmService.getCachedData();
      if (!walletData) {
        elizaLogger.warn("No cached wallet data available, falling back to direct fetching");
        return await directFetchWalletData(runtime, state);
      }
      const agentName = state?.agentName || "The agent";
      const balanceText = walletData.chains.map((chain) => `${chain.name}: ${chain.balance} ${chain.symbol}`).join("\n");
      return {
        text: `${agentName}'s EVM Wallet Address: ${walletData.address}

Balances:
${balanceText}`,
        data: {
          address: walletData.address,
          chains: walletData.chains
        },
        values: {
          address: walletData.address,
          chains: JSON.stringify(walletData.chains)
        }
      };
    } catch (error) {
      console.error("Error in EVM wallet provider:", error);
      return {
        text: "Error getting EVM wallet provider",
        data: {},
        values: {}
      };
    }
  }
};
async function directFetchWalletData(runtime, state) {
  try {
    const walletProvider = await initWalletProvider(runtime);
    const address = walletProvider.getAddress();
    const balances = await walletProvider.getWalletBalances();
    const agentName = state?.agentName || "The agent";
    const chainDetails = Object.entries(balances).map(([chainName, balance]) => {
      const chain = walletProvider.getChainConfigs(chainName);
      return {
        chainName,
        balance,
        symbol: chain.nativeCurrency.symbol,
        chainId: chain.id,
        name: chain.name
      };
    });
    const balanceText = chainDetails.map((chain) => `${chain.name}: ${chain.balance} ${chain.symbol}`).join("\n");
    return {
      text: `${agentName}'s EVM Wallet Address: ${address}

Balances:
${balanceText}`,
      data: {
        address,
        chains: chainDetails
      },
      values: {
        address,
        chains: JSON.stringify(chainDetails)
      }
    };
  } catch (error) {
    console.error("Error fetching wallet data directly:", error);
    return {
      text: "Error getting EVM wallet provider",
      data: {},
      values: {}
    };
  }
}

// src/templates/index.ts
var transferTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{chainBalances}}

Your goal is to extract the following information about the requested transfer:
1. Chain to execute on (must be one of the supported chains)
2. For native token transfers, the amount should be in wei, otherwise, it should be 0.
3. For native token transfers, this should be the recipient address (must be a valid Ethereum address), otherwise this should be the token address on the chain.
4. Token symbol or address (if not a native token transfer)
5. If not a native token transfer, extract the ABI encoding for the ERC20 transfer function. The amount being transferred should be denominated in the token decimals on the chain.

Respond with an XML block containing only the extracted values. Use null for any values that cannot be determined.

<response>
    <fromChain>{{supportedChains}} | null</fromChain>
    <amount>string | null</amount>
    <toAddress>string | null</toAddress>
    <token>string | null</token>
    <data>string</data>
</response>

IMPORTANT: Your response must ONLY contain the <response></response> XML block above. Do not include any text, thinking, or reasoning before or after this XML block. Start your response immediately with <response> and end with </response>.
`;
var bridgeTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{chainBalances}}

Extract the following information about the requested token bridge:
- Token symbol or address to bridge
- Source chain
- Destination chain
- Amount to bridge: Must be a string representing the amount in ether (only number without coin symbol, e.g., "0.1")
- Destination address (if specified)

Respond with an XML block containing only the extracted values. Use empty tags for any values that cannot be determined.

<response>
    <token>string | null</token>
    <fromChain>{{supportedChains}} | null</fromChain>
    <toChain>{{supportedChains}} | null</toChain>
    <amount>string | null</amount>
    <toAddress>string | null</toAddress>
</response>

IMPORTANT: Your response must ONLY contain the <response></response> XML block above. Do not include any text, thinking, or reasoning before or after this XML block. Start your response immediately with <response> and end with </response>.
`;
var swapTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{chainBalances}}

Extract the following information about the requested token swap:
- Input token symbol or address (the token being sold)
- Output token symbol or address (the token being bought)
- Amount to swap: Must be a string representing the amount in ether (only number without coin symbol, e.g., "0.1")
- Chain to execute on

Respond with an XML block containing only the extracted values. Use empty tags for any values that cannot be determined.

<response>
    <inputToken>string | null</inputToken>
    <outputToken>string | null</outputToken>
    <amount>string | null</amount>
    <chain>{{supportedChains}} | null</chain>
</response>

IMPORTANT: Your response must ONLY contain the <response></response> XML block above. Do not include any text, thinking, or reasoning before or after this XML block. Start your response immediately with <response> and end with </response>.
`;

// src/actions/bridge.ts
var BridgeAction = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
    this.config = createConfig({
      integrator: "eliza-agent",
      providers: [
        EVM({
          getWalletClient: async () => {
            const firstChain = Object.keys(this.walletProvider.chains)[0];
            return this.walletProvider.getWalletClient(firstChain);
          },
          switchChain: async (chainId) => {
            logger.debug(`\u{1F504} LiFi requesting chain switch to ${chainId}...`);
            const chainName = this.getChainNameById(chainId);
            return this.walletProvider.getWalletClient(chainName);
          }
        })
      ],
      // Custom chains configuration
      chains: Object.values(this.walletProvider.chains).map((config) => ({
        id: config.id,
        name: config.name,
        key: config.name.toLowerCase(),
        chainType: "EVM",
        nativeToken: {
          ...config.nativeCurrency,
          chainId: config.id,
          address: "0x0000000000000000000000000000000000000000",
          coinKey: config.nativeCurrency.symbol
        },
        metamask: {
          chainId: `0x${config.id.toString(16)}`,
          chainName: config.name,
          nativeCurrency: config.nativeCurrency,
          rpcUrls: [config.rpcUrls.default.http[0]],
          blockExplorerUrls: [config?.blockExplorers?.default?.url]
        },
        diamondAddress: "0x0000000000000000000000000000000000000000",
        coin: config.nativeCurrency.symbol,
        mainnet: true
      })),
      // Enable automatic route optimization
      routeOptions: {
        maxPriceImpact: 0.4,
        // 40% max price impact
        slippage: 5e-3
        // 0.5% slippage tolerance
      }
    });
  }
  config;
  activeRoutes = /* @__PURE__ */ new Map();
  getChainNameById(chainId) {
    const chain = Object.entries(this.walletProvider.chains).find(
      ([_, config]) => config.id === chainId
    );
    if (!chain) {
      throw new Error(`Chain with ID ${chainId} not found`);
    }
    return chain[0];
  }
  /**
   * Resolves a token symbol or address to a valid contract address using LiFi SDK
   */
  async resolveTokenAddress(tokenSymbolOrAddress, chainId) {
    if (tokenSymbolOrAddress.startsWith("0x") && tokenSymbolOrAddress.length === 42) {
      return tokenSymbolOrAddress;
    }
    if (tokenSymbolOrAddress === "0x0000000000000000000000000000000000000000") {
      return tokenSymbolOrAddress;
    }
    try {
      const token = await getToken(chainId, tokenSymbolOrAddress);
      return token.address;
    } catch (error) {
      elizaLogger2.error(
        `Failed to resolve token ${tokenSymbolOrAddress} on chain ${chainId}:`,
        error
      );
      return tokenSymbolOrAddress;
    }
  }
  /**
   * Get token decimals for proper amount parsing - works for any token
   */
  async getTokenDecimals(tokenAddress, chainName) {
    const chainConfig = this.walletProvider.getChainConfigs(chainName);
    if (tokenAddress === "0x0000000000000000000000000000000000000000" || tokenAddress.toUpperCase() === chainConfig.nativeCurrency.symbol.toUpperCase()) {
      return chainConfig.nativeCurrency.decimals;
    }
    try {
      const decimalsAbi = parseAbi(["function decimals() view returns (uint8)"]);
      const decimals = await this.walletProvider.getPublicClient(chainName).readContract({
        address: tokenAddress,
        abi: decimalsAbi,
        functionName: "decimals"
      });
      return decimals;
    } catch (error) {
      elizaLogger2.error(`Failed to get decimals for token ${tokenAddress} on ${chainName}:`, error);
      return 18;
    }
  }
  createExecutionOptions(routeId, onProgress) {
    return {
      // Gas optimization hook - modify transaction requests for better gas prices
      updateTransactionRequestHook: async (txRequest) => {
        try {
          if (txRequest.gas) {
            txRequest.gas = BigInt(txRequest.gas) * BigInt(110) / BigInt(100);
          }
          if (txRequest.gasPrice) {
            txRequest.gasPrice = BigInt(txRequest.gasPrice) * BigInt(105) / BigInt(100);
          }
          return txRequest;
        } catch (error) {
          console.warn("\u26A0\uFE0F Gas optimization failed, using default values:", error);
          return txRequest;
        }
      },
      // Exchange rate update handler for better UX
      acceptExchangeRateUpdateHook: async (params) => {
        const { toToken, oldToAmount, newToAmount } = params;
        const oldAmountFormatted = formatUnits2(BigInt(oldToAmount), toToken.decimals);
        const newAmountFormatted = formatUnits2(BigInt(newToAmount), toToken.decimals);
        const priceChange = (Number(newToAmount) - Number(oldToAmount)) / Number(oldToAmount) * 100;
        logger.debug(`   Exchange rate changed for ${toToken.symbol}:`);
        logger.debug(`   Old amount: ${oldAmountFormatted}`);
        logger.debug(`   New amount: ${newAmountFormatted}`);
        logger.debug(`   Change: ${priceChange.toFixed(2)}%`);
        if (Math.abs(priceChange) < 2) {
          logger.debug("\u2705 Auto-accepting exchange rate change (< 2%)");
          return true;
        }
        if (Math.abs(priceChange) < 5) {
          logger.debug("\u26A0\uFE0F Accepting exchange rate change (< 5%)");
          return true;
        }
        logger.debug("\u274C Rejecting exchange rate change (> 5%)");
        return false;
      },
      // Route monitoring and progress tracking
      updateRouteHook: (updatedRoute) => {
        const status = this.updateRouteStatus(routeId, updatedRoute);
        logger.debug(`\u{1F4CA} Route ${routeId} progress: ${status.currentStep}/${status.totalSteps}`);
        status.transactionHashes.forEach((hash, index) => {
          logger.debug(`\u{1F517} Transaction ${index + 1}: ${hash}`);
        });
        if (onProgress) {
          onProgress(status);
        }
      },
      // Chain switching handler
      switchChainHook: async (chainId) => {
        logger.debug(`\u{1F504} Switching to chain ${chainId}...`);
        try {
          const chainName = this.getChainNameById(chainId);
          const walletClient = this.walletProvider.getWalletClient(chainName);
          logger.debug("\u2705 Chain switch successful");
          return walletClient;
        } catch (error) {
          logger.error("\u274C Chain switch failed:", error);
          throw error;
        }
      },
      // Enable background execution for better UX
      executeInBackground: false,
      // Disable message signing for compatibility with smart accounts
      disableMessageSigning: false
    };
  }
  updateRouteStatus(routeId, route) {
    let transactionHashes = [];
    let currentStep = 0;
    let isComplete = false;
    let error;
    route.steps.forEach((step, stepIndex) => {
      if (step.execution?.process) {
        step.execution.process.forEach((process) => {
          if (process.txHash) {
            transactionHashes.push(process.txHash);
          }
          if (process.status === "DONE") {
            currentStep = Math.max(currentStep, stepIndex + 1);
          }
          if (process.status === "FAILED") {
            error = `Step ${stepIndex + 1} failed: ${process.error || "Unknown error"}`;
          }
        });
      }
    });
    isComplete = currentStep === route.steps.length && !error;
    const status = {
      route,
      isComplete,
      error,
      transactionHashes,
      currentStep,
      totalSteps: route.steps.length
    };
    this.activeRoutes.set(routeId, status);
    return status;
  }
  /**
   * Poll bridge status using LiFi's getStatus API for cross-chain completion monitoring
   */
  async pollBridgeStatus(txHash, fromChainId, toChainId, tool, routeId, maxAttempts = 60, intervalMs = 5e3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        const status = await getStatus({
          txHash,
          fromChain: fromChainId,
          toChain: toChainId,
          bridge: tool
        });
        logger.debug(
          `\u{1F4CA} Poll attempt ${attempt}/${maxAttempts}: ${status.status}${status.substatus ? ` (${status.substatus})` : ""}`
        );
        const routeStatus2 = this.activeRoutes.get(routeId);
        if (!routeStatus2) {
          throw new Error(`Route ${routeId} not found in active routes`);
        }
        let isComplete = false;
        let error;
        if (status.status === "DONE") {
          isComplete = true;
          logger.debug("\u2705 Bridge completed successfully!");
        } else if (status.status === "FAILED") {
          error = `Bridge failed: ${status.substatus || "Unknown error"}`;
          logger.debug(`\u274C Bridge failed: ${error}`);
        } else if (status.status === "PENDING") {
          logger.debug(`\u23F3 Bridge still pending: ${status.substatus || "Processing..."}`);
        }
        const updatedStatus = {
          ...routeStatus2,
          isComplete,
          error,
          currentStep: isComplete ? routeStatus2.totalSteps : routeStatus2.currentStep
        };
        this.activeRoutes.set(routeId, updatedStatus);
        if (isComplete || error) {
          return updatedStatus;
        }
      } catch (statusError) {
        console.warn(`\u26A0\uFE0F Status check attempt ${attempt} failed:`, statusError);
        if (attempt >= maxAttempts - 5) {
          logger.debug("\u23F0 Status polling timed out, but transaction may still be processing...");
        }
      }
    }
    const routeStatus = this.activeRoutes.get(routeId);
    if (routeStatus) {
      const timeoutStatus = {
        ...routeStatus,
        error: `Bridge status polling timed out after ${maxAttempts * intervalMs / 1e3}s. Transaction may still be processing on the destination chain.`
      };
      this.activeRoutes.set(routeId, timeoutStatus);
      return timeoutStatus;
    }
    throw new Error("Route status polling failed completely");
  }
  async bridge(params, onProgress) {
    const walletClient = this.walletProvider.getWalletClient(params.fromChain);
    const [fromAddress] = await walletClient.getAddresses();
    logger.debug("\u{1F309} Initiating bridge operation...");
    logger.debug(`   From: ${params.fromChain} \u2192 To: ${params.toChain}`);
    logger.debug(`   Amount: ${params.amount} tokens`);
    const fromChainConfig = this.walletProvider.getChainConfigs(params.fromChain);
    const toChainConfig = this.walletProvider.getChainConfigs(params.toChain);
    const resolvedFromToken = await this.resolveTokenAddress(params.fromToken, fromChainConfig.id);
    const resolvedToToken = await this.resolveTokenAddress(params.toToken, toChainConfig.id);
    logger.debug(`\u{1F50D} Resolved tokens:`);
    logger.debug(`   ${params.fromToken} on ${params.fromChain} \u2192 ${resolvedFromToken}`);
    logger.debug(`   ${params.toToken} on ${params.toChain} \u2192 ${resolvedToToken}`);
    const fromTokenDecimals = await this.getTokenDecimals(resolvedFromToken, params.fromChain);
    logger.debug(`\u{1F522} Token decimals: ${fromTokenDecimals} for ${params.fromToken}`);
    const fromAmountParsed = parseUnits(params.amount, fromTokenDecimals);
    logger.debug(`\u{1F4B0} Parsed amount: ${params.amount} \u2192 ${fromAmountParsed.toString()}`);
    const routesResult = await getRoutes({
      fromChainId: fromChainConfig.id,
      toChainId: toChainConfig.id,
      fromTokenAddress: resolvedFromToken,
      toTokenAddress: resolvedToToken,
      fromAmount: fromAmountParsed.toString(),
      // Use correctly parsed amount!
      fromAddress,
      toAddress: params.toAddress || fromAddress,
      options: {
        order: "RECOMMENDED",
        // Use recommended routing for best optimization
        slippage: 5e-3,
        // 0.5% slippage
        maxPriceImpact: 0.4,
        // 40% max price impact
        allowSwitchChain: true
      }
    });
    if (!routesResult.routes.length) {
      throw new Error(
        `No bridge routes found for ${params.fromToken} (${resolvedFromToken}) on ${params.fromChain} to ${params.toToken} (${resolvedToToken}) on ${params.toChain}. Please verify the token exists on both chains or try a different token pair.`
      );
    }
    const selectedRoute = routesResult.routes[0];
    const routeId = `bridge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    logger.debug(`\u{1F4CB} Selected route ${routeId}:`);
    logger.debug(`   Gas cost: ${selectedRoute.gasCostUSD || "Unknown"} USD`);
    logger.debug(`   Steps: ${selectedRoute.steps.length}`);
    logger.debug(`   Tools: ${selectedRoute.steps.map((s) => s.tool).join(" \u2192 ")}`);
    try {
      const executionOptions = this.createExecutionOptions(routeId, void 0);
      const executedRoute = await executeRoute(selectedRoute, executionOptions);
      const sourceSteps = executedRoute.steps.filter(
        (step) => step.execution?.process?.some((p) => p.txHash)
      );
      if (!sourceSteps.length) {
        throw new Error("No transaction hashes found in executed route");
      }
      const mainTxHash = sourceSteps[0].execution?.process?.find((p) => p.txHash)?.txHash;
      if (!mainTxHash) {
        throw new Error("No transaction hash found in route execution");
      }
      logger.debug(`\u{1F517} Source transaction: ${mainTxHash}`);
      const bridgeTool = selectedRoute.steps[0].tool;
      logger.debug(`\u{1F309} Using bridge tool: ${bridgeTool}`);
      const finalStatus = await this.pollBridgeStatus(
        mainTxHash,
        fromChainConfig.id,
        toChainConfig.id,
        bridgeTool,
        routeId
      );
      if (onProgress) {
        onProgress(finalStatus);
      }
      if (finalStatus.error) {
        throw new Error(finalStatus.error);
      }
      if (!finalStatus.isComplete) {
        logger.debug(
          "\u26A0\uFE0F Bridge execution may still be in progress. Check destination chain manually."
        );
      }
      logger.debug("\u2705 Bridge initiated successfully!");
      logger.debug(`   Source transaction: ${mainTxHash}`);
      logger.debug(`   Monitor completion on destination chain`);
      return {
        hash: mainTxHash,
        from: fromAddress,
        to: params.toAddress || fromAddress,
        value: fromAmountParsed,
        chainId: toChainConfig.id
      };
    } catch (error) {
      console.error("\u274C Bridge execution failed:", error);
      const status = this.activeRoutes.get(routeId);
      if (status?.error) {
        throw new Error(`Bridge failed: ${status.error}`);
      }
      throw error;
    } finally {
      this.activeRoutes.delete(routeId);
    }
  }
  // Get status of a specific transaction
  async getTransactionStatus(txHash, fromChainId, toChainId, tool) {
    try {
      const status = await getStatus({
        txHash,
        fromChain: fromChainId,
        toChain: toChainId,
        bridge: tool
      });
      return status;
    } catch (error) {
      console.error("Failed to get transaction status:", error);
      throw error;
    }
  }
  // Resume a failed or interrupted bridge operation
  async resumeBridge(route, onProgress) {
    const routeId = `resume_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const executionOptions = this.createExecutionOptions(routeId, onProgress);
    logger.debug("\u{1F504} Resuming bridge operation...");
    try {
      const resumedRoute = await resumeRoute(route, executionOptions);
      const finalStatus = this.activeRoutes.get(routeId);
      if (finalStatus?.error) {
        throw new Error(finalStatus.error);
      }
      return resumedRoute;
    } finally {
      this.activeRoutes.delete(routeId);
    }
  }
};
var buildBridgeDetails = async (state, runtime, wp) => {
  const chains = wp.getSupportedChains();
  const balances = await wp.getWalletBalances();
  state.supportedChains = chains.join(" | ");
  state.chainBalances = Object.entries(balances).map(([chain, balance]) => {
    const chainConfig = wp.getChainConfigs(chain);
    return `${chain}: ${balance} ${chainConfig.nativeCurrency.symbol}`;
  }).join(", ");
  const bridgeContext = composePromptFromState({
    state,
    template: bridgeTemplate
  });
  const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
    prompt: bridgeContext
  });
  const content = parseKeyValueXml(xmlResponse);
  logger.debug("###### XML RESPONSE", xmlResponse);
  const fromChain = content.fromChain;
  const toChain = content.toChain;
  const normalizedFromChain = fromChain?.toLowerCase();
  const normalizedToChain = toChain?.toLowerCase();
  if (!wp.chains[normalizedFromChain]) {
    throw new Error(
      `Source chain ${fromChain} not configured. Available chains: ${chains.join(", ")}`
    );
  }
  if (!wp.chains[normalizedToChain]) {
    throw new Error(
      `Destination chain ${toChain} not configured. Available chains: ${chains.join(", ")}`
    );
  }
  const bridgeOptions = {
    fromChain: normalizedFromChain,
    toChain: normalizedToChain,
    fromToken: content.token,
    toToken: content.token,
    toAddress: content.toAddress,
    amount: content.amount
  };
  logger.debug("###### BRIDGE OPTIONS", bridgeOptions);
  return bridgeOptions;
};
var bridgeAction = {
  name: "EVM_BRIDGE_TOKENS",
  description: "Bridge tokens between different chains with gas optimization and advanced monitoring",
  handler: async (runtime, _message, state, _options, callback) => {
    const walletProvider = await initWalletProvider(runtime);
    const action = new BridgeAction(walletProvider);
    if (!state) {
      state = await runtime.composeState(_message, ["RECENT_MESSAGES"], true);
    }
    try {
      const bridgeOptions = await buildBridgeDetails(state, runtime, walletProvider);
      logger.debug("###### BRIDGE OPTIONS", bridgeOptions);
      const bridgeResp = await action.bridge(bridgeOptions, (status) => {
        logger.debug(`\u{1F504} Bridge progress: ${status.currentStep}/${status.totalSteps}`);
        if (status.transactionHashes.length > 0) {
          logger.debug(`\u{1F4DD} Recent transactions: ${status.transactionHashes.slice(-2).join(", ")}`);
        }
      });
      logger.debug("###### BRIDGE RESP", bridgeResp);
      if (callback) {
        callback({
          text: `\u2705 Successfully bridged ${bridgeOptions.amount} tokens from ${bridgeOptions.fromChain} to ${bridgeOptions.toChain}

\u{1F517} Transaction Hash: ${bridgeResp.hash}
\u26FD Gas optimized and monitored throughout the process`,
          content: {
            success: true,
            hash: bridgeResp.hash,
            recipient: bridgeResp.to,
            fromChain: bridgeOptions.fromChain,
            toChain: bridgeOptions.toChain,
            amount: bridgeOptions.amount,
            gasOptimized: true
          }
        });
      }
      return true;
    } catch (error) {
      console.error(
        "Error in bridge handler:",
        error instanceof Error ? error.message : "Unknown error"
      );
      if (callback) {
        callback({
          text: `\u274C Bridge failed: ${error instanceof Error ? error.message : "Unknown error"}

Please check your balance, network connectivity, and try again.`,
          content: {
            error: error instanceof Error ? error.message : "Unknown error",
            success: false
          }
        });
      }
      return false;
    }
  },
  template: bridgeTemplate,
  validate: async (runtime) => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    return typeof privateKey === "string" && privateKey.startsWith("0x");
  },
  examples: [
    [
      {
        name: "user",
        user: "user",
        content: {
          text: "Bridge 1 ETH from Ethereum to Base with gas optimization",
          action: "CROSS_CHAIN_TRANSFER"
        }
      }
    ]
  ],
  similes: ["CROSS_CHAIN_TRANSFER", "CHAIN_BRIDGE", "MOVE_CROSS_CHAIN", "BRIDGE_TOKENS"]
};
async function checkBridgeStatus(txHash, fromChainId, toChainId, tool = "stargateV2Bus") {
  try {
    logger.debug(`\u{1F50D} Checking bridge status for transaction: ${txHash}`);
    logger.debug(`   From chain: ${fromChainId} \u2192 To chain: ${toChainId}`);
    logger.debug(`   Bridge tool: ${tool}`);
    const status = await getStatus({
      txHash,
      fromChain: fromChainId,
      toChain: toChainId,
      bridge: tool
    });
    logger.debug(
      `\u{1F4CA} Bridge Status: ${status.status}${status.substatus ? ` (${status.substatus})` : ""}`
    );
    return {
      status: status.status,
      substatus: status.substatus,
      isComplete: status.status === "DONE",
      isFailed: status.status === "FAILED",
      isPending: status.status === "PENDING",
      error: status.status === "FAILED" ? status.substatus : void 0
    };
  } catch (error) {
    console.error("\u274C Failed to check bridge status:", error);
    throw error;
  }
}

// src/actions/swap.ts
import { ModelType as ModelType2, composePromptFromState as composePromptFromState2, elizaLogger as elizaLogger3, parseKeyValueXml as parseKeyValueXml2 } from "@elizaos/core";
import {
  createConfig as createConfig2,
  getRoutes as getRoutes2,
  getStepTransaction,
  getToken as getToken2
} from "@lifi/sdk";
import {
  encodeFunctionData,
  parseAbi as parseAbi2,
  parseUnits as parseUnits2
} from "viem";
var SwapAction = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
    this.walletProvider = walletProvider;
    const lifiChains = [];
    for (const config of Object.values(this.walletProvider.chains)) {
      try {
        lifiChains.push({
          id: config.id,
          name: config.name,
          key: config.name.toLowerCase(),
          chainType: "EVM",
          nativeToken: {
            ...config.nativeCurrency,
            chainId: config.id,
            address: "0x0000000000000000000000000000000000000000",
            coinKey: config.nativeCurrency.symbol,
            priceUSD: "0",
            logoURI: "",
            symbol: config.nativeCurrency.symbol,
            decimals: config.nativeCurrency.decimals,
            name: config.nativeCurrency.name
          },
          rpcUrls: {
            public: { http: [config.rpcUrls.default.http[0]] }
          },
          blockExplorerUrls: config.blockExplorers?.default?.url ? [config.blockExplorers.default.url] : [],
          metamask: {
            chainId: `0x${config.id.toString(16)}`,
            chainName: config.name,
            nativeCurrency: config.nativeCurrency,
            rpcUrls: [config.rpcUrls.default.http[0]],
            blockExplorerUrls: config.blockExplorers?.default?.url ? [config.blockExplorers.default.url] : []
          },
          coin: config.nativeCurrency.symbol,
          mainnet: true,
          diamondAddress: "0x0000000000000000000000000000000000000000"
        });
      } catch {
      }
    }
    this.lifiConfig = createConfig2({
      integrator: "eliza",
      chains: lifiChains
    });
    this.bebopChainsMap = {
      mainnet: "ethereum",
      optimism: "optimism",
      polygon: "polygon",
      arbitrum: "arbitrum",
      base: "base",
      linea: "linea"
    };
  }
  lifiConfig;
  bebopChainsMap;
  /**
   * Resolves a token symbol or address to a valid contract address using LiFi SDK
   */
  async resolveTokenAddress(tokenSymbolOrAddress, chainId) {
    if (tokenSymbolOrAddress.startsWith("0x") && tokenSymbolOrAddress.length === 42) {
      return tokenSymbolOrAddress;
    }
    if (tokenSymbolOrAddress === "0x0000000000000000000000000000000000000000") {
      return tokenSymbolOrAddress;
    }
    try {
      const token = await getToken2(chainId, tokenSymbolOrAddress);
      return token.address;
    } catch (error) {
      elizaLogger3.error(
        `Failed to resolve token ${tokenSymbolOrAddress} on chain ${chainId}:`,
        error
      );
      return tokenSymbolOrAddress;
    }
  }
  async swap(params) {
    const walletClient = this.walletProvider.getWalletClient(params.chain);
    const [fromAddress] = await walletClient.getAddresses();
    const chainConfig = this.walletProvider.getChainConfigs(params.chain);
    const chainId = chainConfig.id;
    const resolvedFromToken = await this.resolveTokenAddress(params.fromToken, chainId);
    const resolvedToToken = await this.resolveTokenAddress(params.toToken, chainId);
    console.log(
      `###### RESOLVED TOKENS: ${params.fromToken} -> ${resolvedFromToken}, ${params.toToken} -> ${resolvedToToken}`
    );
    const resolvedParams = {
      ...params,
      fromToken: resolvedFromToken,
      toToken: resolvedToToken
    };
    const slippageLevels = [0.01, 0.015, 0.02];
    let lastError;
    for (const slippage of slippageLevels) {
      try {
        const sortedQuotes = await this.getSortedQuotes(
          fromAddress,
          resolvedParams,
          slippage
        );
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
          if (res !== void 0) return res;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (lastError.message.includes("price movement") || lastError.message.includes("Return amount is not enough") || lastError.message.includes("reverted") || lastError.message.includes("MEV frontrunning")) {
          console.log(`###### SWAP FAILED WITH ${slippage * 100}% SLIPPAGE: ${lastError.message}`);
          console.log(`###### RETRYING WITH FRESH QUOTES AND HIGHER SLIPPAGE`);
          await new Promise((resolve) => setTimeout(resolve, 2e3));
          continue;
        }
        throw lastError;
      }
    }
    throw lastError || new Error("Execution failed");
  }
  async getSortedQuotes(fromAddress, params, slippage = 0.01) {
    const decimalsAbi = parseAbi2(["function decimals() view returns (uint8)"]);
    let fromTokenDecimals;
    const chainConfig = this.walletProvider.getChainConfigs(params.chain);
    if (params.fromToken.toUpperCase() === chainConfig.nativeCurrency.symbol.toUpperCase() || params.fromToken === "0x0000000000000000000000000000000000000000") {
      fromTokenDecimals = chainConfig.nativeCurrency.decimals;
    } else {
      fromTokenDecimals = await this.walletProvider.getPublicClient(params.chain).readContract({
        address: params.fromToken,
        abi: decimalsAbi,
        functionName: "decimals"
      });
    }
    const quotesPromises = [
      this.getLifiQuote(fromAddress, params, fromTokenDecimals, slippage),
      this.getBebopQuote(fromAddress, params, fromTokenDecimals)
    ];
    const quotesResults = await Promise.all(quotesPromises);
    const sortedQuotes = quotesResults.filter(
      (quote) => quote !== void 0
    );
    sortedQuotes.sort((a, b) => BigInt(a.minOutputAmount) > BigInt(b.minOutputAmount) ? -1 : 1);
    if (sortedQuotes.length === 0) throw new Error("No routes found");
    return sortedQuotes;
  }
  async getLifiQuote(fromAddress, params, fromTokenDecimals, slippage = 0.01) {
    try {
      const routes = await getRoutes2({
        fromChainId: this.walletProvider.getChainConfigs(params.chain).id,
        toChainId: this.walletProvider.getChainConfigs(params.chain).id,
        fromTokenAddress: params.fromToken,
        toTokenAddress: params.toToken,
        fromAmount: parseUnits2(params.amount, fromTokenDecimals).toString(),
        fromAddress,
        options: {
          slippage,
          order: "RECOMMENDED"
        }
      });
      if (!routes.routes.length) throw new Error("No routes found");
      return {
        aggregator: "lifi",
        minOutputAmount: routes.routes[0].steps[0].estimate.toAmountMin,
        swapData: routes.routes[0]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("Return amount is not enough") || errorMessage.includes("INSUFFICIENT_OUTPUT_AMOUNT") || errorMessage.includes("slippage")) {
        elizaLogger3.error(
          `LiFi swap failed due to slippage protection. Consider increasing slippage tolerance. Error: ${errorMessage}`
        );
      }
      elizaLogger3.error("Error in getLifiQuote:", errorMessage);
      return void 0;
    }
  }
  async getBebopQuote(fromAddress, params, fromTokenDecimals) {
    try {
      const chainName = this.bebopChainsMap[params.chain] ?? params.chain;
      const url = `https://api.bebop.xyz/router/${chainName}/v1/quote`;
      const reqParams = new URLSearchParams({
        sell_tokens: params.fromToken,
        buy_tokens: params.toToken,
        sell_amounts: parseUnits2(params.amount, fromTokenDecimals).toString(),
        taker_address: fromAddress,
        approval_type: "Standard",
        skip_validation: "true",
        gasless: "false",
        source: "eliza"
      });
      const response = await fetch(`${url}?${reqParams.toString()}`, {
        method: "GET",
        headers: { accept: "application/json" }
      });
      if (!response.ok) {
        throw Error(`Bebop API error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      if (!data.routes || !Array.isArray(data.routes) || data.routes.length === 0) {
        throw new Error("No routes found in Bebop API response");
      }
      const firstRoute = data.routes[0];
      if (!firstRoute?.quote?.tx) {
        throw new Error("Invalid route structure in Bebop API response");
      }
      const route = {
        data: firstRoute.quote.tx.data,
        sellAmount: parseUnits2(params.amount, fromTokenDecimals).toString(),
        approvalTarget: firstRoute.quote.approvalTarget,
        from: firstRoute.quote.tx.from,
        value: firstRoute.quote.tx.value.toString(),
        to: firstRoute.quote.tx.to,
        gas: firstRoute.quote.tx.gas.toString(),
        gasPrice: firstRoute.quote.tx.gasPrice.toString()
      };
      if (!firstRoute.quote.buyTokens || !firstRoute.quote.buyTokens[params.toToken]) {
        throw new Error("Missing buyTokens information in Bebop API response");
      }
      return {
        aggregator: "bebop",
        minOutputAmount: firstRoute.quote.buyTokens[params.toToken].minimumAmount.toString(),
        swapData: route
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      elizaLogger3.error("Error in getBebopQuote:", errorMessage);
      return void 0;
    }
  }
  async executeLifiQuote(quote) {
    try {
      const route = quote.swapData;
      const step = route.steps[0];
      if (!step) {
        throw new Error("No steps found in route");
      }
      const stepWithTx = await getStepTransaction(step);
      if (!stepWithTx.transactionRequest) {
        throw new Error("No transaction request found in step after getStepTransaction");
      }
      const chainId = route.fromChainId;
      const chainName = Object.keys(this.walletProvider.chains).find(
        (name) => this.walletProvider.getChainConfigs(name).id === chainId
      );
      if (!chainName) {
        throw new Error(`Chain with ID ${chainId} not found in wallet provider`);
      }
      const walletClient = this.walletProvider.getWalletClient(chainName);
      if (!walletClient.account) {
        throw new Error("Wallet account is not available");
      }
      const txRequest = stepWithTx.transactionRequest;
      const fromToken = route.fromToken;
      if (fromToken.address !== "0x0000000000000000000000000000000000000000") {
        const allowanceAbi = parseAbi2([
          "function allowance(address,address) view returns (uint256)"
        ]);
        const spenderAddress = txRequest.to;
        const allowance = await this.walletProvider.getPublicClient(chainName).readContract({
          address: fromToken.address,
          abi: allowanceAbi,
          functionName: "allowance",
          args: [walletClient.account.address, spenderAddress]
        });
        const requiredAmount = BigInt(route.fromAmount);
        if (allowance < requiredAmount) {
          console.log(`###### APPROVING ${fromToken.symbol} FOR LIFI CONTRACT`);
          const approvalData = encodeFunctionData({
            abi: parseAbi2(["function approve(address,uint256)"]),
            functionName: "approve",
            args: [spenderAddress, requiredAmount]
          });
          const approvalTx = await walletClient.sendTransaction({
            account: walletClient.account,
            to: fromToken.address,
            value: 0n,
            data: approvalData,
            chain: walletClient.chain
          });
        }
      }
      const hash = await walletClient.sendTransaction({
        account: walletClient.account,
        to: txRequest.to,
        value: BigInt(txRequest.value || "0"),
        data: txRequest.data,
        chain: walletClient.chain,
        gas: BigInt(Math.floor(Number(txRequest.gasLimit || "0") * 1.2)),
        // Add 20% gas buffer
        gasPrice: txRequest.gasPrice ? BigInt(Math.floor(Number(txRequest.gasPrice) * 1.1)) : void 0
        // 10% higher gas price for MEV protection
      });
      console.log(`###### WAITING FOR TRANSACTION RECEIPT: ${hash}`);
      const publicClient = this.walletProvider.getPublicClient(chainName);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 6e4
        // 60 second timeout
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `Transaction reverted on-chain. Hash: ${hash}. This could be due to price movement, insufficient gas, or MEV frontrunning. Please try again.`
        );
      }
      console.log(`###### TRANSACTION CONFIRMED: ${hash}, Gas Used: ${receipt.gasUsed}`);
      return {
        hash,
        from: walletClient.account.address,
        to: txRequest.to,
        value: BigInt(txRequest.value || "0"),
        data: txRequest.data,
        chainId: route.fromChainId
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("Return amount is not enough") || errorMessage.includes("INSUFFICIENT_OUTPUT_AMOUNT") || errorMessage.includes("slippage")) {
        elizaLogger3.error(
          `LiFi swap failed due to slippage protection. Consider increasing slippage tolerance. Error: ${errorMessage}`
        );
        throw new Error(
          "Swap failed due to price movement. Try again or increase slippage tolerance."
        );
      }
      elizaLogger3.error(`Failed to execute lifi quote: ${errorMessage}`);
      return void 0;
    }
  }
  async executeBebopQuote(quote, params) {
    try {
      const bebopRoute = quote.swapData;
      const allowanceAbi = parseAbi2(["function allowance(address,address) view returns (uint256)"]);
      const allowance = await this.walletProvider.getPublicClient(params.chain).readContract({
        address: params.fromToken,
        abi: allowanceAbi,
        functionName: "allowance",
        args: [bebopRoute.from, bebopRoute.approvalTarget]
      });
      const walletClient = this.walletProvider.getWalletClient(params.chain);
      if (!walletClient.account) {
        throw new Error("Wallet account is not available");
      }
      if (allowance < BigInt(bebopRoute.sellAmount)) {
        const approvalData = encodeFunctionData({
          abi: parseAbi2(["function approve(address,uint256)"]),
          functionName: "approve",
          args: [bebopRoute.approvalTarget, BigInt(bebopRoute.sellAmount)]
        });
        await walletClient.sendTransaction({
          account: walletClient.account,
          to: params.fromToken,
          value: 0n,
          data: approvalData,
          chain: walletClient.chain
        });
      }
      const hash = await walletClient.sendTransaction({
        account: walletClient.account,
        to: bebopRoute.to,
        value: BigInt(bebopRoute.value),
        data: bebopRoute.data,
        chain: walletClient.chain
      });
      return {
        hash,
        from: walletClient.account.address,
        to: bebopRoute.to,
        value: BigInt(bebopRoute.value),
        data: bebopRoute.data
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      elizaLogger3.error(`Failed to execute bebop quote: ${errorMessage}`);
      return void 0;
    }
  }
};
var buildSwapDetails = async (state, _message, runtime, wp) => {
  const chains = wp.getSupportedChains();
  const balances = await wp.getWalletBalances();
  state = await runtime.composeState(_message, ["RECENT_MESSAGES"], true);
  state.supportedChains = chains.join(" | ");
  console.log("###### STATE", state);
  state.chainBalances = Object.entries(balances).map(([chain, balance]) => {
    const chainConfig = wp.getChainConfigs(chain);
    return `${chain}: ${balance} ${chainConfig.nativeCurrency.symbol}`;
  }).join(", ");
  const context = composePromptFromState2({
    state,
    template: swapTemplate
  });
  const xmlResponse = await runtime.useModel(ModelType2.TEXT_LARGE, {
    prompt: context
  });
  const parsedXml = parseKeyValueXml2(xmlResponse);
  if (!parsedXml) {
    throw new Error("Failed to parse XML response from LLM for swap details.");
  }
  let swapDetails = {
    fromToken: parsedXml.inputToken,
    toToken: parsedXml.outputToken,
    amount: parsedXml.amount,
    chain: parsedXml.chain
  };
  if (swapDetails.chain) {
    const normalizedChainName = swapDetails.chain.toLowerCase();
    if (!wp.chains[normalizedChainName]) {
      throw new Error(
        `Chain ${swapDetails.chain} not configured. Available chains: ${chains.join(", ")}`
      );
    }
    swapDetails.chain = normalizedChainName;
  }
  if (!swapDetails.amount || swapDetails.amount === "null" || swapDetails.amount === "") {
    const messageText = (_message.content.text || "").toLowerCase();
    if (messageText.includes("half") || messageText.includes("50%")) {
      const balance = balances[swapDetails.chain];
      if (balance) {
        const halfBalance = (parseFloat(balance) / 2).toString();
        swapDetails.amount = halfBalance;
      }
    } else if (messageText.includes("all") || messageText.includes("100%") || messageText.includes("everything")) {
      const balance = balances[swapDetails.chain];
      if (balance) {
        const mostBalance = (parseFloat(balance) * 0.9).toString();
        swapDetails.amount = mostBalance;
      }
    } else if (messageText.match(/(\d+)%/)) {
      const match = messageText.match(/(\d+)%/);
      if (match) {
        const percentage = parseInt(match[1]) / 100;
        const balance = balances[swapDetails.chain];
        if (balance) {
          const percentageBalance = (parseFloat(balance) * percentage).toString();
          swapDetails.amount = percentageBalance;
        }
      }
    }
  }
  return swapDetails;
};
var swapAction = {
  name: "EVM_SWAP_TOKENS",
  description: "Swap tokens on the same chain",
  handler: async (runtime, _message, state, _options, callback) => {
    const walletProvider = await initWalletProvider(runtime);
    const action = new SwapAction(walletProvider);
    try {
      if (!state) {
        state = await runtime.composeState(_message);
      }
      const swapOptions = await buildSwapDetails(state, _message, runtime, walletProvider);
      const swapResp = await action.swap(swapOptions);
      if (callback) {
        callback({
          text: `Successfully swapped ${swapOptions.amount} ${swapOptions.fromToken} for ${swapOptions.toToken} on ${swapOptions.chain}
Transaction Hash: ${swapResp.hash}`,
          content: {
            success: true,
            hash: swapResp.hash,
            chain: swapOptions.chain
          }
        });
      }
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error in swap handler:", errorMessage);
      if (callback) {
        callback({
          text: `Error: ${errorMessage}`,
          content: { error: errorMessage }
        });
      }
      return false;
    }
  },
  template: swapTemplate,
  validate: async (runtime) => {
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
          action: "TOKEN_SWAP"
        }
      }
    ]
  ],
  similes: ["TOKEN_SWAP", "EXCHANGE_TOKENS", "TRADE_TOKENS"]
};

// src/actions/transfer.ts
import {
  ModelType as ModelType3,
  parseKeyValueXml as parseKeyValueXml3,
  composePromptFromState as composePromptFromState3
} from "@elizaos/core";
import { formatEther, parseEther } from "viem";
var TransferAction = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
  }
  async transfer(params) {
    if (!params.data) {
      params.data = "0x";
    }
    const walletClient = this.walletProvider.getWalletClient(params.fromChain);
    if (!walletClient.account) {
      throw new Error("Wallet account is not available");
    }
    try {
      const hash = await walletClient.sendTransaction({
        account: walletClient.account,
        to: params.toAddress,
        value: parseEther(params.amount),
        data: params.data,
        chain: walletClient.chain
      });
      return {
        hash,
        from: walletClient.account.address,
        to: params.toAddress,
        value: parseEther(params.amount),
        data: params.data
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Transfer failed: ${errorMessage}`);
    }
  }
};
var buildTransferDetails = async (state, _message, runtime, wp) => {
  const chains = wp.getSupportedChains();
  const balances = await wp.getWalletBalances();
  state.chainBalances = Object.entries(balances).map(([chain, balance]) => {
    const chainConfig = wp.getChainConfigs(chain);
    return `${chain}: ${balance} ${chainConfig.nativeCurrency.symbol}`;
  }).join(", ");
  state = await runtime.composeState(_message, ["RECENT_MESSAGES"], true);
  state.supportedChains = chains.join(" | ");
  const context = composePromptFromState3({
    state,
    template: transferTemplate
  });
  const xmlResponse = await runtime.useModel(ModelType3.TEXT_SMALL, {
    prompt: context
  });
  const parsedXml = parseKeyValueXml3(xmlResponse);
  if (!parsedXml) {
    throw new Error("Failed to parse XML response from LLM for transfer details.");
  }
  const transferDetails = parsedXml;
  const normalizedChainName = transferDetails.fromChain.toLowerCase();
  const existingChain = wp.chains[normalizedChainName];
  if (!existingChain) {
    throw new Error(
      "The chain " + transferDetails.fromChain + " not configured yet. Add the chain or choose one from configured: " + chains.toString()
    );
  }
  transferDetails.fromChain = normalizedChainName;
  return transferDetails;
};
var transferAction = {
  name: "EVM_TRANSFER_TOKENS",
  description: "Transfer tokens between addresses on the same chain",
  handler: async (runtime, message, state, _options, callback) => {
    if (!state) {
      state = await runtime.composeState(message);
    }
    const walletProvider = await initWalletProvider(runtime);
    const action = new TransferAction(walletProvider);
    const paramOptions = await buildTransferDetails(state, message, runtime, walletProvider);
    try {
      const transferResp = await action.transfer(paramOptions);
      if (callback) {
        callback({
          text: `Successfully transferred ${paramOptions.amount} tokens to ${paramOptions.toAddress}
Transaction Hash: ${transferResp.hash}`,
          content: {
            success: true,
            hash: transferResp.hash,
            amount: formatEther(transferResp.value),
            recipient: transferResp.to,
            chain: paramOptions.fromChain
          }
        });
      }
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error during token transfer:", errorMessage);
      if (callback) {
        callback({
          text: `Error transferring tokens: ${errorMessage}`,
          content: { error: errorMessage }
        });
      }
      return false;
    }
  },
  validate: async (runtime) => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    return typeof privateKey === "string" && privateKey.startsWith("0x");
  },
  examples: [
    [
      {
        name: "assistant",
        content: {
          text: "I'll help you transfer 1 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
          action: "SEND_TOKENS"
        }
      },
      {
        name: "user",
        content: {
          text: "Transfer 1 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
          action: "SEND_TOKENS"
        }
      }
    ]
  ],
  similes: ["EVM_TRANSFER", "EVM_SEND_TOKENS", "EVM_TOKEN_TRANSFER", "EVM_MOVE_TOKENS"]
};

// src/service.ts
import { Service, logger as logger2 } from "@elizaos/core";
var EVMService = class _EVMService extends Service {
  constructor(runtime) {
    super();
    this.runtime = runtime;
  }
  static serviceType = EVM_SERVICE_NAME;
  capabilityDescription = "EVM blockchain wallet access";
  walletProvider = null;
  refreshInterval = null;
  lastRefreshTimestamp = 0;
  static async start(runtime) {
    logger2.log("Initializing EVMService");
    const evmService = new _EVMService(runtime);
    evmService.walletProvider = await initWalletProvider(runtime);
    await evmService.refreshWalletData();
    if (evmService.refreshInterval) {
      clearInterval(evmService.refreshInterval);
    }
    evmService.refreshInterval = setInterval(
      () => evmService.refreshWalletData(),
      CACHE_REFRESH_INTERVAL_MS
    );
    logger2.log("EVM service initialized");
    return evmService;
  }
  static async stop(runtime) {
    const service = runtime.getService(EVM_SERVICE_NAME);
    if (!service) {
      logger2.error("EVMService not found");
      return;
    }
    await service.stop();
  }
  async stop() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    logger2.log("EVM service shutdown");
  }
  async refreshWalletData() {
    try {
      if (!this.walletProvider) {
        this.walletProvider = await initWalletProvider(this.runtime);
      }
      const address = this.walletProvider.getAddress();
      const balances = await this.walletProvider.getWalletBalances();
      const chainDetails = Object.entries(balances).map(([chainName, balance]) => {
        try {
          const chain = this.walletProvider.getChainConfigs(chainName);
          return {
            chainName,
            balance,
            symbol: chain.nativeCurrency.symbol,
            chainId: chain.id,
            name: chain.name
          };
        } catch (error) {
          logger2.error(`Error formatting chain ${chainName}:`, error);
          return null;
        }
      }).filter(Boolean);
      const walletData = {
        address,
        chains: chainDetails,
        timestamp: Date.now()
      };
      await this.runtime.setCache(EVM_WALLET_DATA_CACHE_KEY, walletData);
      this.lastRefreshTimestamp = walletData.timestamp;
      logger2.log(
        "EVM wallet data refreshed for chains:",
        chainDetails.map((c) => c?.chainName).join(", ")
      );
    } catch (error) {
      logger2.error("Error refreshing EVM wallet data:", error);
    }
  }
  async getCachedData() {
    try {
      const cachedData = await this.runtime.getCache(EVM_WALLET_DATA_CACHE_KEY);
      const now = Date.now();
      if (!cachedData || now - cachedData.timestamp > CACHE_REFRESH_INTERVAL_MS) {
        logger2.log("EVM wallet data is stale, refreshing...");
        await this.refreshWalletData();
        const refreshedData = await this.runtime.getCache(EVM_WALLET_DATA_CACHE_KEY);
        return refreshedData || void 0;
      }
      return cachedData;
    } catch (error) {
      logger2.error("Error getting cached EVM wallet data:", error);
      return void 0;
    }
  }
  async forceUpdate() {
    await this.refreshWalletData();
    return this.getCachedData();
  }
};

// src/types/index.ts
import * as viemChains2 from "viem/chains";
var _SupportedChainList = Object.keys(viemChains2);
var VoteType = /* @__PURE__ */ ((VoteType2) => {
  VoteType2[VoteType2["AGAINST"] = 0] = "AGAINST";
  VoteType2[VoteType2["FOR"] = 1] = "FOR";
  VoteType2[VoteType2["ABSTAIN"] = 2] = "ABSTAIN";
  return VoteType2;
})(VoteType || {});

// src/index.ts
var evmPlugin = {
  name: "evm",
  description: "EVM blockchain integration plugin",
  providers: [evmWalletProvider],
  evaluators: [],
  services: [EVMService],
  actions: [transferAction, bridgeAction, swapAction]
};
var index_default = evmPlugin;
export {
  BridgeAction,
  EVMService,
  SwapAction,
  TransferAction,
  VoteType,
  WalletProvider,
  bridgeAction,
  bridgeTemplate,
  checkBridgeStatus,
  index_default as default,
  evmPlugin,
  evmWalletProvider,
  initWalletProvider,
  swapAction,
  swapTemplate,
  transferAction
};
//# sourceMappingURL=index.js.map