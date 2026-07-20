import type { PoolState } from "../../data/rfq/deposits";

export type DecimalRatio = Readonly<{
  denominator: bigint;
  numerator: bigint;
}>;

export type AvailableCalculation = Readonly<{
  status: "available";
  value: DecimalRatio;
}>;

export type UnavailableCalculation = Readonly<{
  reason: "zero-tvl" | "zero-total-supply";
  status: "unavailable";
}>;

export type Calculation = AvailableCalculation | UnavailableCalculation;

export type DisplayRounding = "down" | "half-up";

type TokenAmount = Pick<PoolState["totalSupply"], "atomicAmount" | "decimals">;
type PoolAssetState = PoolState["assets"][number];

const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

function powerOfTen(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error("Decimal places must be a non-negative integer");
  }
  return 10n ** BigInt(decimals);
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function ratio(numerator: bigint, denominator = 1n): DecimalRatio {
  if (denominator === 0n) throw new Error("A decimal ratio cannot have a zero denominator");
  if (numerator === 0n) return { numerator: 0n, denominator: 1n };

  const normalizedNumerator = denominator < 0n ? -numerator : numerator;
  const normalizedDenominator = denominator < 0n ? -denominator : denominator;
  const divisor = greatestCommonDivisor(normalizedNumerator, normalizedDenominator);
  return { numerator: normalizedNumerator / divisor, denominator: normalizedDenominator / divisor };
}

function available(value: DecimalRatio): AvailableCalculation {
  return { status: "available", value };
}

function unavailable(reason: UnavailableCalculation["reason"]): UnavailableCalculation {
  return { status: "unavailable", reason };
}

function multiply(left: DecimalRatio, right: DecimalRatio): DecimalRatio {
  return ratio(left.numerator * right.numerator, left.denominator * right.denominator);
}

function divide(left: DecimalRatio, right: DecimalRatio): DecimalRatio {
  if (right.numerator === 0n) throw new Error("Cannot divide by zero");
  return ratio(left.numerator * right.denominator, left.denominator * right.numerator);
}

function add(left: DecimalRatio, right: DecimalRatio): DecimalRatio {
  return ratio(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function subtract(left: DecimalRatio, right: DecimalRatio): DecimalRatio {
  return ratio(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

/** Parses an API decimal string without converting it through a JavaScript number. */
export function decimalRatio(value: string): DecimalRatio {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) throw new Error("Expected a non-negative decimal string");

  const fraction = match[2] ?? "";
  return ratio(BigInt(`${match[1]}${fraction}`), powerOfTen(fraction.length));
}

export function atomicAmountRatio(atomicAmount: bigint | string, decimals: number): DecimalRatio {
  const amount = typeof atomicAmount === "bigint" ? atomicAmount : BigInt(atomicAmount);
  if (amount < 0n) throw new Error("Atomic amounts must be non-negative");
  return ratio(amount, powerOfTen(decimals));
}

/**
 * Applies display rounding to an exact ratio. Calculations intentionally retain
 * their full ratio so callers can choose a different display precision later.
 */
export function formatDecimalRatio(
  value: DecimalRatio,
  fractionDigits: number,
  rounding: DisplayRounding = "half-up",
): string {
  const scale = powerOfTen(fractionDigits);
  const negative = value.numerator < 0n;
  const numerator = negative ? -value.numerator : value.numerator;
  let scaled = numerator * scale / value.denominator;
  const remainder = numerator * scale % value.denominator;
  if (rounding === "half-up" && remainder * 2n >= value.denominator) scaled += 1n;

  const integer = scaled / scale;
  if (fractionDigits === 0) return `${negative ? "-" : ""}${integer}`;
  const fraction = (scaled % scale).toString().padStart(fractionDigits, "0");
  return `${negative ? "-" : ""}${integer}.${fraction}`;
}

export function calculatePoolTvl(state: Pick<PoolState, "totalValueUsd">): DecimalRatio {
  return decimalRatio(state.totalValueUsd);
}

export function calculateLpSharePrice(
  state: Pick<PoolState, "totalSupply" | "totalValueUsd">,
): Calculation {
  const tvl = calculatePoolTvl(state);
  const supply = atomicAmountRatio(state.totalSupply.atomicAmount, state.totalSupply.decimals);
  if (tvl.numerator === 0n) return unavailable("zero-tvl");
  if (supply.numerator === 0n) return unavailable("zero-total-supply");
  return available(divide(tvl, supply));
}

export function calculateCurrentAssetAllocation(
  asset: Pick<PoolAssetState, "valueUsd">,
  state: Pick<PoolState, "totalValueUsd">,
): Calculation {
  const tvl = calculatePoolTvl(state);
  if (tvl.numerator === 0n) return unavailable("zero-tvl");
  return available(divide(decimalRatio(asset.valueUsd), tvl));
}

/** Returns the difference between the current allocation and target weight in percentage points. */
export function calculateTargetAllocationVariance(
  asset: Pick<PoolAssetState, "valueUsd">,
  state: Pick<PoolState, "totalValueUsd">,
  targetWeight: number,
): Calculation {
  if (!Number.isInteger(targetWeight) || targetWeight < 0) {
    throw new Error("Target allocation must be a non-negative integer percentage");
  }
  const currentAllocation = calculateCurrentAssetAllocation(asset, state);
  if (currentAllocation.status === "unavailable") return currentAllocation;
  return available(subtract(multiply(currentAllocation.value, ratio(100n)), ratio(BigInt(targetWeight))));
}

export function calculateOwnershipPercentage(
  attributedSharesAtomic: bigint,
  totalSupply: TokenAmount,
): Calculation {
  const supply = BigInt(totalSupply.atomicAmount);
  if (supply === 0n) return unavailable("zero-total-supply");
  if (attributedSharesAtomic < 0n) throw new Error("Attributed shares must be non-negative");
  return available(ratio(attributedSharesAtomic * 100n, supply));
}

export function calculateUserLiquidityValue(input: {
  attributedSharesAtomic: bigint;
  state: Pick<PoolState, "totalSupply" | "totalValueUsd">;
}): Calculation {
  const { attributedSharesAtomic, state } = input;
  const tvl = calculatePoolTvl(state);
  const supply = BigInt(state.totalSupply.atomicAmount);
  if (tvl.numerator === 0n) return unavailable("zero-tvl");
  if (supply === 0n) return unavailable("zero-total-supply");
  if (attributedSharesAtomic < 0n) throw new Error("Attributed shares must be non-negative");
  return available(multiply(tvl, ratio(attributedSharesAtomic, supply)));
}

export function calculateWalletAssetUsdValue(input: {
  balanceAtomic: bigint;
  market: Pick<PoolAssetState["market"], "askUsd" | "bidUsd">;
  tokenDecimals: number;
}): DecimalRatio {
  if (input.balanceAtomic < 0n) throw new Error("Wallet balances must be non-negative");
  const midpointPrice = divide(add(decimalRatio(input.market.bidUsd), decimalRatio(input.market.askUsd)), ratio(2n));
  return multiply(atomicAmountRatio(input.balanceAtomic, input.tokenDecimals), midpointPrice);
}

export function calculateMidpointMarketPrice(
  market: Pick<PoolAssetState["market"], "askUsd" | "bidUsd">,
): DecimalRatio {
  return divide(add(decimalRatio(market.bidUsd), decimalRatio(market.askUsd)), ratio(2n));
}
