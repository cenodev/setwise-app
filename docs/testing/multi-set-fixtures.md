# Local multi-Set fixtures

Reusable fixtures live in `src/test/multiSetFixtures.ts`. They deliberately model more than a renamed copy:

- `AI Leaders`: 6/18-decimal assets, 18-decimal LP shares, active trading, 0/30/90-day locks, locked and unlocked user
  shares, and a PancakeSwap liquidity source.
- `Defensive Pair`: 8/6-decimal assets, 6-decimal LP shares, paused trading with proportional withdrawals retained,
  no lock option, an unlocked user position, and a separate venue source.

Every fixture has an independent Set ID, contract, LP token, asset list, snapshot block, state, and wallet position.
Tests should import these fixtures when validating multi-Set behavior rather than changing `poolId` on one shared
object. A test that intentionally crosses a definition/state pair must expect a hard identity failure.

For browser testing against a local API, configure at least two registry entries with the same differences and set
`VITE_RFQ_API_URL` to that API. `VITE_POOL_ID` may choose a legacy redirect target but must not filter either entry.
