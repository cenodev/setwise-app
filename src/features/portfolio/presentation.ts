import { formatTokenAmount } from "../../lib/decimal";
import {
  calculateOwnershipPercentage,
  decimalRatio,
  formatDecimalRatio,
  type Calculation,
  type DecimalRatio,
} from "../pool-analytics/model";
import {
  calculateSetSharePercentage,
  calculateUserSetLiquidity,
  type PortfolioAggregate,
} from "./model";
import type { PortfolioSetView } from "./usePortfolio";

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function ratio(numerator: bigint, denominator = 1n): DecimalRatio {
  if (denominator === 0n) throw new Error("A decimal ratio cannot have a zero denominator");
  if (numerator === 0n) return { numerator: 0n, denominator: 1n };
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function add(left: DecimalRatio, right: DecimalRatio): DecimalRatio {
  return ratio(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function sum(values: readonly DecimalRatio[]): DecimalRatio {
  return values.reduce(add, ratio(0n));
}

export function formatUsd(value: DecimalRatio): string {
  const formatted = formatDecimalRatio(value, 2);
  const [integer, fraction] = formatted.split(".");
  return `$${(integer ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction ?? "00"}`;
}

export function formatCalculation(
  value: Calculation,
  formatter: (ratio: DecimalRatio) => string = formatUsd,
): string {
  return value.status === "available" ? formatter(value.value) : "Unavailable";
}

export function formatAggregateValue(
  aggregate: PortfolioAggregate,
  disconnectedLabel = "Connect wallet",
): string {
  if (aggregate.status === "disconnected") return disconnectedLabel;
  if ("value" in aggregate) return formatUsd(aggregate.value);
  return "Unavailable";
}

export function aggregateStatusLabel(status: PortfolioAggregate["status"]): string {
  switch (status) {
    case "ready":
      return "Live";
    case "partial":
      return "Partial";
    case "stale":
      return "Stale";
    case "zero-balance":
      return "Zero balance";
    case "disconnected":
      return "Disconnected";
    case "unsupported-chain":
      return "Unsupported chain";
    case "error":
      return "Unavailable";
  }
}

export function unlockStatus(locked: bigint, lockedUntil: bigint, canClaim: boolean): string {
  if (locked === 0n) return "No locked shares";
  if (canClaim) return "Claimable now";
  if (lockedUntil === 0n) return "Locked";
  return `Unlocks ${new Date(Number(lockedUntil) * 1_000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

export function readableSetState(set: PortfolioSetView) {
  return set.snapshot.status === "ready" || set.snapshot.status === "stale"
    ? set.snapshot.state
    : undefined;
}

export function setPositionStatus(set: PortfolioSetView): string {
  if (set.snapshot.status === "unsupported-chain") return "Unsupported chain";
  if (set.snapshot.status === "error") return "Public data unavailable";
  if (set.wallet?.status === "error") return "Wallet data unavailable";
  if (set.snapshot.status === "stale" || set.wallet?.status === "stale") return "Stale snapshot";
  if (set.wallet?.status === "zero-balance") return "Zero balance";
  if (set.wallet?.status === "disconnected") return "Wallet disconnected";
  if (set.snapshot.status === "ready" && set.snapshot.state.trading.paused) return "Paused";
  return "Ready";
}

export function setPublicLiquidity(set: PortfolioSetView): string {
  const state = readableSetState(set);
  return state ? formatUsd(decimalRatio(state.totalValueUsd)) : "Unavailable";
}

/** True only when a wallet read succeeded and the account holds no attributed shares. Unknown states stay visible. */
export function setHasNoUserLiquidity(set: PortfolioSetView): boolean {
  return !!set.wallet
    && "position" in set.wallet
    && set.wallet.position.shares.totalAttributed === 0n;
}

export function setUserLiquidity(set: PortfolioSetView): string {
  const state = readableSetState(set);
  const { wallet } = set;
  if (!wallet) return "Unavailable";
  if (wallet.status === "disconnected") return "Connect wallet";
  if (!("position" in wallet) || !state) return "Unavailable";
  return formatCalculation(calculateUserSetLiquidity({
    attributedSharesAtomic: wallet.position.shares.totalAttributed,
    state,
  }));
}

export function setOwnership(set: PortfolioSetView): string {
  const state = readableSetState(set);
  const { wallet } = set;
  if (!wallet || !("position" in wallet) || !state) return "Unavailable";
  return formatCalculation(
    calculateOwnershipPercentage(wallet.position.shares.totalAttributed, state.totalSupply),
    (value) => `${formatDecimalRatio(value, 4)}%`,
  );
}

export function setShareOfProtocol(set: PortfolioSetView, total: PortfolioAggregate): string {
  if (!("value" in total)) return "Unavailable";
  const state = readableSetState(set);
  if (!state) return "Unavailable";
  return formatCalculation(
    calculateSetSharePercentage(decimalRatio(state.totalValueUsd), total.value),
    (value) => `${formatDecimalRatio(value, 2)}%`,
  );
}

export function setLpShares(set: PortfolioSetView): string {
  const { snapshot, wallet } = set;
  if (!wallet || !("position" in wallet)) return "Unavailable";
  if (snapshot.status !== "ready" && snapshot.status !== "stale") return "Unavailable";
  const amount = formatTokenAmount(
    wallet.position.shares.totalAttributed,
    snapshot.pool.lpToken.decimals,
  );
  return `${amount} ${snapshot.pool.lpToken.symbol}`;
}

export function setLockClaimStatus(set: PortfolioSetView): string {
  const { wallet } = set;
  if (!wallet) return "Unavailable";
  if (wallet.status === "disconnected") return "Connect wallet";
  if (!("position" in wallet)) return "Unavailable";
  return unlockStatus(
    wallet.position.shares.locked,
    wallet.position.shares.lockedUntil,
    wallet.position.shares.canClaim,
  );
}

export type PortfolioPublicSummary = Readonly<{
  activeSets: number;
  pausedSets: number;
  constituentCount: number;
  coveredSets: number;
  totalSets: number;
}>;

export type PortfolioWalletSummaryStats = Readonly<{
  lockedPartial: boolean;
  lockedValue: DecimalRatio | undefined;
  ownedSets: number;
  unlockedPartial: boolean;
  unlockedValue: DecimalRatio | undefined;
}>;

export function derivePublicSummary(sets: readonly PortfolioSetView[]): PortfolioPublicSummary {
  let activeSets = 0;
  let pausedSets = 0;
  let coveredSets = 0;
  const constituents = new Set<string>();

  for (const set of sets) {
    const { snapshot } = set;
    if (snapshot.status !== "ready" && snapshot.status !== "stale") continue;
    coveredSets += 1;
    if (snapshot.state.trading.paused) pausedSets += 1;
    else activeSets += 1;
    for (const asset of snapshot.definition.pool.assets) {
      constituents.add(`${snapshot.definition.chainId}:${asset.address.toLowerCase()}`);
    }
  }

  return {
    activeSets,
    pausedSets,
    constituentCount: constituents.size,
    coveredSets,
    totalSets: sets.length,
  };
}

export function deriveWalletSummary(sets: readonly PortfolioSetView[]): PortfolioWalletSummaryStats {
  let ownedSets = 0;
  const unlockedValues: DecimalRatio[] = [];
  const lockedValues: DecimalRatio[] = [];
  let unlockedPartial = false;
  let lockedPartial = false;

  for (const set of sets) {
    const state = readableSetState(set);
    const { wallet } = set;
    if (!wallet || wallet.status === "disconnected") continue;
    if (!("position" in wallet) || !state) {
      if (wallet.status === "error" || wallet.status === "unsupported-chain") {
        unlockedPartial = true;
        lockedPartial = true;
      }
      continue;
    }

    const { shares } = wallet.position;
    if (shares.totalAttributed > 0n) ownedSets += 1;

    const unlocked = calculateUserSetLiquidity({
      attributedSharesAtomic: shares.unlocked,
      state,
    });
    const locked = calculateUserSetLiquidity({
      attributedSharesAtomic: shares.locked,
      state,
    });

    if (unlocked.status === "available") unlockedValues.push(unlocked.value);
    else if (shares.unlocked > 0n) unlockedPartial = true;

    if (locked.status === "available") lockedValues.push(locked.value);
    else if (shares.locked > 0n) lockedPartial = true;
  }

  return {
    ownedSets,
    unlockedPartial,
    unlockedValue: unlockedValues.length > 0 || !unlockedPartial ? sum(unlockedValues) : undefined,
    lockedPartial,
    lockedValue: lockedValues.length > 0 || !lockedPartial ? sum(lockedValues) : undefined,
  };
}
