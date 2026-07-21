import type { Address } from "viem";

import type { PoolState } from "../../data/rfq/deposits";
import {
  calculateUserLiquidityValue,
  decimalRatio,
  type Calculation,
  type DecimalRatio,
} from "../pool-analytics/model";

export type PortfolioSetStatus =
  | "ready"
  | "disconnected"
  | "zero-balance"
  | "stale"
  | "error"
  | "unsupported-chain";

export type PortfolioCoverage = Readonly<{
  available: number;
  errors: number;
  stale: number;
  total: number;
  unsupported: number;
}>;

export type PortfolioAggregate =
  | Readonly<{
    coverage: PortfolioCoverage;
    status: "ready" | "partial" | "stale" | "zero-balance";
    value: DecimalRatio;
  }>
  | Readonly<{
    coverage: PortfolioCoverage;
    status: "disconnected" | "error" | "unsupported-chain";
  }>;

export type PortfolioSetMetric = Readonly<{
  state?: Pick<PoolState, "totalSupply" | "totalValueUsd">;
  status: Exclude<PortfolioSetStatus, "disconnected" | "zero-balance">;
}>;

export type PortfolioUserMetric = Readonly<{
  attributedSharesAtomic?: bigint;
  state?: Pick<PoolState, "totalSupply" | "totalValueUsd">;
  status: PortfolioSetStatus;
}>;

export type ExternalLiquiditySource = Readonly<{
  chainId: number;
  liquidityUsd: string;
  observedAt?: string;
  sourceAddress: Address;
  venue: string;
}>;

export type UniqueExternalLiquidity = Readonly<{
  sources: readonly ExternalLiquiditySource[];
  totalValueUsd: DecimalRatio;
}>;

export type PortfolioFreshness = Readonly<{
  newestTimestamp: string | null;
  oldestTimestamp: string | null;
  stale: number;
  status: "ready" | "partial" | "stale" | "error";
  total: number;
}>;

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

function coverage(statuses: readonly PortfolioSetStatus[]): PortfolioCoverage {
  return {
    available: statuses.filter((status) => status === "ready" || status === "stale" || status === "zero-balance").length,
    errors: statuses.filter((status) => status === "error").length,
    stale: statuses.filter((status) => status === "stale").length,
    total: statuses.length,
    unsupported: statuses.filter((status) => status === "unsupported-chain").length,
  };
}

export function calculateUserSetLiquidity(input: {
  attributedSharesAtomic: bigint;
  state: Pick<PoolState, "totalSupply" | "totalValueUsd">;
}): Calculation {
  return calculateUserLiquidityValue(input);
}

export function aggregatePublicTvl(sets: readonly PortfolioSetMetric[]): PortfolioAggregate {
  const statuses = sets.map((set) => set.status);
  const resultCoverage = coverage(statuses);
  const values = sets.flatMap((set) => (
    (set.status === "ready" || set.status === "stale") && set.state
      ? [decimalRatio(set.state.totalValueUsd)]
      : []
  ));

  if (sets.length === 0) return { coverage: resultCoverage, status: "ready", value: ratio(0n) };
  if (values.length === 0) {
    return resultCoverage.unsupported === resultCoverage.total
      ? { coverage: resultCoverage, status: "unsupported-chain" }
      : { coverage: resultCoverage, status: "error" };
  }
  const isPartial = resultCoverage.available < resultCoverage.total;
  return {
    coverage: resultCoverage,
    status: isPartial ? "partial" : resultCoverage.stale > 0 ? "stale" : "ready",
    value: sum(values),
  };
}

export function aggregateUserLiquidity(sets: readonly PortfolioUserMetric[]): PortfolioAggregate {
  const statuses = sets.map((set) => set.status);
  const resultCoverage = coverage(statuses);
  if (sets.length === 0) return { coverage: resultCoverage, status: "zero-balance", value: ratio(0n) };
  if (statuses.every((status) => status === "disconnected")) {
    return { coverage: resultCoverage, status: "disconnected" };
  }

  const values = sets.flatMap((set) => {
    if (!set.state || set.attributedSharesAtomic === undefined) return [];
    if (set.status !== "ready" && set.status !== "stale" && set.status !== "zero-balance") return [];
    const result = calculateUserSetLiquidity({
      attributedSharesAtomic: set.attributedSharesAtomic,
      state: set.state,
    });
    return result.status === "available" ? [result.value] : [];
  });

  if (values.length === 0) {
    if (statuses.some((status) => status === "disconnected")) {
      return { coverage: resultCoverage, status: "disconnected" };
    }
    if (resultCoverage.unsupported === resultCoverage.total) {
      return { coverage: resultCoverage, status: "unsupported-chain" };
    }
    return { coverage: resultCoverage, status: "error" };
  }

  const value = sum(values);
  const missing = values.length < sets.length;
  return {
    coverage: resultCoverage,
    status: missing ? "partial" : value.numerator === 0n ? "zero-balance" : resultCoverage.stale > 0 ? "stale" : "ready",
    value,
  };
}

export function calculateSetSharePercentage(
  setValue: DecimalRatio,
  aggregateValue: DecimalRatio,
): Calculation {
  if (aggregateValue.numerator === 0n) return { reason: "zero-tvl", status: "unavailable" };
  return {
    status: "available",
    value: ratio(
      setValue.numerator * aggregateValue.denominator * 100n,
      setValue.denominator * aggregateValue.numerator,
    ),
  };
}

function sourceKey(source: ExternalLiquiditySource): string {
  return `${source.chainId}:${source.venue.trim().toLowerCase()}:${source.sourceAddress.toLowerCase()}`;
}

/** Deduplicates venue depth shared by multiple Sets, preferring the newest observation. */
export function aggregateUniqueExternalLiquidity(
  sourcesBySet: readonly (readonly ExternalLiquiditySource[])[],
): UniqueExternalLiquidity {
  const unique = new Map<string, ExternalLiquiditySource>();
  for (const sources of sourcesBySet) {
    for (const source of sources) {
      const key = sourceKey(source);
      const current = unique.get(key);
      const nextTime = source.observedAt ? Date.parse(source.observedAt) : Number.NEGATIVE_INFINITY;
      const currentTime = current?.observedAt ? Date.parse(current.observedAt) : Number.NEGATIVE_INFINITY;
      if (!current || nextTime > currentTime) unique.set(key, source);
    }
  }
  const sources = [...unique.values()];
  return {
    sources,
    totalValueUsd: sum(sources.map((source) => decimalRatio(source.liquidityUsd))),
  };
}

export function calculatePortfolioFreshness(
  timestamps: readonly (string | null | undefined)[],
  nowMs: number,
  staleAfterMs: number,
): PortfolioFreshness {
  if (!Number.isFinite(nowMs) || staleAfterMs < 0) throw new Error("Freshness inputs must be non-negative finite values");
  const parsed = timestamps.map((timestamp) => ({
    timestamp,
    value: timestamp ? Date.parse(timestamp) : Number.NaN,
  }));
  const valid = parsed.filter((entry) => Number.isFinite(entry.value));
  const stale = valid.filter((entry) => nowMs - entry.value > staleAfterMs).length;
  const missing = valid.length < timestamps.length;
  const ordered = [...valid].sort((left, right) => left.value - right.value);
  return {
    newestTimestamp: ordered.at(-1)?.timestamp ?? null,
    oldestTimestamp: ordered[0]?.timestamp ?? null,
    stale,
    status: valid.length === 0
      ? "error"
      : missing
        ? "partial"
        : stale > 0
          ? "stale"
          : "ready",
    total: timestamps.length,
  };
}
