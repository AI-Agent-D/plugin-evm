import { Token, Route } from '@lifi/types';
import { Hash, Address, Log, Chain, PublicClient, HttpTransport, Account, WalletClient } from 'viem';
import * as viemChains from 'viem/chains';
import { Plugin } from '@elizaos/core-plugin-v1';

declare const _SupportedChainList: Array<keyof typeof viemChains>;
type SupportedChain = (typeof _SupportedChainList)[number];
interface Transaction {
    hash: Hash;
    from: Address;
    to: Address;
    value: bigint;
    data?: `0x${string}`;
    chainId?: number;
    logs?: Log[];
}
interface TokenWithBalance {
    token: Token;
    balance: bigint;
    formattedBalance: string;
    priceUSD: string;
    valueUSD: string;
}
interface WalletBalance {
    chain: SupportedChain;
    address: Address;
    totalValueUSD: string;
    tokens: TokenWithBalance[];
}
interface ChainMetadata {
    chainId: number;
    name: string;
    chain: Chain;
    rpcUrl: string;
    nativeCurrency: {
        name: string;
        symbol: string;
        decimals: number;
    };
    blockExplorerUrl: string;
}
interface ChainConfig {
    chain: Chain;
    publicClient: PublicClient<HttpTransport, Chain, Account | undefined>;
    walletClient?: WalletClient;
}
interface TransferParams {
    fromChain: SupportedChain;
    toAddress: Address;
    amount: string;
    data?: `0x${string}`;
}
interface SwapParams {
    chain: SupportedChain;
    fromToken: Address;
    toToken: Address;
    amount: string;
    slippage?: number;
}
interface BebopRoute {
    data: string;
    approvalTarget: Address;
    sellAmount: string;
    from: Address;
    to: Address;
    value: string;
    gas: string;
    gasPrice: string;
}
interface SwapQuote {
    aggregator: "lifi" | "bebop";
    minOutputAmount: string;
    swapData: Route | BebopRoute;
}
interface BridgeParams {
    fromChain: SupportedChain;
    toChain: SupportedChain;
    fromToken: Address;
    toToken: Address;
    amount: string;
    toAddress?: Address;
}
interface EvmPluginConfig {
    rpcUrl?: {
        ethereum?: string;
        abstract?: string;
        base?: string;
        sepolia?: string;
        bsc?: string;
        arbitrum?: string;
        avalanche?: string;
        polygon?: string;
        optimism?: string;
        cronos?: string;
        gnosis?: string;
        fantom?: string;
        fraxtal?: string;
        klaytn?: string;
        celo?: string;
        moonbeam?: string;
        aurora?: string;
        harmonyOne?: string;
        moonriver?: string;
        arbitrumNova?: string;
        mantle?: string;
        linea?: string;
        scroll?: string;
        filecoin?: string;
        taiko?: string;
        zksync?: string;
        canto?: string;
        alienx?: string;
        gravity?: string;
    };
    secrets?: {
        EVM_PRIVATE_KEY: string;
    };
    testMode?: boolean;
    multicall?: {
        batchSize?: number;
        wait?: number;
    };
}
type LiFiStatus = {
    status: "PENDING" | "DONE" | "FAILED";
    substatus?: string;
    error?: Error;
};
type LiFiRoute = {
    transactionHash: Hash;
    transactionData: `0x${string}`;
    toAddress: Address;
    status: LiFiStatus;
};
interface TokenData extends Token {
    symbol: string;
    decimals: number;
    address: Address;
    name: string;
    logoURI?: string;
    chainId: number;
}
interface TokenPriceResponse {
    priceUSD: string;
    token: TokenData;
}
interface TokenListResponse {
    tokens: TokenData[];
}
interface ProviderError extends Error {
    code?: number;
    data?: unknown;
}
declare enum VoteType {
    AGAINST = 0,
    FOR = 1,
    ABSTAIN = 2
}
interface Proposal {
    targets: Address[];
    values: bigint[];
    calldatas: `0x${string}`[];
    description: string;
}
interface VoteParams {
    chain: SupportedChain;
    governor: Address;
    proposalId: string;
    support: VoteType;
}
interface QueueProposalParams extends Proposal {
    chain: SupportedChain;
    governor: Address;
}
interface ExecuteProposalParams extends Proposal {
    chain: SupportedChain;
    governor: Address;
    proposalId: string;
}
interface ProposeProposalParams extends Proposal {
    chain: SupportedChain;
    governor: Address;
}

declare const evmPlugin: Plugin;

export { type BebopRoute, type BridgeParams, type ChainConfig, type ChainMetadata, type EvmPluginConfig, type ExecuteProposalParams, type LiFiRoute, type LiFiStatus, type Proposal, type ProposeProposalParams, type ProviderError, type QueueProposalParams, type SupportedChain, type SwapParams, type SwapQuote, type TokenData, type TokenListResponse, type TokenPriceResponse, type TokenWithBalance, type Transaction, type TransferParams, type VoteParams, VoteType, type WalletBalance, evmPlugin as default, evmPlugin };
