export const transferTemplate = `You are helping an AI agent with a blockchain transaction by reading the past messages as shown below:

{{recentMessages}}

{{chainBalances}}

Follow these instructions to see what should be the final output, an XML file:

Firstly, from the messages, I want you to decide if this is a native token transfer or not on the blockchain: {{supportedChains}}. A native token transfer involves the direct movement of a blockchain’s built in currency.

Secondly, I want you to extract the token symbol. If this is a native token transfer, then output the symbol for native tokens. If this is not a native token transfer, then extract the token symbol in ERC-20 version.

Thirdly, I want you to extract the amount to be transferred. Based on the previous decision, if this transaction is a native token transfer then **report the amount in wei.** If this is **not** a native token transfer, this should be the **total amount of the token based on the second step** to be transferred by the AI agent to the recipient in **its smallest unit** (token decimals).

## For this section, search online only if needed and use official sources only!
Fourthly, deduce the address to send the token to. If this is a native token transfer, then use the recipient’s address in the messages. If this not a native token transfer, then use the **token address for the token you chose from the third step for the blockchain:  {{supportedChains}}..** If you do not know the token address, then do a quick search to find out the token address in the blockchain: {{supportedChains}}.. **Never guess this** and only output null if you do not know the token address or if the recipient’s address is not present.
## End section.

Fifth, go through the recent messages again and extract the recipient address (i.e the address where the AI agent sends the tokens to). **This is very important in the last step before putting the data inside the XML block**

Respond using an XML block containing only the extracted values, whereby:
amount: If there is a native token transfer, then this should be in wei, or else it should be set to 0. **Do not rely on the value found in step 2 on this section.**
toAddress: This is the address found from the fourth step.
token: The token symbol from the third step.
tokenDecimals: The full amount you obtained, in the third step, in full. (MUST BE IN INT)
recipientAddress: The recipient address you extracted from the fifth step.

All fields must be filled:

<response>
<fromChain>  {{supportedChains}}. </fromChain> <amount>string | null</amount> <toAddress>string | null</toAddress> <token>string | null</token> <tokenDecimals> int | null </tokenDecimals> <recipientAddress> str | null </recipientAddress>
</response>

IMPORTANT: Your response must ONLY contain the <response></response> XML block above. Do not include any text, thinking, or reasoning before or after this XML block. Start your response immediately with <response> and end with </response>.
`;

export const bridgeTemplate = `Given the recent messages and wallet information below:

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

export const swapTemplate = `Given the recent messages and wallet information below:

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

export const proposeTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested proposal:
- Targets
- Values
- Calldatas
- Description
- Governor address
- Chain to execute on

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:

\`\`\`json
{
    "targets": string[] | null,
    "values": string[] | null,
    "calldatas": string[] | null,
    "description": string | null,
    "governor": string | null
    "chain": "ethereum" | "base" | "sepolia" | "bsc" | "arbitrum" | "avalanche" | "polygon" | "optimism" | "cronos" | "gnosis" | "fantom" | "klaytn" | "celo" | "moonbeam" | "aurora" | "harmonyOne" | "moonriver" | "arbitrumNova" | "mantle" | "linea" | "scroll" | "filecoin" | "taiko" | "zksync" | "canto" | null,
}
\`\`\`
`;

export const voteTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested vote:
- Proposal ID
- Support (1 for yes, 2 for no, 3 for abstain)
- Governor address
- Chain to execute on

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:

\`\`\`json
{
    "proposalId": string | null,
    "support": number | null,
    "governor": string | null
    "chain": "ethereum" | "base" | "sepolia" | "bsc" | "arbitrum" | "avalanche" | "polygon" | "optimism" | "cronos" | "gnosis" | "fantom" | "klaytn" | "celo" | "moonbeam" | "aurora" | "harmonyOne" | "moonriver" | "arbitrumNova" | "mantle" | "linea" | "scroll" | "filecoin" | "taiko" | "zksync" | "canto" | null,
}
\`\`\`
`;

export const queueProposalTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested proposal:
- Targets
- Values
- Calldatas
- Description
- Governor address
- Chain to execute on

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:

\`\`\`json
{
    "targets": string[] | null,
    "values": string[] | null,
    "calldatas": string[] | null,
    "description": string | null,
    "governor": string | null
    "chain": "ethereum" | "base" | "sepolia" | "bsc" | "arbitrum" | "avalanche" | "polygon" | "optimism" | "cronos" | "gnosis" | "fantom" | "klaytn" | "celo" | "moonbeam" | "aurora" | "harmonyOne" | "moonriver" | "arbitrumNova" | "mantle" | "linea" | "scroll" | "filecoin" | "taiko" | "zksync" | "canto" | null,
}
\`\`\`
`;

export const executeProposalTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested proposal:
- Targets
- Values
- Calldatas
- Description
- Governor address
- Chain to execute on

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:

\`\`\`json
{
    "targets": string[] | null,
    "values": string[] | null,
    "calldatas": string[] | null,
    "description": string | null,
    "governor": string | null
    "chain": "ethereum" | "base" | "sepolia" | "bsc" | "arbitrum" | "avalanche" | "polygon" | "optimism" | "cronos" | "gnosis" | "fantom" | "klaytn" | "celo" | "moonbeam" | "aurora" | "harmonyOne" | "moonriver" | "arbitrumNova" | "mantle" | "linea" | "scroll" | "filecoin" | "taiko" | "zksync" | "canto" | null,
}
\`\`\`
`;
