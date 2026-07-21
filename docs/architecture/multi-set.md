# Multi-Set architecture

## Terminology and trust boundaries

**Set** is the product term rendered to users. A Set maps one-to-one to an RFQ/on-chain **pool**, so internal schemas,
API paths, payloads, Solidity methods, activity compatibility fields, and source types keep `pool` and `poolId`.
Renaming those internal identifiers would be a wire/storage migration, not a copy change.

The RFQ registry is authoritative. Token metadata can decorate an asset but cannot add a Set, change contract order,
or make an unsupported pair executable.

## Route and data flow

```text
GET /v1/pools
  -> SetDefinition adapter
  -> /sets
  -> /sets/:setId/{overview,deposit,withdraw}
  -> /swap?set=:setId
  -> /portfolio

route/query Set id
  -> GET /v1/pools/:poolId
  -> GET /v1/pools/:poolId/state
  -> validate id + chain + contract
  -> render or enable the selected Set
```

The route ID is untrusted until it resolves against the registry. Detail and state responses must match the registry
ID, chain ID, and contract address. Any mismatch becomes an isolated error and cannot enable a transaction.

## Cache and transaction isolation

Canonical query keys are:

- registry: `['sets']`
- detail: `['sets', poolId]`
- state: `['sets', poolId, 'state']`
- wallet position: Set ID, contract, snapshot block, wallet chain, and account
- portfolio wallet positions: account, wallet chain, and every Set ID/contract/snapshot block

Deposit, withdrawal, and swap components receive the selected `Pool` and `PoolState` explicitly. Quote bodies always
include that `poolId`; firm responses are checked against the selected Set's chain, contract, sender, assets, balance,
and approval context before submission. Changing Set remounts or resets transaction state, aborts stale quotes, and
cannot reuse approvals or an atomic batch. New activity includes `setId`; older swap and withdrawal records without it
remain readable.

## Request budget

| Surface | Interval | API concurrency | Wallet RPC behavior |
| --- | ---: | ---: | --- |
| Set directory | 30 s | 3 Set states | None |
| Set detail | 15 s | 1 Set state | One Set, pinned to snapshot block |
| Swap | 15 s | 1 selected Set state | Selected Set balances/allowances only |
| Portfolio | 15 s | 3 Set detail/state loads | Compatible Sets batched by chain and block |

The same per-Set cache keys are reused across surfaces. Only the mounted route owns a recurring aggregate poll, so
navigation does not leave hidden pollers running. Unsupported-chain Sets do not start wallet reads. Failed Sets stay
visible as partial coverage and do not erase healthy results.

## Failure and accessibility behavior

Registry, Set-state, and RPC failures are isolated. Stale data is labeled; offline mode never submits quotes or
transactions. Loading changes use polite live regions and terminal errors use alerts. Tabs and tables are keyboard
reachable with visible focus, mobile layouts avoid fixed content widths, and `prefers-reduced-motion` suppresses
non-essential transitions and animations.
