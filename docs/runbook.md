# Deployment and BSC Testnet runbook

## Pre-deployment

1. Use Node.js 22.12 or newer and run `npm ci`.
2. Configure the exact public `VITE_APP_URL`, a Reown project ID registered for that origin, the RFQ API URL, token-list
   URL, BSC Testnet RPC/explorer URLs, and the optional legacy `VITE_POOL_ID`.
3. Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
4. Serve `dist/` behind HTTPS with SPA fallback to `index.html`. Do not cache `index.html` indefinitely. RFQ POSTs and
   executable calldata must never be added to service-worker runtime caching.

## Read-only smoke test

Check the registry, then use returned IDs rather than assuming the legacy default:

```sh
curl -fsS "$VITE_RFQ_API_URL/v1/pools"
curl -fsS "$VITE_RFQ_API_URL/v1/pools/<poolId>"
curl -fsS "$VITE_RFQ_API_URL/v1/pools/<poolId>/state"
```

For at least two Sets, verify presentation metadata, chain ID `97`, unique Set/LP contract addresses, state `poolId`,
and state contract identity. Confirm `/sets`, both detail URLs, `/portfolio`, and `/swap?set=...` load after a hard
refresh. Check back/forward navigation, an invalid Set ID, legacy redirects, offline recovery, and a simulated failed
state response. Confirm paused and unsupported Sets leave unsafe actions disabled.

## Wallet smoke test

Use a disposable BSC Testnet wallet only. Switch account and network while viewing Portfolio and confirm old positions
disappear before new reads settle. For each test Set, obtain a quote but review the selected Set ID, assets, spender,
contract, and chain before approving. Exercise one deposit, proportional withdrawal, and swap where test funds permit;
confirm exactly one Set-specific Activity record and explorer link per attempt. Do not use mainnet funds.

## Rollback and diagnosis

The app is static, so rollback by restoring the previous known-good artifact and configuration. Do not deploy a build
when registry identity validation fails, request volume exceeds the documented budget, or a transaction can retain a
quote/approval after changing Set, account, or chain. API and RPC partial failures should degrade one Set, not the
entire directory or portfolio.
