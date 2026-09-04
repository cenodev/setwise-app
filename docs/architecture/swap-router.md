# Swap-router integration and trust boundary

The app consumes normalized swap routing from
[cenodev/setwise-swap-router](https://github.com/cenodev/setwise-swap-router). The router talks to upstream
providers (0x, LI.FI, later others) and normalizes them behind a versioned JSON contract; the app integrates
against that contract only, never against provider SDKs or payloads.

## Trust boundary

```
providers (0x, LI.FI, …)
        │  provider-specific schemas, credentials, sessions
        ▼
setwise-swap-router ── normalizes, ranks, policy-checks ──▶ versioned /v1 JSON
        ▲                                                      │
        │                                                      ▼
        └────────────── setwise-app (src/data/swapRouter) ────┘
              schema validation → identity validation → UI state
```

- **Provider-specific payloads never enter UI state.** Contract objects are parsed with zod schemas that strip
  unknown keys, so anything the router (or a confused upstream) adds beyond the contract is dropped at the
  boundary. `providerId` and `quoteId` are opaque round-tripped tokens; the app never parses, constructs, or
  branches on provider internals.
- **Responses must preserve the request.** After schema validation, the client re-checks identity: source and
  destination chains, chain-qualified token addresses, sender/recipient, and the exact input amount. Prepared
  swaps must echo the selected quote, scope approvals to the source token and sender, and target the source
  chain, carrying native value only for native inputs. Any mismatch throws `RESPONSE_MISMATCH` — the flow fails
  closed rather than executing against different money than the user reviewed.
- **Status shape fails closed.** Execution status is provider-neutral: `pending`, plus the terminal
  `confirmed`, `partially_delivered`, `expired`, `refunded`, and `failed`. Unknown states or a transaction on
  the wrong chain (source or destination evidence) are rejected before they can reach activity tracking.
- **No credentials in the browser.** The only swap-router environment variable is `VITE_SWAP_ROUTER_API_URL` —
  a base URL, defaulting to the deployed `setwise-swap-router.datadex.workers.dev` Worker; point it at
  `http://localhost:8787` when running the router with `wrangler dev`. Provider API keys live only in the
  router service as Worker secrets and must never be added to `VITE_*` variables.

## Modules (`src/data/swapRouter`)

| Module         | Responsibility                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `schema.ts`    | zod schemas and types for capabilities, exact-input intents, quotes, quote diagnostics, approvals, transactions, fees, steps, and execution status. |
| `errors.ts`    | `SwapRouterApiError` (with optional envelope `details`) and the client-side error codes.                |
| `validation.ts`| Fail-closed identity checks between request and response.                                               |
| `client.ts`    | Abortable, `no-store` HTTP clients with stable error mapping.                                           |
| `fixtures.ts`  | Deterministic normalized fixtures for tests.                                                            |

Endpoints consumed: `GET /v1/capabilities`, `POST /v1/quotes`, `POST /v1/swap`. Execution status uses
`POST /v1/swaps/status` (`{ providerId, quoteId, transactionHash? }`), which is part of this app-side contract
and is exercised against fixtures until the router ships it.

## Error mapping

| Condition                              | `SwapRouterApiError.code` | `status`     |
| -------------------------------------- | ------------------------- | ------------ |
| Transport failure / unreachable router | `NETWORK_ERROR`           | `0`          |
| Non-2xx without an error envelope      | `HTTP_ERROR`              | HTTP status  |
| Router error envelope                  | envelope code, e.g. `UNSUPPORTED_ROUTE`, `NO_QUOTES`, `QUOTE_EXPIRED` | HTTP status |
| 2xx body fails schema validation       | `INVALID_RESPONSE`        | HTTP status  |
| Response violates request identity     | `RESPONSE_MISMATCH`       | `200`        |

Abort signals propagate the original `AbortError` unwrapped so React Query cancellation keeps working.

## Caching

Quotes and statuses are point-in-time execution data: every request uses `cache: "no-store"`, and React Query
consumers pair `swapRouterQueryKeys` with `routedSwapQueryDefaults` (`staleTime: 0`, `gcTime: 0`,
`refetchOnMount: "always"`) so nothing is served from cache.

## Fixtures

`fixtures.ts` provides deterministic, import-time-validated fixtures: same-chain and cross-chain quotes, a
prepared swap, full and partial-provider capabilities, no-route, expired, and provider-outage error envelopes,
malformed payloads, and the full execution-status set including partial delivery and destination evidence. App
tests exercise routed swaps entirely against these fixtures; no live router or provider credentials are required.

## The routed swap page (`/swap/routed`)

`src/features/swap/RoutedSwapPage.tsx` is the first UI consumer of the router contract: it quotes, compares,
reviews, and then executes the route from the user's wallet, tracking cross-chain settlement afterwards.

- **Selection.** The user picks a source chain (any of the four routed networks; chains without an approved
  canonical stablecoin or without router support are visible but disabled), a canonical stablecoin (USDC or
  USDT from `sourceAssetsByChain`), an exact-input amount, and one destination market chosen through the
  market picker   modal (`src/features/swap/MarketPickerModal.tsx`): searchable by stock, token, issuer, or
  address, filterable by network and issuer provider, grouped by underlying with token logos, and annotated
  with per-chain route-provider coverage from capabilities. The modal keeps a fixed footprint (standard
  600 px dialog with a constant-height scrollable results region, fullscreen below 640 px) so filtering
  never resizes or recenters it. The selected output is always a concrete market
  deployment (underlying, issuer, chain, contract address); different issuers for the same underlying stay
  distinct.
- **Preselection.** Provider-market rows on asset detail link to `/swap/routed?chain=<id>&token=<address>`.
  The linked deployment resolves exactly or the page shows an explicit unavailable-market error — it never
  silently substitutes another issuer's token.
- **Quote discipline.** Requests use the same debounce (450 ms), `AbortController`, sequence counter, and
  draft request-key checks as the Setwise pool swap: a response may only replace the draft when its key
  matches the current draft identity (source chain + token, amount, destination chain + token, recipient),
  so obsolete responses can never overwrite the user's current route. Quotes are fetched with
  `requestSwapQuotesWithDiagnostics`, which additionally returns the router's per-provider diagnostics;
  error envelopes keep their per-path `details`. The page renders both as human-readable per-provider notes
  (`providerFailureNotes` / `quoteErrorProviderNotes`): a degraded provider alongside live quotes shows a
  limited-coverage banner, and a no-route response names each provider's reason instead of a bare empty
  state. Quotes refresh in the background while editing with the user's route-provider selection preserved
  across router quote-id rotations; review and execution freeze refresh so the reviewed amounts never shift.
  The comparison panel offers a route-provider filter when several providers quote.
- **Review identity.** A review binds the quote to its source chain, destination chain, both token
  contracts, guaranteed minimum output, slippage bound, and a freshness countdown tied to `expiresAt`.
  Same-chain and cross-chain quotes render through the same panel; both explain that the wallet transacts
  only on the source chain, and cross-chain routes surface the underlying bridge leg from `steps`.
- **Execution gating.** Review requires the connected wallet to be on the route's source chain (per
  `getWalletNetworkRequirement` semantics), a known sufficient stablecoin balance, and a fresh,
  draft-matching quote. Editing the amount, wallet, source chain, stablecoin, or destination market
  invalidates the executable state.
- **Execution (`routedExecution.ts`).** Confirming a review re-requests the route and requires a route with
  identical economics to still be offered (`revalidateReviewedQuote`); the match is by economics (provider,
  chains, chain-qualified assets, exact input, sender/recipient, slippage, quoted outputs), not by the opaque
  quote id, because the router rotates quote ids on every `/v1/quotes` call even for identical economics.
  Expired or changed routes block execution. The prepared swap is then rebuilt into
  the only wallet-eligible submission (`buildRoutedSubmission`): the wallet account must equal the intent
  recipient, the transaction must target the source chain, value must match the input mode, and — for token
  inputs — the normalized approval spender must equal the prepared transaction target, scoped to the reviewed
  token and sender, for exactly the input amount. No buffer, no unlimited allowance, and the transaction target
  is never approved by assumption. Immediately before the wallet opens and after every await, an execution-window
  guard rechecks connectivity, account, chain, and quote freshness; the wallet is switched back to the source
  chain if it drifted.
- **Submission and settlement.** The exact approval (only when the on-chain allowance is short) and one
  source-chain transaction are signed by the user's wallet via wagmi; the app never custodies keys or
  broadcasts. The prepared transaction is simulated (`eth_call`) after approval, before submission. After
  source confirmation, `mapExecutionStatus` polls `POST /v1/swaps/status` and maps states onto the local
  lifecycle — only `confirmed` is receipt; post-submission `expired` is surfaced as unknown with the provider
  detail. A provider outage keeps the record resumable (`unknown`) and polling.
- **Activity evidence.** Routed swaps extend the swap activity record with an optional routed payload (route
  provider, quote identity and verbatim quote, source/destination chains, approval/destination hashes, and the
  lifecycle). The lifecycle is forward-only, and only `delivered` maps to a success status, so partial,
  refunded, failed, and unknown outcomes are never presented as receipt of the destination token — the activity
  page says so explicitly and links approval, source, and destination transactions to their own chain explorers
  (`src/config/explorers.ts`). Background tracking resumes automatically app-wide
  (`src/features/swap/routedResume.ts`) so a reload or navigation keeps settlement moving.

## Relationship to the Setwise RFQ flow

The swap-router integration is additive. The existing Setwise RFQ client (`src/data/rfq`) and its BSC Testnet
execution path are unchanged; routed mainnet swaps build on the multi-chain market foundations in
`docs/architecture/multi-chain-markets.md`.
