# Multi-chain market and wallet foundations

## Network boundaries

The routed-swap network registry contains Ethereum (`1`), BNB Chain (`56`), Base (`8453`), and Robinhood Chain
(`4663`). Every registry member has the same shape and can be used as a route source or destination. Adding Arbitrum
or Optimism is an additional registry and source-deployment entry, not a new route model.

The live Setwise application remains a separate BSC Testnet (`97`) deployment. It is available to wallet connection
but is not part of the routed-mainnet registry. Conversely, recognizing a mainnet in the wallet does not make that
network eligible for Setwise quotes or transactions.

## Asset and market identity

A token deployment is identified only by `(chainId, contractAddress)`. Symbols, names, underlying tickers, and issuer
labels are display and discovery metadata; they never authorize a quote or transaction. Index construction rejects
duplicate chain/address identities, and resolving an address on the wrong chain returns an unsupported-deployment
error.

Approved route inputs are an explicit per-chain allowlist:

| Chain | USDC | USDT |
| --- | --- | --- |
| Ethereum | Circle-native | Tether-native |
| BNB Chain | Binance-Peg | Binance-Peg / BSC-USD |
| Base | Circle-native | Base canonical bridge |
| Robinhood Chain | Unsupported | Unsupported |

Robinhood Chain stays in the symmetric network registry even though no canonical USDC or USDT deployment is
currently approved. An empty entry is deliberate and fails closed; no placeholder address or symbol fallback is
used.

A destination stock-token market carries its underlying, asset provider/issuer, deployment chain, contract address,
decimals, and optional issuer scaling metadata. Markets are indexed by deployment identity and separately grouped by
underlying. Grouping never collapses different issuer deployments, so two providers' tokens for the same stock remain
distinct outputs.

## Route roles and wallet switching

The domain names three independent parties explicitly:

- `assetProvider`: the issuer or tokenizer responsible for the destination asset deployment;
- `routeProvider`: the service that discovers or constructs a cross-chain route;
- `executionVenue`: the onchain or offchain venue named by that route.

A routed plan derives `sourceChainId` from the selected source-token deployment and `destinationChainId` from the
selected stock-token deployment. Wallet state keeps the currently connected chain separate from both. When a switch
is needed, the wallet targets the route's source chain, never its destination chain.

These modules represent route intent only. They do not request an external routed quote, build an external
transaction, or submit one; execution lives in the routed swap flow described below and never bypasses the
router's fail-closed validation.

The routed swap page (`/swap/routed`) composes these foundations into the first routed swap experience:
destination markets are built from the token catalog through `createRoutedMarketCatalog` (routed chains and
EVM addresses only, grouped by underlying without collapsing issuers), source assets come from the
canonical-stablecoin allowlist, and wallet switching targets the route's source chain. See
`docs/architecture/swap-router.md` for the quote contract, execution flow, and settlement tracking.
