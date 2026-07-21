# Setwise UI prototype plan

> Historical single-Set planning document. The current product supports multiple user-facing **Sets**, each backed by
> an internal RFQ/on-chain **pool**. See `docs/architecture/multi-set.md` for the current route, cache, and terminology
> contract; references to pool below describe protocol internals or the original prototype scope.

## 1. Prototype outcome

Build an installable, mobile-first React PWA for the existing Setwise BSC Testnet pool. A user should be able to:

1. connect an external EVM wallet and switch to BSC Testnet;
2. swap one supported pool asset for another;
3. deposit one asset or a portfolio of assets and receive Setwise pool shares;
4. withdraw pool shares proportionally or into one selected asset;
5. see every approval, signature, submission, confirmation, expiry, and error state clearly.

The prototype should use the deployed pool and current RFQ API rather than mocked business logic. It is a testnet prototype, not a production launch: the contracts are unaudited and the RFQ signer still has production-hardening work listed in the repository.

## 2. Recommended stack

| Area | Choice | Reason |
| --- | --- | --- |
| App | React + TypeScript + Vite | Small client-only PWA, fast iteration, no SSR requirement |
| PWA | `vite-plugin-pwa` with Workbox | Manifest, service-worker generation, update prompt, and offline shell |
| Wallet UI | Reown AppKit | Mobile-friendly wallet modal, WalletConnect and EIP-6963 support out of the box |
| EVM state | wagmi + viem | Typed account, chain, balance, allowance, simulation, write, and receipt primitives |
| Server state | TanStack Query | Polling, cancellation, retries, and explicit quote freshness |
| Routing | React Router | Simple client routes and deep-linkable operation screens |
| Forms | React Hook Form + Zod | Decimal-input validation and API boundary validation |
| UI | Tailwind CSS + Radix primitives | Fast responsive composition with accessible dialogs, tabs, and popovers |
| Unit/component tests | Vitest + React Testing Library + MSW | Deterministic wallet and RFQ states |
| Browser tests | Playwright | Mobile/desktop layouts, service worker, and full transaction-state flows |

Create the app in this `setwise-app/` package. Do not put contract ABIs or chain addresses into hand-maintained UI constants when they can come from existing artifacts or pool discovery.

## 3. Wallet research and decision

### Recommendation: Reown AppKit + wagmi + viem

Use AppKit as the connection/account modal and wagmi/viem for all reads and writes.

Why it fits Setwise:

- AppKit supports EVM chains including BNB Smart Chain and uses viem chain definitions.
- WalletConnect and EIP-6963 injected-wallet discovery are provided by default, covering the important mobile-PWA and browser-extension paths without building a connector modal.
- The app can pass the RFQ API's ready-to-submit `to`, `data`, and `value` directly through wagmi/viem and then wait for the receipt.
- AppKit can later add email/social wallets, but the first prototype can stay external-wallet-only.
- It is less product-specific than an embedded-wallet platform while still leaving a path to simpler retail onboarding.

Prototype configuration:

- default and only enabled chain: BSC Testnet (`97`);
- external wallets enabled through WalletConnect and EIP-6963;
- disable AppKit email/social login initially;
- disable AppKit's built-in swap and on-ramp features so they do not compete with Setwise flows;
- set verified production-origin metadata before external testing;
- never request a seed phrase or private key and never store wallet credentials;
- persist only the connector/session metadata supported by the wallet SDK.

### Alternatives considered

| Option | Strength | Why not the prototype default |
| --- | --- | --- |
| RainbowKit + wagmi | Excellent open-source React wallet modal with strong customization | Very good fallback, but AppKit offers a more direct mobile/WalletConnect path and optional email onboarding in the same integration |
| Privy + wagmi | Best when email/social auth and embedded wallets are core requirements | Adds account, custody, recovery, security, and vendor decisions that are premature for this external-wallet testnet prototype |
| wagmi connectors only | Smallest dependency surface and maximum control | Requires Setwise to build and maintain wallet discovery, QR/deep-link, account, and network UX itself |

Decision checkpoint after usability testing: if non-crypto users consistently fail before funding/connecting a wallet, run a second prototype using embedded email wallets. Privy is the strongest alternative to evaluate at that point; do not combine multiple wallet modal providers in one prototype.

## 4. Information architecture

Mobile bottom navigation and matching desktop navigation:

- **Swap** — `/swap`
- **Deposit** — `/deposit`
- **Withdraw** — `/withdraw`
- **Activity** — `/activity`

Global shell:

- Setwise mark and testnet badge;
- compact account button showing avatar/address and BNB balance;
- wrong-network banner with a single switch-network action;
- offline banner;
- install action where the browser supports it, plus iOS “Add to Home Screen” guidance;
- persistent warning that the prototype uses unaudited testnet contracts.

An optional pool summary card can show pool share price/value, TVL, target allocation, current allocation, and trading-paused state from `/v1/pools/:poolId/state`. It should not block the three core operations.

## 5. Shared transaction model

Every operation uses a visible state machine rather than a generic loading spinner:

```text
editing -> indicative pricing -> review -> allowance check
        -> approval requested -> approval confirming
        -> firm quote requested -> wallet confirmation
        -> submitted -> confirming -> success
```

Alternate terminal states: rejected, expired, reverted, disconnected, wrong network, offline, insufficient balance, insufficient gas, market unavailable, trading paused, and quote/API error.

Important execution rule: the API's executable quote lifetime is about 10 seconds. Complete and confirm all required token approvals before requesting a firm quote. Once a firm quote arrives, show its countdown and immediately prompt the wallet with the API-provided transaction. If it expires before submission, discard it and fetch a new one; never reuse stale calldata.

Common UI components:

- `AssetPicker` with symbol, name, tokenized-underlying context, wallet balance, and verified contract address;
- `AmountInput` using decimal strings, `Max`, fiat estimate, and raw precision protection;
- `QuoteSummary` with received/spent amounts, fee, effective rate, price impact, expiry, and warnings;
- `ApprovalSteps` showing one or many ERC-20 approvals separately from the Setwise action;
- `TransactionProgress` with wallet prompt, hash, explorer link, receipt status, and retry path;
- `RiskDisclosure` for tokenized assets, market availability, eligibility, and testnet status;
- `NetworkGate`, `WalletGate`, and `OfflineGate` wrappers;
- error mapping from RFQ codes and common EVM/wallet errors into user-language actions.

Do not label server-side price protection as user-configurable “slippage.” The Setwise RFQ and packed balance guard determine whether the fixed quoted transaction can execute; they are not user-facing minimum-received or maximum-spent fields. Display the fee, price impact, indicative freshness, exact quoted input/output, and firm submission deadline returned by the API.

## 6. Screen and flow specifications

### Swap

Primary card:

- “You pay” asset and amount;
- direction-reversal control;
- “You receive” asset and amount;
- exact-input mode for the first vertical slice;
- wallet balance and `Max` handling that reserves BNB for gas when the native token is input;
- quote details: USD values, effective/fair rate, price impact, pool fee, venue status, and expiry.

Flow:

1. Load assets from pool discovery and balances from chain.
2. Debounce `POST /v1/quotes/swaps` while editing; cancel obsolete requests.
3. Validate pair, minimum/maximum notional, balance, market freshness, and paused state.
4. Check allowance for ERC-20 input against the pool. Native BNB input needs no approval.
5. If required, request an exact-amount approval and wait for its receipt.
6. Request `POST /v1/firm-quotes/swaps` with connected address as both `payer` and default `recipient`, plus native-input/output flags where applicable.
7. Validate response chain, sender, pool address, deadline, and value; submit returned calldata.
8. Wait for the receipt, invalidate balances/pool state, and add the result to local activity.

Keep exact-output mode behind a later milestone. Its changing required input makes exact-amount approval and short-lived quotes more complicated.

### Deposit

Modes:

- **Single asset:** select one asset and enter one amount; API uses `depositSingleAsset`.
- **Portfolio:** show all pool assets in contract order, target weights, editable amounts, and a “fill by target weights” helper; API uses `depositPortfolio`.

Shared controls:

- lock choice from API configuration (`0`, `30`, or `90` days on the current test pool);
- clear distinction between immediately available shares and locked shares;
- estimated SETWISE shares received and deposit value;
- list of required approvals and their individual status.

Flow:

1. Price with `POST /v1/quotes/deposits`.
2. Check balances and every required allowance using the indicative input amounts.
3. Approve deficient tokens one at a time and confirm each receipt. Do not request the firm quote until all pass.
4. Request `POST /v1/firm-quotes/deposits` with the connected address as `investor` and an idempotency key.
5. Submit the returned transaction before expiry and refresh shares, assets, locked-deposit state, and pool state.

Add a locked-shares panel when `lockedDeposits(address)` is nonzero. It shows amount, unlock time, and a `claimShares()` action once `canClaimShares(address)` is true. Disable a new locked deposit while an existing locked deposit is present because the current contract permits only one per address.

Do not claim that longer locks earn extra yield unless the quote/API begins returning an explicit economic benefit.

### Withdraw

Modes:

- **Proportional:** burn SETWISE shares and receive every pool asset; direct `withdrawPortfolio(shares)` call with no firm quote.
- **Single asset:** burn SETWISE shares and receive one chosen asset; signed RFQ flow.

Primary card:

- pool-share amount, balance, percentage shortcuts (25/50/75/Max);
- mode selector;
- proportional asset breakdown or single selected output;
- native BNB toggle when output asset is WBNB;
- USD estimate, price impact where relevant, and market warnings.

Flow:

1. Preview with `POST /v1/quotes/withdrawals`.
2. Confirm sufficient unlocked SETWISE balance.
3. For proportional mode, simulate and submit `withdrawPortfolio` directly.
4. For single-asset mode, request `POST /v1/firm-quotes/withdrawals` with connected address as `investor`, then submit returned calldata before expiry.
5. Refresh balances and pool state after receipt.

Proportional withdrawal should remain available when trading is paused if the contract/API permits it; single-asset withdrawal must respect the trading pause.

### Activity

For the prototype, store only non-sensitive transaction metadata locally:

- operation, assets/amounts, chain ID, transaction hash, timestamp, and final status;
- pending items restored after reload and reconciled from the chain;
- explorer links and a concise receipt/revert result.

Do not imply this is a complete account history. A production activity feed should be indexed from contract events.

## 7. Data and integration architecture

Suggested package shape:

```text
setwise-app/
  public/                 icons and static PWA assets
  src/
    app/                  providers, router, shell
    config/               BSC Testnet, feature flags, environment parsing
    features/
      wallet/
      swap/
      deposit/
      withdraw/
      activity/
      pwa/
    components/           shared UI primitives
    data/
      rfq/                typed client, Zod response schemas, query keys
      chain/              ABI exports, reads, allowance and receipt helpers
    lib/                  decimal, address, error and telemetry helpers
    test/                 mocks, fixtures, mock connector
```

Data ownership:

- RFQ API owns pool discovery, price estimates, firm authorization, executable calldata, and quote expiry.
- The chain owns balances, allowances, share locks, transaction simulation/receipts, and consumed quote state.
- The wallet owns account, connector, signing, network selection, and transaction approval.
- The UI owns only form drafts, display preferences, transaction progress, and non-authoritative local activity.

Use `bigint` for atomic chain amounts and decimal strings for inputs/API payloads. Never pass token values through JavaScript `number`.

Before sending an API-built transaction, verify:

- connected chain equals response `chainId`;
- connected address equals response required sender;
- `to` equals the discovered pool proxy;
- quote is not expired;
- value is zero except for native input;
- current allowance and balance still satisfy requirements.

## 8. PWA behavior

- Manifest: `name`, `short_name`, `start_url`, `scope`, `display: standalone`, theme/background colors, 192px and 512px icons, and maskable icon.
- Serve over HTTPS outside localhost.
- Precache only the versioned app shell, fonts, icons, and offline page.
- Use stale-while-revalidate for static token metadata and pool discovery.
- Use network-first with a short timeout for read-only pool state.
- Use network-only for all quote POSTs, firm quotes, RPC calls, wallet requests, and transaction data. Never serve cached executable quotes.
- When offline, keep the shell and last clearly labeled read-only data visible but disable pricing and all transaction actions.
- Show an explicit “new version available” prompt; do not reload during an approval or transaction flow.
- Provide an Android/Chromium install prompt when available and separate iOS share-menu guidance because iOS has no programmable browser install prompt.

## 9. Delivery milestones

### Milestone 0 — contract and API fixture (0.5–1 day)

- Confirm RFQ API base URL, CORS, signer availability, faucet/funding route, deployed pool proxy, explorer URL, and RPC reliability.
- Export the minimal pool/ERC-20 ABI from the contract artifact.
- Capture successful indicative and firm responses as redacted test fixtures.

Exit: one manual swap can be quoted and executed on BSC Testnet with a known wallet.

### Milestone 1 — shell, design system, PWA, wallet (1.5–2 days)

- Scaffold Vite React TypeScript app and routing.
- Add responsive shell, tokens, testnet/risk treatment, install/offline/update UI.
- Integrate AppKit/wagmi/viem and BSC Testnet switching.
- Add account, balances, explorer links, and mock wallet test harness.

Exit: installable PWA connects/reconnects on desktop and mobile, handles wrong network, and survives reload.

### Milestone 2 — swap vertical slice (2–3 days)

- Asset selector, exact-input form, indicative quote, review, allowance, firm quote countdown, submission, receipt, and errors.
- Test ERC-20→ERC-20, BNB→asset, asset→BNB, reject, expiry, revert, and stale quote.

Exit: a funded tester can complete all three swap paths without developer tools.

### Milestone 3 — deposits (2–3 days)

- Single-asset and portfolio forms, target-weight helper, lock selection, multiple approval steps, receipt state.
- Locked-share display and claim action.

Exit: tester can deposit in both modes, understand locks, and claim an unlocked position.

### Milestone 4 — withdrawals and activity (2–3 days)

- Proportional and single-asset previews/execution, percentage controls, native output.
- Local activity/reconciliation and final balance refresh.

Exit: tester can withdraw in both modes and recover pending status after reload.

### Milestone 5 — hardening and usability pass (1.5–2 days)

- Mobile wallet deep-link tests, installed-PWA tests, accessibility, empty/error/offline states, and responsive polish.
- Performance budget and bundle review.
- Five-task moderated test: connect, swap, single deposit, portfolio deposit, proportional/single withdrawal.

Exit: all acceptance scenarios pass on desktop Chrome, Android Chrome with a mobile wallet, and current iOS Safari/Home Screen with a mobile wallet.

Estimated prototype: 8–12 focused engineering days after Milestone 0 dependencies are healthy.

## 10. Acceptance criteria

- App installs and launches standalone with correct icon/theme; an offline launch shows a safe read-only state.
- User can connect, disconnect, reconnect, change account, and switch to BSC Testnet.
- No transaction can be submitted from the wrong account, wrong chain, expired quote, or insufficient allowance/balance.
- All three swap transport modes work: token→token, BNB→token, and token→BNB.
- Single and portfolio deposits work, including more than one approval and 0/30/90-day lock choices.
- Proportional and single-asset withdrawals work, including WBNB/native BNB output selection.
- User rejection, quote expiry, API failure, RPC failure, on-chain revert, and trading pause have distinct recovery actions.
- Reloading during a submitted transaction restores and reconciles its status.
- Keyboard navigation, visible focus, dialog focus trapping, screen-reader labels, contrast, and reduced motion pass an accessibility review.
- No executable quote or RPC response capable of authorizing a transaction is served from the service-worker cache.

## 11. Decisions needed before implementation

1. Public URL for the RFQ API and whether its CORS policy already allows the UI origin.
2. How testers obtain BSC Testnet BNB, mock USDT, and mock bStocks. A visible faucet/testing flow is needed if distribution is not already automated.
3. Whether the first usability cohort is crypto-native. If not, schedule the embedded-wallet decision checkpoint before polishing the external-wallet flow.
4. Visual identity inputs: logo, colors, type, tone, and required financial/risk disclosures.
5. Whether to expose all current pool assets or a smaller curated set for the first usability test.

## 12. Research sources

- [Reown AppKit React installation](https://docs.reown.com/appkit/react/core/installation)
- [Reown AppKit supported chains](https://docs.reown.com/appkit/networks/supported-chains)
- [Reown default wallet connectors](https://docs.reown.com/appkit/javascript/core/custom-connectors)
- [Reown email and social wallets](https://docs.reown.com/appkit/javascript/core/socials)
- [RainbowKit installation](https://rainbowkit.com/en-US/docs/installation)
- [Privy integration with wagmi](https://docs.privy.io/wallets/connectors/ethereum/integrations/wagmi)
- [MDN PWA installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [Vite PWA service-worker registration](https://vite-pwa-org.netlify.app/guide/register-service-worker)
