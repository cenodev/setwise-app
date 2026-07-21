# Setwise app

React PWA for discovering and operating multiple Setwise Sets on BSC Testnet.

A **Set** is the user-facing product. Each Set is backed by its own protocol liquidity pool. The UI therefore says
Set, while RFQ endpoints, request payloads, stored compatibility fields, and source code intentionally retain
`pool`/`poolId` terminology.

## Local setup

Requirements: Node.js 22.12+ (Node.js 24 is used in the current workspace) and npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Create a project in the [Reown Dashboard](https://dashboard.reown.com) and set `VITE_REOWN_PROJECT_ID`. Leave
`VITE_APP_URL` blank during local or forwarded development so the browser origin is derived automatically. Set it to
the exact public HTTPS origin in deployment; that origin must also be registered with Reown. Without a project ID,
public Set pages still work, but wallet connection is disabled safely.

The app discovers every Set from `GET /v1/pools`. `VITE_POOL_ID` is only the legacy redirect/default used by old
`/pool`, `/deposit`, and `/withdraw` links; it does not filter the registry. RFQ discovery remains authoritative for
Set eligibility, asset order, addresses, capabilities, and transaction identifiers.

Token names and logos come from the public Setwise token list and are presentation-only. Override its URL with
`VITE_TOKEN_LIST_URL`. Metadata is matched by chain ID and lowercase contract address, so token-list failure never
changes which assets can be quoted or submitted.

## Routes

| Route | Purpose |
| --- | --- |
| `/sets` | Public directory of all discovered Sets |
| `/sets/:setId/overview` | Public Set metrics and connected-wallet position |
| `/sets/:setId/deposit` | Deposit into the route-selected Set |
| `/sets/:setId/withdraw` | Withdraw from the route-selected Set |
| `/portfolio` | Aggregate public liquidity and connected-wallet positions |
| `/swap?set=:setId` | Standalone swap for one explicitly selected Set |
| `/activity` | Backward-compatible local transaction history |
| `/faucet` | BSC Testnet mock assets |

`/`, `/sets/:setId`, and the legacy single-Set routes redirect to the appropriate canonical route. Invalid Set IDs
show a safe not-found state. Refresh and browser back/forward navigation preserve the route-selected Set and tab.

## Liquidity definitions

- **Set reserves / Set TVL:** assets held by one Set's underlying pool, valued by the RFQ state snapshot.
- **Setwise TVL:** sum of healthy Set TVLs. Missing Sets remain explicit and are not treated as zero.
- **User Set liquidity:** attributed unlocked plus locked LP shares divided by that Set's LP supply, multiplied by its
  Set TVL.
- **External DEX liquidity:** separately reported venue liquidity, deduplicated by chain, venue, and source address. It
  is not included in Setwise TVL and does not guarantee an executable quote.

All financial aggregation uses integer/decimal-safe ratios rather than JavaScript floating point.

## Runtime and request behavior

The current execution scope is BSC Testnet (chain ID `97`). Unsupported-chain Sets remain visible, but wallet reads
and transactions are disabled. The directory refreshes supported Set states every 30 seconds with at most three
requests in flight. Set detail, Swap, and Portfolio use one canonical per-Set query-key namespace, so route changes
reuse validated cache entries instead of starting duplicate polling. Detail and Portfolio state refresh every 15
seconds; Portfolio state loading is capped at three concurrent API requests and compatible wallet reads are batched by
chain and snapshot block. Polling pauses under the query client's offline state and resumes on reconnect.

Read-only stale snapshots may remain visible with a stale/offline label. Quote POSTs, firm quotes, RPC writes, and
wallet requests are network-only. A definition/state identity mismatch disables data and actions instead of rendering
one Set's values under another Set.

## Documentation

- [Multi-Set architecture](docs/architecture/multi-set.md)
- [Deployment and BSC Testnet runbook](docs/runbook.md)
- [Local fixture guide](docs/testing/multi-set-fixtures.md)

## Checks

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

The implementation backlog and acceptance criteria are in [`TASKS.md`](./TASKS.md).
