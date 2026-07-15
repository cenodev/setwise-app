# Setwise prototype implementation tasks

Status values: `todo`, `in progress`, `done`, `blocked`.

## Foundation

### APP-001 — React PWA scaffold

- Status: done
- Depends on: none
- Deliver: Vite + React + TypeScript package, routing shell, Tailwind tokens, PWA manifest/service worker, lint/typecheck/test/build scripts.
- Accept: `npm run lint`, `npm test`, and `npm run build` pass; production output includes a manifest and service worker; `/swap`, `/deposit`, `/withdraw`, and `/activity` deep links render.

### APP-002 — External wallet integration

- Status: done
- Depends on: APP-001
- Deliver: Reown AppKit + wagmi + viem, BSC Testnet only, WalletConnect/EIP-6963 connection, account/balance display, reconnect, disconnect/account modal, wrong-network detection and switch action.
- Accept: missing project ID produces a safe setup state; configured builds can connect an extension or mobile wallet; writes cannot proceed on a chain other than 97; email/social, AppKit swaps, and on-ramp are disabled.

### APP-003 — Shared application shell

- Status: todo
- Depends on: APP-001, APP-002
- Deliver: final responsive header/navigation, banners, wallet/network/offline gates, risk disclosure, install and update prompts.
- Accept: 360 px and 1024 px layouts match the design specification; all navigation and gates are keyboard accessible.

### APP-004 — Environment and runtime configuration

- Status: todo
- Depends on: APP-001
- Deliver: validated Reown ID, app origin, RFQ URL, RPC URL, pool ID and explorer configuration with a non-secret public configuration boundary.
- Accept: malformed/missing required production values fail with actionable diagnostics; secrets are never bundled.

### APP-005 — RFQ API client and schemas

- Status: todo
- Depends on: APP-001, APP-004
- Deliver: typed fetch client, Zod schemas, normalized API errors, query keys, cancellation and idempotency helpers.
- Accept: every currently used RFQ response is runtime-validated; obsolete indicative requests are aborted; firm quote POSTs are never cached.

### APP-006 — Chain reads and transaction primitives

- Status: todo
- Depends on: APP-002, APP-004
- Deliver: imported minimal ABIs, balances, allowances, locked shares, pool reads, transaction validation, receipt reconciliation and explorer helpers.
- Accept: all atomic amounts remain `bigint`; returned RFQ transactions are checked for chain, sender, destination, value and deadline before wallet submission.

## Swap

### SWAP-001 — Exact-input indicative quote form

- Status: todo
- Depends on: APP-003, APP-005, APP-006
- Deliver: asset selectors, amount input, reverse pair, balance/gas handling, debounced indicative quote and quote summary.
- Accept: token→token, BNB→token and token→BNB intents price correctly; stale responses cannot overwrite current input.

### SWAP-002 — Approval and executable swap

- Status: todo
- Depends on: SWAP-001
- Deliver: allowance check, exact approval, firm quote after approval, countdown, returned transaction submission and receipt states.
- Accept: approvals finish before firm quote creation; expired calldata cannot start a new wallet request; success refreshes balances and pool state.

### SWAP-003 — Swap failure and recovery states

- Status: todo
- Depends on: SWAP-002
- Deliver: rejection, expiry, market policy, pause, API/RPC failure and on-chain revert treatment.
- Accept: every terminal state has one clear recovery action and no stale executable quote is retained.

## Deposit

### DEPOSIT-001 — Single-asset deposit

- Status: todo
- Depends on: APP-003, APP-005, APP-006
- Deliver: asset/amount input, lock selector, indicative shares, approval, firm quote and receipt flow.
- Accept: 0/30/90-day options follow API configuration and an existing lock forces new deposits to 0 days.

### DEPOSIT-002 — Portfolio deposit

- Status: todo
- Depends on: DEPOSIT-001
- Deliver: contract-ordered asset rows, target-weight fill helper, balance shortfalls and sequential approvals.
- Accept: ordered atomic amounts match discovery order and all approvals confirm before requesting the firm quote.

### DEPOSIT-003 — Locked shares and claim

- Status: todo
- Depends on: APP-006, DEPOSIT-001
- Deliver: locked amount/unlock time panel and `claimShares()` transaction.
- Accept: claim is enabled only when the contract reports it claimable and receipt refreshes locked/unlocked balances.

## Withdraw

### WITHDRAW-001 — Proportional withdrawal

- Status: todo
- Depends on: APP-003, APP-005, APP-006
- Deliver: share input, percentage controls, multi-asset preview, simulation and direct `withdrawPortfolio` write.
- Accept: remains available while trading is paused and previews every returned pool asset.

### WITHDRAW-002 — Single-asset withdrawal

- Status: todo
- Depends on: WITHDRAW-001
- Deliver: output selector, signed firm quote, native BNB option, countdown and receipt flow.
- Accept: no token approval is requested; paused trading disables the flow; WBNB/native output maps correctly.

## Activity and resilience

### ACTIVITY-001 — Local transaction activity

- Status: todo
- Depends on: SWAP-002, DEPOSIT-001, WITHDRAW-001
- Deliver: non-authoritative local activity records, hashes, explorer links and receipt statuses.
- Accept: pending transactions survive reload and reconcile from chain receipts.

### PWA-001 — Production caching and install assets

- Status: todo
- Depends on: APP-003, APP-005
- Deliver: branded 192/512/maskable icons, install guidance, network-first state fallback and explicit update behavior.
- Accept: Lighthouse PWA checks pass; quotes/RPC/executable calldata are network-only; offline mode is visibly read-only.

### QA-001 — Automated operation coverage

- Status: todo
- Depends on: SWAP-003, DEPOSIT-003, WITHDRAW-002, ACTIVITY-001
- Deliver: MSW component tests, mock wallet/chain tests and Playwright mobile/desktop journeys.
- Accept: core happy paths and specified terminal states run deterministically in CI.

### QA-002 — Wallet/PWA device pass

- Status: todo
- Depends on: PWA-001, QA-001
- Deliver: extension, WalletConnect mobile deep-link and installed-PWA verification on supported desktop, Android and iOS browsers.
- Accept: connect/reconnect, network switching and all operation prompts work without developer tools.

### QA-003 — Accessibility and performance pass

- Status: todo
- Depends on: QA-001
- Deliver: keyboard/focus/live-region review, reduced motion, contrast, touch targets and bundle/performance budget.
- Accept: no serious automated accessibility findings and the agreed production bundle budget is met or explicitly revised.
