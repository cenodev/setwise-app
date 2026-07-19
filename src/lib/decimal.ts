const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;

function powerOfTen(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error("Token decimals must be a non-negative integer");
  }
  return 10n ** BigInt(decimals);
}

export function decimalInputError(value: string, decimals: number): string | null {
  if (!value) return "Enter an amount";
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) return "Enter a positive decimal amount";
  if ((match[1]?.length ?? 0) > decimals) {
    return `This asset supports at most ${decimals} decimal places`;
  }
  return null;
}

export function decimalToAtomic(value: string, decimals: number): bigint {
  const error = decimalInputError(value, decimals);
  if (error) throw new Error(error);

  const [integer = "0", fraction = ""] = value.split(".");
  return BigInt(integer) * powerOfTen(decimals)
    + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function atomicToDecimal(value: bigint, decimals: number): string {
  const scale = powerOfTen(decimals);
  const integer = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer.toString();
}

export function formatTokenAmount(value: bigint, decimals: number, places = 6): string {
  const amount = atomicToDecimal(value, decimals);
  const [integer, fraction = ""] = amount.split(".");
  const shown = fraction.slice(0, places).replace(/0+$/, "");
  return shown ? `${integer}.${shown}` : (integer ?? "0");
}

export type WeightedAsset = {
  decimals: number;
  priceUsd: string;
  weight: number;
};

/** Returns requested amounts without capping them to wallet balances. */
export function fillByTargetWeights(totalUsd: string, assets: readonly WeightedAsset[]): string[] {
  const totalUsdAtomic = decimalToAtomic(totalUsd, 18);
  const totalWeight = assets.reduce((sum, asset) => sum + asset.weight, 0);
  if (totalWeight <= 0) throw new Error("Target weights must total more than zero");

  return assets.map((asset) => {
    if (!Number.isInteger(asset.weight) || asset.weight < 0) {
      throw new Error("Target weights must be non-negative integers");
    }
    const priceAtomic = decimalToAtomic(asset.priceUsd, 18);
    if (priceAtomic <= 0n) throw new Error("Asset prices must be positive");
    const amount = totalUsdAtomic * BigInt(asset.weight) * powerOfTen(asset.decimals)
      / (BigInt(totalWeight) * priceAtomic);
    return atomicToDecimal(amount, asset.decimals);
  });
}

export function usdValue(
  amountAtomic: bigint,
  tokenDecimals: number,
  priceUsd: string,
  outputDecimals = 2,
): string {
  const priceAtomic = decimalToAtomic(priceUsd, 18);
  const value = amountAtomic * priceAtomic * powerOfTen(outputDecimals)
    / powerOfTen(tokenDecimals)
    / powerOfTen(18);
  return `${atomicToDecimal(value, outputDecimals)} USD`;
}
