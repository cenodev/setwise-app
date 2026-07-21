# Setwise UI design

> Historical single-Set design baseline. Current UI copy uses **Set**; **pool** below refers to the protocol backing a
> Set or the original prototype. Current multi-Set behavior is documented in `docs/architecture/multi-set.md`.

This document is the visual and interaction design specification for the Setwise PWA described in `SETWISE_UI_PROTOTYPE_PLAN.md`. It translates the information architecture, screens, flows, and shared transaction model from that plan into:

- design tokens and a base visual system;
- the global shell and navigation;
- reusable component contracts;
- per-screen layouts and states;
- the transaction state machine expressed visually;
- error, offline, and accessibility treatment.

It is a testnet prototype surface: unaudited contracts, short-lived firm quotes, external wallets only. Design decisions prioritize clarity of transaction state, decimal correctness, and mobile-first physical constraints over decorative polish.

Scope: what to draw and how it behaves. Out of scope: API contracts, ABI definitions, deployment, and milestone sequencing — all covered in the plan.

## 1. Design principles

1. **State over spinners.** Every operation shows a visible state machine. A generic loading spinner is reserved only for genuinely opaque waits (<150 ms) such as modal open. Anything longer must state what is being waited for.
2. **Decimals are sacrosanct.** Inputs, balances, and received amounts are decimal strings. UI never coerces token values through JavaScript `number`. Displays are formatted strings; raw values live in `bigint`.
3. **Mobile-first, desktop-comfortable.** Layouts are authored at a 360–390 px phone width, then scaled to 1024 px+ with a centered column and persistent navigation.
4. **Server sets price, UI sets expectations.** Never expose "slippage tolerance." Show fee, price impact, indicative-price freshness, the exact quoted input/output, and the firm-quote submission deadline. Do not present the API's inventory constraints or packed balance guard as user-configurable price protection.
5. **Recoverable failures.** Every terminal error state has one obvious next action. Errors name what failed and what the user can do about it.
6. **Quiet by default.** No celebratory confetti, no haptics for success of routine operations. Non-routine revenue events are the only candidates for positive reinforcement.
7. **Unaudited, always.** A persistent, non-dismissible risk treatment for testnet-unaudited status is present on every core operation surface.

## 2. Visual system and tokens

Theme is dark by default with a light mode parity pass deferred to a later milestone. Tokens are CSS custom properties sourced from Tailwind theme extension; components consume them by semantic name, never by raw hex.

### 2.1 Color

Semantic roles (both themes must define these):

| Token | Role | Notes |
| --- | --- | --- |
| `--bg-base` | app shell background | darkest surface in dark theme |
| `--bg-surface` | cards, sheet | one step above base |
| `--bg-surface-raised` | nested cards, popovers | two steps above base |
| `--bg-overlay` | modal/sheet scrim | 60% base, taps dismiss disabled during tx |
| `--border-subtle` | hairline dividers | 1 px, low contrast so cards read as surfaces not boxes |
| `--border-strong` | focus-visible ring, input focus | paired with `--focus` |
| `--text-primary` | amounts, headings, critical labels | near-white in dark |
| `--text-secondary` | supporting labels, balances, secondary metadata | lower contrast but AA on surfaces |
| `--text-tertiary` | chain id badges, timestamps, disabled | only for non-essential info |
| `--accent` | primary action background, active nav indicator | brand, single hue |
| `--accent-contrast` | text on `--accent` | must hit 4.5:1 |
| `--success` | confirmation, finalized receipts | green-family |
| `--warning` | paused, lock active, low balance | amber-family |
| `--critical` | revert, reject, expiry, insufficient | red-family |
| `--info` | testnet badge, neutral info | blue-family, distinct from `--accent` |

Usage rules:

- `--accent` is used for exactly one primary action per screen. Secondary actions use `--bg-surface-raised` with `--text-primary`.
- `--critical` is only for terminal/active errors, never for accents or decoration.
- Testnet status uses `--info`, never `--accent`, so it cannot be confused with a primary action.
- Gas reservation warnings, locked funds, and paused trading use `--warning`.
- Color is never the sole carrier of state. State icons and text accompany it.

### 2.2 Typography

PWA bundle budget (~170 KB compressed app shell) favors system font stack over web font with a black/700/600/500/400 weight ladder.

| Token | Size | Weight | Use |
| --- | --- | --- | --- |
| `--font-amount` | 28–32 px | 600 | primary "You pay / You receive", share amount |
| `--font-title` | 18 px | 600 | screen and dialog titles |
| `--font-body` | 15 px | 400 | primary labels, prose |
| `--font-label` | 13 px | 500 | field labels, button labels, tabs |
| `--font-meta` | 12 px | 400 | timestamps, hashes, secondary metadata |
| `--font-mono` | 13 px | 500 | hashes, addresses with compact truncation, calldata preview |

Decimal/amount rendering rules:

- Use tabular-figures (`font-variant-numeric: tabular-nums`) for all amount displays to prevent reflow while typing and while quotes stream.
- Show the token symbol always adjacent to an amount using `--font-meta` weight unless the symbol is the explicit focus of the field.
- Never display a bare `0.x…` of raw atomic units to users.

### 2.3 Spacing, elevation, motion

4 px base grid. Card internal padding 16 px, card-to-card gap 12 px, screen edge padding 16 px on mobile, 24 px on desktop. Modals use 20 px padding with 24 px title-to-body.

Elevation is minimal dark UI: only two levels — level 0 for base cards, level 1 for popovers and bottom sheet only. No drop shadows elsewhere. The scrim shadow on modals is `--bg-overlay` opacity, not a box-shadow.

Motion budget:

- Enter/exit transitions: 120 ms, ease-out. Below 100 ms feels broken; above 200 ms feels laggy on mobile.
- Sheets slide up 180 ms ease-out, fade scrim 120 ms.
- State transitions between transaction stages use text and icon swaps, not animated bars. A determinate progress bar is never used because stage durations are network-dependent and variable.
- `prefers-reduced-motion: reduce` disables all non-essential transitions. The state machine still updates textually; nothing animates.

## 3. Global shell

### 3.1 Layout

Shell is a single flex column: sticky `Header` (h-14), scrollable `<main>` with max-width 480 px on mobile/single-column screens and 960–1024 px for desktop two-column screens, and a sticky mobile `BottomNav` (h-16 safe-area-inset bottom) on mobile (< 768 px) replaced by a sticky `TopNav` on desktop. The main region remains centered at every width.

The shell is the durable surface and is precached as the PWA app shell. Switching between Swap/Deposit/Withdraw/Activity changes only the `<main>` contents.

### 3.2 Header

Left: Setwise mark + wordmark. Right: testnet badge (`--info`), compact account button.

Compact account button content:

- disconnected: "Connect wallet" label on `--accent` background;
- connected: avatar (identicon), truncated address (`0x1234…abcd`), and BNB balance to 4 decimals with symbol;
- on tap open the account sheet (disconnect, open explorer, switch network).

A persistent "testnet — unaudited" line sits below the header in the shell, not per page, so all four screens carry it without screen authors re-declaring it.

### 3.3 Banners

Stacked below the header, in priority order. Each takes full width, has one dismiss/action affordance, and never stacks more than three at once (highest priority wins, others push to a single "N issues" pill if three are active).

1. Wrong network (`--critical`): "Wrong network — BSC Testnet required" + "Switch network" action.
2. Offline (`--warning`): "Offline — pricing and trading are paused" + no action; the shell and last read-only data remain visible.
3. Update available (`--info`): "Update available" + "Reload". Reload is disabled while a transaction is in flight (any stage ≥ approval requested) — see §6.
4. Trading paused (`--warning`): global notice; individual screens disable swaps, both deposit modes, and single-asset withdrawals. Proportional withdrawal remains available (see §6.4).
5. Risk disclosure (always on, not dismissible): "Unaudited testnet prototype. Do not move mainnet funds."

### 3.4 Navigation

Four tabs of equal weight with icon + label. Active state uses `--accent` text and a 4 px top bar on mobile or bottom bar in the desktop top navigation. Tabs never hide based on wallet state because users should know destinations exist before connecting. Wallet/network steps gate the action inside the screen, not the navigation.

Optional pool summary card sits above the screen header (see §5.2) and is collapsible on mobile to preserve vertical space.

## 4. Shared components

These are the primitives enumerated in §5 of the plan, with contracts the screens depend on.

### 4.1 `AssetPicker`

Selects one pool asset. Trigger is a button showing symbol + identicon + a chevron. Opens a `Popover` on desktop, bottom `Sheet` on mobile, listing assets with symbol, name, tokenized-underlying context badge, wallet balance, and verified contract address truncated.

- Tokenized-asset rows display a "tokenized underlying" badge to satisfy `RiskDisclosure` adjacency per `AssetPicker` in the plan.
- Disabled (e.g., trading paused for an asset) rows show inline status text in `--warning`.
- Search filter only when asset count > 5; first cut may be hidden per plan §11 decision 5.

### 4.2 `AmountInput`

- Large mono numeric input, max width self-limiting by font size.
- Right-aligned text, `--font-amount`, tabular-nums.
- "Max" action above-right; disabled when zero balance.
- For native BNB input, "Max" computes balance − reserved gas buffer (configurable; default 0.001 BNB) and shows a footnote "Gas reserved."
- Shows fiat estimate below using API-provided USD value; if no USD value, hide silently — never show `$0.00` placeholder.
- Raw precision protection: input is a decimal string; rejects entries beyond token decimals; lib `lib/decimal` owns all math.
- "Max" is never auto-applied; it sets the value and the input remains editable.

### 4.3 `QuoteSummary`

Folded panel below inputs on mobile, side panel on desktop. Rows:

- You spend / You receive (emphasis, `--font-amount` reduced).
- Effective rate, fair rate (italic `--text-secondary` where available).
- Pool fee, price impact (color: `--warning` only above a meaningful threshold surfaced by the API).
- Exact quoted input and output. Indicative values are labeled "Estimated"; values from an executable firm quote are labeled "Quoted." The API's curve, fair-value, external-liquidity, and packed inventory constraints are not displayed as minimum received / maximum spent.
- Indicative-price freshness uses `validUntil` and reads "Refreshes in 8s." On expiry it refreshes indicatively; while refreshing, the prior estimate remains visible but dimmed and cannot be advanced to review or execution.
- Firm-quote submission time uses `mustSubmitBy`, appears only after the executable response arrives, and reads "Confirm within 8s." Its terminal behavior is defined in §6.3.
- Warnings: market unavailable, paused, tokenized-underlying caveat appear as inline `--warning` rows above the totals, not as toasts.

### 4.4 `ApprovalSteps`

Renders one row per ERC-20 approval required. Each row is its own mini state machine: not needed / pending allowance check / needs approval / approval requested / approval confirming / confirmed / failed. The Setwise primary action (Swap/Deposit/Withdraw) is rendered below these rows and disabled until all approvals confirm. Native input assets skip this section entirely.

Multiple approvals (deposit portfolio) are approached sequentially: only one approve call is active at once per the plan's "Approve deficient tokens one at a time."

### 4.5 `TransactionProgress`

Footer sheet for any in-flight operation. Contents:

- operation title (e.g., "Swapping USDT → SPCXB");
- current stage label with verb-led copy;
- wallet prompt indicator ("Confirm in wallet — approve spend");
- transaction hash (mono, truncated, explorer link, copy button) once submitted;
- receipt status: confirming → success/reverted with explorer link;
- a retry affordance on terminal failure that returns the user to the matching prior stage.

### 4.6 Gate wrappers

- `NetworkGate`: wraps operation bodies. When wrong network, renders the wrong-network notice with switch action instead of the form. Has no spinner fallback.
- `WalletGate`: wraps operation bodies when disconnected, rendering a centered "Connect wallet to swap/deposit/withdraw" card with primary CTA. Sits inside the screen, not the shell, so the user sees the destination.
- `OfflineGate`: wraps any action-producing buttons; when offline, all quote and transaction actions render disabled with an inline "Offline" tooltip. Read-only previews remain available only if the last successful read is still cached; otherwise the field is empty.

### 4.7 `RiskDisclosure`

Inline, non-dismissible block placed directly below the action button on every core operation screen. Contains:

- "Unaudited testnet contracts";
- tokenized-underlying market-availability caveat (where the selected asset is tokenized);
- "Not investment advice."

### 4.8 Error mapping component

A single `ErrorInline` component consuming an `Error` and producing a headline, supporting line, and primary action. Sourced from a lookup table keyed by RFQ codes and common EVM/wallet errors; unknown errors fall through to a generic "Something went wrong — try again" with a copy-debug affordance for testers. Never renders an exception stack to the end user; the stack is emitted to telemetry.

## 5. Screens

All screens share a common layout region: a header strip (title + optional mode tabs), an optional pool summary card, the operation surface, and the persistent risk disclosure at the bottom.

### 5.1 Pool summary card (optional)

Compact card that consumes `/v1/pools/:poolId/state`. Rows: share price, pool TVL, target allocation vs. current allocation (mini bars), trading-paused indicator. Collapsible on mobile via a chevron; expanded by default on desktop. Does not block the core operations; loading skeletons only for its own contents.

### 5.2 Swap (`/swap`)

Layout (mobile, single column):

1. Card "You pay": `AssetPicker` + `AmountInput` + balance line with `Max`.
2. Direction-reversal button centered, overlapping the two cards (vertical swap icon). Disabled when either asset unset or when a quote/tx is in flight.
3. Card "You receive": `AssetPicker` + read-only amount display (the trade output; the first cut is exact-input only).
4. `QuoteSummary`.
5. `ApprovalSteps` (hidden when native input, i.e. BNB→token).
6. Primary action button ("Review swap" → "Approve spend" → "Confirm swap" per §6.2).
7. `RiskDisclosure`.

Desktop: two columns — left col (1,2,3,6,7), right col (4 with sticky position, 5 below it).

States beyond the transaction model:

- pair unsuitable for API minimum/maximum notional: action disabled with inline cause;
- insufficient input balance: action disabled, "Insufficient [SYM] balance";
- insufficient gas (native input where even reserved buffer is negative): `--warning` line, action disabled;
- paused market: action disabled with "Trading paused — try proportional withdraw or wait."

### 5.3 Deposit (`/deposit`)

Mode toggle at the top: "Single" | "Portfolio." Lock-select segment underneath: 0 / 30 / 90 days. When an existing locked deposit is present at the connected address (per `lockedDeposits`), the segment remains visible with 0 days selected and 30/90 days disabled. A notice links to the locked-shares panel and explains that unlocked deposits remain available but another positive-duration lock is not allowed until the existing shares are claimed.

Single asset mode:

- single `AssetPicker` + `AmountInput`;
- "Estimated SETWISE shares" line (formatted decimal string);
- estimated deposit USD value line.

Portfolio mode:

- list of all pool assets in contract order with target weight, `AmountInput` per row, current wallet balance;
- a "Fill by target weights" helper that distributes a user-entered total USD value across the assets to target weights using decimal math; only fills up to per-asset wallet balances and reports any shortfall as `--warning` per asset;
- an "Estimated SETWISE shares" summary line;
- a list of approvals required, each token row corresponding to a nonzero input amount.

Shared:

- `ApprovalSteps` for every nonzero ERC-20 input;
- primary action: "Review deposit" → approve(s) → "Confirm deposit";
- below the action, the locked-shares panel:

Locked-shares panel:

- shown only when `lockedDeposits(address)` is nonzero;
- rows: amount of SETWISE locked, unlock time (formatted local + relative "in 27 days"), and status: locked / claimable;
- `claimShares()` action enabled only when `canClaimShares(address)` is true; otherwise disabled with explainer "Unlocks at [date].";
- no claim of extra yield unless the API explicitly returns one. Avoid any "earn more" framing.

### 5.4 Withdraw (`/withdraw`)

Mode toggle: "Proportional" | "Single asset."

- Pool-share amount input with `--font-amount` style; balance below; percentage shortcuts 25 / 50 / 75 / Max as a row of secondary buttons (no segmented control, so users can also type).
- Proportional mode: renders a read-only breakdown of every pool asset received, each with its formatted token amount, symbol, and USD estimate; atomic/raw units are never displayed to users. A note explains that this path remains available when trading is paused.
- Single-asset mode: `AssetPicker` for output asset; native BNB toggle enabled when output is WBNB — a `--info` note clarifies "Receive native BNB (unwrapped from WBNB)."

States:

- insufficient unlocked SETWISE balance: action disabled with inline cause. Locked SETWISE is not spendable; the locked-shares panel (in Deposit) is referenced via a link, not inline, to avoid scope creep on the withdraw screen.
- single-asset mode while trading paused: action disabled with "Trading paused — switch to proportional.";
- both modes: no quote if offline or wrong network per gates.

Primary action labels: proportional "Confirm withdrawal"; single-asset "Review withdrawal" → (no ERC-20 approval — burning shares) → "Confirm withdrawal."

### 5.5 Activity (`/activity`)

List of locally-stored transaction metadata (per plan, not authoritative history). Each item is a row card:

- operation icon (swap/deposit/withdraw/claim);
- headline (operation + assets);
- amount emphasis where relevant;
- status pill: pending, confirming, success, reverted, rejected, expired;
- timestamp (relative now, absolute on hover/tap);
- explorer link, copy-hash.

Top of screen: a concise disclaimer "Local record only — not a complete account history." No "clear history" affordance in the prototype — we want to keep the audit trail for testers.

Pending items restored on reload: the list reconciles every pending/confirming row against the chain on launch and updates status as receipts land. Items that the chain reports as dropped stay marked pending until the user taps "Reconcile" (a quiet button in the meta row) rather than auto-marking them failed.

## 6. Transaction state machine — visual treatment

The shared machine from plan §5 is the center of the UI. Each stage maps to: a primary-action label, an inline status line, and a wallet/explorer affordance.

### 6.1 Stage table

| Stage | Primary action label | Inline status line | Affordance |
| --- | --- | --- | --- |
| editing | "Review swap/deposit/withdraw" (disabled if invalid) | none | — |
| indicative pricing | "Getting price…" (disabled, not spinner) | "Fetching indicative price" | cancel via input change |
| review | "Approve spend" or "Confirm [op]" | "Review the details" | review sheet |
| allowance check | (no button press) | "Checking allowance…" | — |
| approval requested | "Waiting on wallet…" | "Approve spend in your wallet" | wallet prompt |
| approval confirming | "Confirming approval" (disabled) | tx hash + explorer link | `TransactionProgress` |
| firm quote requested | "Getting executable quote…" (disabled) | "Requesting signed executable quote" | — |
| wallet confirmation | "Waiting on wallet…" | "Confirm transaction in your wallet — expires in Ns" | wallet prompt + firm countdown |
| submitted | "Submitted" (disabled) | tx hash + "Waiting for receipt" | explorer link |
| confirming | "Confirming" (disabled) | tx hash + "Waiting for receipt" | explorer link |
| success | "Done" + secondary "New [op]" | receipt summary, explorer link | link |

### 6.2 Terminal states

| Terminal | Inline | Restore action |
| --- | --- | --- |
| rejected (wallet) | "Rejected in wallet" | "Try again" returns to review |
| expired (firm quote) | "Quote expired" | "Refresh quote" returns to indicative pricing |
| reverted | "Transaction reverted on chain" | "Try again" with explorer link to revert reason |
| disconnected | "Wallet disconnected" | "Connect wallet" via `WalletGate` |
| wrong network | shown via banner + `NetworkGate` | "Switch network" |
| offline | shown via banner + `OfflineGate` | auto-resume on reconnect |
| insufficient balance | "Insufficient [SYM] balance" | editing, action disabled |
| insufficient gas | "Insufficient BNB for gas" | editing, action disabled |
| market unavailable | "Market unavailable for [SYM]" | "Choose another asset" |
| trading paused | "Trading paused" | "Switch to proportional withdraw" where applicable |
| quote/API error | mapped message via `ErrorInline` | "Retry" returns to latest valid prior stage |

### 6.3 Firm quote countdown

Indicative-price freshness and firm-quote execution are separate timers. The indicative timer comes from `validUntil`, may refresh automatically, and never authorizes a transaction. The ~10-second firm window comes from `mustSubmitBy` and is the most important execution timer in the UI. Treatment:

- As soon as the firm quote returns, a dedicated countdown appears inside `QuoteSummary` and as a footer pill if the sheet is scrolled out of view. It must always be visible.
- The countdown uses a numeric "Expires in 8s" (not just a bar) in `--font-mono`, paired with a 24 px progress ring stroke in `--accent` transitioning to `--warning` in the last 3 seconds.
- Immediately on countdown end, the action disables, the panel shifts to grey, and the only local path is "Refresh quote" — which re-enters indicative pricing before requesting a new firm quote. Do not initiate a new wallet request with stale calldata. A wallet prompt already handed to an external wallet cannot be revoked by the PWA; if it resolves after the deadline, reconcile any returned transaction hash normally and explain that the contract may revert it as expired.

### 6.4 Paused trading treatment

- Swap, single-asset and portfolio deposit pricing, and single-asset withdrawal all disable and show the `--warning` paused line.
- Proportional withdraw remains enabled because the contract permits it while paused (per plan).
- The pause state is also surfaced in the pool summary card.
- If a quote is in flight when pause flips, the in-flight request is cancelled and the action disables.

## 7. Wallet and account surfaces

### 7.1 Connect

First-run on any screen where an operation requires an account: the screen body (inside `WalletGate`) shows a centered card with "Connect wallet" on `--accent`, plus a one-line explainer "External wallet only — never your seed phrase." Account button in the header is the persistent entry point after first interaction.

### 7.2 Account sheet

Bottom sheet on mobile, popover anchored to the account button on desktop. Sections:

- avatar + full address + copy button + explorer link;
- BNB balance with "Buy" removed (no on-ramp in prototype);
- "Switch network" (always to BSC Testnet; shown active if already on testnet);
- "Disconnect" in `--critical` text;
- session/connector metadata (which wallet) below in `--text-tertiary`.

No seed-phrase prompts ever. No embedded wallet UI in the first cut.

### 7.3 Wrong network

Both the header account button and a shell banner (§3.3) surface wrong-network. The shell banner's "Switch network" calls the network switch; inside each screen, `NetworkGate` renders the same call-to-action in place of the form so the user does not have to scroll up to find the banner.

## 8. PWA-specific surfaces

Aligned with plan §8:

- **Install affordance:** Android/Chromium `beforeinstallprompt` captured at app boot and surfaced as a header pill "Install Setwise" for the session. iOS Safari renders a static guidance card (share → Add to Home Screen) once per install state; the guidance is dismissible and not re-shown.
- **Update prompt:** a `--info` banner "Update available — reload." If a transaction is in any stage ≥ approval requested, the reload button is disabled with a tooltip "Reload disabled during a transaction." After the terminal stage, the banner re-enables. Never auto-reload.
- **Offline shell:** the shell and static `TokenAsset` metadata use stale-while-revalidate. Read-only `/pools/:poolId/state` uses network-first with a short timeout and may fall back to the last response only when it is visibly labeled stale. All quote POSTs, firm quotes, RPC calls/writes, and wallet requests are network-only. The UI disables pricing inputs and transaction actions when offline, and review/submission requires a fresh API/RPC read even if the browser still reports that it is online; stale read-only cards may remain visible.
- **Standalone launch:** on cold launch offline, the app boots into the shell with whichever tab persisted (or swap by default) and shows the offline banner; no empty-state collapse.

## 9. Empty, loading, and skeleton states

- Empty list (Activity on first run): centered muted illustration placeholder (not emoji) + "No activity yet. Try a swap on testnet." Plus a direct link to `/swap`.
- Skeletons: only for blocks truly being awaited on first paint — pool summary card and, optionally, account balance on first connect. Skeletons use a neutral shimmer that is suppressed under `prefers-reduced-motion`.
- Quote loading: never blocker skeletons. The `QuoteSummary` keeps the previous indicative estimate visible and dims it with an inline "Refreshing…" label until the new quote lands; advancing to review or execution is disabled during the refresh. A complete blank indicates no prior quote. An expired firm quote is never retained as the active estimate or executable transaction.
- Approval check: a one-line inline "Checking allowance…" with no skeleton; the section remains mountable while awaiting.

## 10. Accessibility

- Keyboard: every interactive element reachable, visible focus ring using `--border-strong` over a 2 px transparent outline so it survives dark surfaces.
- Dialogs (Radix): focus trapping on, restore focus on close, ESC closes only when no transaction stage is in flight.
- Live regions: the inline status line of the state machine is `aria-live="polite"`. Terminal errors use `aria-live="assertive"` only for the headline; the supporting line remains polite.
- Roles: amount displays are `aria-label`'d "[amount] [symbol]" rather than read as fragmented runs. Explorer links expose "View transaction on [explorer name]" as accessible names.
- Contrast: all text/non-text pairs hit 4.5:1 (AA) against the actual surface they render on, accounting for low-contrast pill backgrounds.
- Motion: `prefers-reduced-motion: reduce` removes shimmer, slide, and progress ring; replaces countdown ring with the numeric text only.
- Touch targets: minimum 44 × 44 px hit area on all actionable controls, including the small percentage-shortcut buttons on Withdraw.
- No color-only state: tokens (`--success`, `--critical`) are always paired with an icon and a text label.

## 11. Build notes for designers and engineers

- Theme tokens live in `tailwind.config` theme extension as CSS custom properties so both Tailwind utilities and raw CSS can reference them.
- Component composition prefers Radix primitives (Dialog, Popover, Tabs, Tooltip) wrapped once in `src/components/` so screens never reach into Radix directly — this lets us swap primitives or restyle without touching screens.
- Decimal and bigint formatting helpers (`src/lib/decimal`, `src/lib/format`) are the single entry point for rendering amounts; components never compute displays inline.
- Error mapping is one table in `src/lib/errors` consumed by `ErrorInline`; new API codes are added as data, not as new components.
- Screen authors depend on component contracts (props and emitted states), not on their internals — any stage copy change happens in the state-machine mapping, not in screens.

## 12. Out of scope for this design pass

- Exact output mode (swap), per plan §6.
- Email/social embedded wallets (second-prototype decision checkpoint).
- On-ramp / off-ramp / buy BNB surfaces.
- Light theme pixel-perfect parity (deferred).
- Production activity history indexed from contract events.
- Any communications surface, notification center, or push integration.
- Marketing/landing page — the PWA boots directly into `/swap`.

## 13. Open design questions

1. Whether the pool summary card should be opt-in per screen or globally present (current design: global, collapsible on mobile).
2. Exact visual treatment of the locked-shares panel when the wallet also has unlocked shares — current design treats them on separate screens (`/deposit`) to limit scope. This may need revisiting after withdraw-mode testing.
3. Whether the wrong-network action should be a single global button call or one per screen via `NetworkGate` — current design uses both (banner global, gate per screen).
4. Final accent hue and logo from brand inputs (plan §11 decision 4). Tokens are parameterized so the swap is a one-line change.
5. Whether to render the unfilled fiat estimate as blank or as "—" placeholder. Current design: blank, to avoid implying a zero value.
