export const searchAddressTokenTemplate = `

You are helping an AI agent with a blockchain transaction by reading the recent messages as shown below:

{{recentMessages}}

For each chain shown in the recentMessages, I want you to follow the instructions:

Firstly, want you to extract the token symbols.

## For this section, search online and use official sources only!
Secondly, research online on what the tokenDecimals are for the token symbol you found on the first step.

Thirdly, research online what the token address is on the chain current chain.
## End section.

Fifthly, there can be more than one chain in the recent messages, so perform the check for each chain.

Return your output as a json file as follows where the keys are:

tokenSymbol: The token symbol you found in the first step.
tokenDecimals: The token decimals you found in the second step.
tokenAddress: The token address you find online in the third step.
chains: One of the chains you found in the fourth step.

Here is the format of the json file:

\`\`\`\json
{
  "chainName": {
    "tokenSymbol": {
      "tokenDecimals": number,
      "tokenAddress": "string"
    }
  }
}
\`\`\`\

The above layout must remain the same for each chain you find. Add a new chain name with the same structure for each chain you find.
`;

export const transferTemplate = `You are helping an AI agent with a blockchain transaction by reading the past messages as shown below:

{{recentMessages}}

{{chainBalances}}

Follow these instructions to see what should be the final output, an XML file:

Firstly, from the messages, I want you to decide if this is a native token transfer or not on the blockchain: {{supportedChains}}. A native token transfer involves the direct movement of a blockchain’s built in currency.

Secondly, I want you to extract the token symbol. If this is a native token transfer, then output the symbol for native tokens. If this is not a native token transfer, then extract the token symbol in ERC-20 version.

Thirdly, I want you to extract the amount to be transferred between one address to another.

## For this section, search online only if needed and use official sources only!
Fourthly, deduce the address to send the token to. If this is a native token transfer, then use the recipient’s address in the messages. If this not a native token transfer, then use the **token address for the token you chose from the third step for the blockchain:  {{supportedChains}}..** If you do not know the token address, then do a quick search to find out the token address in the blockchain: {{supportedChains}}.. **Never guess this** and only output null if you do not know the token address or if the recipient’s address is not present.
## End section.

Fifth, go through the recent messages again and extract the recipient address (i.e the address where the AI agent sends the tokens to). 

Sixth, I want you to use the token symbol you found in the second step and deduce the number of token decimals needed for the transfer. 

Seventh, I want you to look at the recentMessages and find out the blockchain that the transfer is going to be conducted in. It has to be **one** of these blockchains, whereby the '|' indicates 'or': {{supportedChains}}

Respond using an XML block containing only the extracted values, whereby:
amount: The amount found from the third step.
toAddress: This is the address found from the fourth step.
token: The token symbol from the second step.
tokenDecimals: The number of token decimals you obtained, in the sixth step. 
recipientAddress: The recipient address you extracted from the fifth step.
fromChain: The blockchain where the transfer is conducted in the seventh step. The final answer should not contain '|' because this symbol means 'or'.

All fields must be filled:

<response>
<fromChain>  string | null. </fromChain> <amount>string | null</amount> <toAddress>string | null</toAddress> <token>string | null</token> <tokenDecimals> int | null </tokenDecimals> <recipientAddress> str | null </recipientAddress>
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
