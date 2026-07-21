import { isAddressEqual, type Address } from "viem";

import type { PoolAsset } from "../../data/rfq/deposits";
import type { FirmWithdrawalQuote, WithdrawalQuote } from "../../data/rfq/withdrawals";

export function shareShortcut(unlockedBalance: bigint, percentage: 25 | 50 | 75 | 100): bigint {
  if (unlockedBalance < 0n) throw new Error("Unlocked balance cannot be negative");
  return unlockedBalance * BigInt(percentage) / 100n;
}

export function canReceiveNative(outputAsset: Address, wrappedNative: Address): boolean {
  return isAddressEqual(outputAsset, wrappedNative);
}

export function mapWithdrawalOutputs(
  quote: WithdrawalQuote,
  assets: readonly PoolAsset[],
): Array<{ asset: PoolAsset; output: WithdrawalQuote["outputs"][number] }> {
  const expectedAssets = quote.mode === "proportional"
    ? assets
    : assets.filter((asset) => asset.id === quote.outputs[0]?.asset);
  if (quote.outputs.length !== expectedAssets.length) {
    throw new Error("Withdrawal quote output count does not match the selected mode");
  }
  const byId = new Map(quote.outputs.map((output) => [output.asset, output]));
  if (byId.size !== quote.outputs.length) throw new Error("Withdrawal quote contains duplicate outputs");
  return expectedAssets.map((asset) => {
    const output = byId.get(asset.id);
    if (!output || output.decimals !== asset.decimals) {
      throw new Error(`Withdrawal quote output does not match ${asset.id}`);
    }
    return { asset, output };
  });
}

export function relevantWithdrawalWarnings(
  quote: WithdrawalQuote,
): WithdrawalQuote["warnings"] {
  const outputAssets = new Set(quote.outputs.map((output) => output.asset));
  const seen = new Set<string>();
  return quote.warnings.filter((warning) => {
    if (typeof warning.asset === "string" && !outputAssets.has(warning.asset)) return false;
    const key = `${warning.code}\u0000${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateFirmWithdrawal(input: {
  address: Address;
  chainId: number;
  firm: FirmWithdrawalQuote;
  indicative: WithdrawalQuote;
  now?: number;
  outputAssetId: string;
  poolAddress: Address;
  receiveNative: boolean;
  unlockedBalance: bigint;
}): void {
  const { address, chainId, firm, indicative, outputAssetId, poolAddress, receiveNative, unlockedBalance } = input;
  if (firm.transaction.chainId !== chainId) throw new Error("Firm quote targets the wrong chain");
  if (!isAddressEqual(firm.investor, address) || !isAddressEqual(firm.requirements.sender, address)) {
    throw new Error("Firm quote requires a different sender");
  }
  if (!isAddressEqual(firm.transaction.to, poolAddress)) throw new Error("Firm quote targets an unexpected Set");
  if (BigInt(firm.transaction.value) !== 0n) throw new Error("Withdrawal unexpectedly requests native value");
  if (firm.receiveNative !== receiveNative) throw new Error("Firm quote native output does not match the selection");
  if (firm.output.asset !== outputAssetId) throw new Error("Firm quote output does not match the selected asset");
  if (firm.shares.asset !== indicative.input.asset
    || firm.shares.decimals !== indicative.input.decimals
    || firm.shares.atomicAmount !== indicative.input.atomicAmount
    || firm.requirements.minimumPoolTokenBalance !== firm.shares.atomicAmount) {
    throw new Error("Firm quote changed the required Set-share balance");
  }
  if (BigInt(firm.requirements.minimumPoolTokenBalance) > unlockedBalance) {
    throw new Error("Insufficient unlocked SETWISE balance for the firm quote");
  }
  if (Date.parse(firm.mustSubmitBy) <= (input.now ?? Date.now())) {
    throw new Error("Firm quote expired before wallet confirmation");
  }
}
