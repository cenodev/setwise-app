import { isAddressEqual, type Address } from "viem";

import type { PoolAsset } from "../../data/rfq/deposits";
import type { FirmSwapQuote, SwapQuote } from "../../data/rfq/swaps";
import { buildAtomicApprovalCalls, type AtomicCall } from "../wallet/atomicBatch";

export type DiscoveredPair = { assets: readonly [string, string]; enabled: boolean };

export function isSupportedSwapPair(
  pairs: readonly DiscoveredPair[] | undefined,
  inputAssetId: string,
  outputAssetId: string,
): boolean {
  if (!inputAssetId || !outputAssetId || inputAssetId === outputAssetId) return false;
  if (!pairs) return true;
  return pairs.some((pair) => pair.enabled
    && pair.assets.includes(inputAssetId)
    && pair.assets.includes(outputAssetId));
}

export function reverseSwapPair(inputAssetId: string, outputAssetId: string) {
  return { inputAssetId: outputAssetId, outputAssetId: inputAssetId };
}

export function maximumSwapInput(balance: bigint, nativeInput: boolean, gasReserve: bigint): bigint {
  if (balance < 0n || gasReserve < 0n) throw new Error("Balances and gas reserve cannot be negative");
  if (!nativeInput) return balance;
  return balance > gasReserve ? balance - gasReserve : 0n;
}

export function isWrappedNativeAsset(asset: PoolAsset | undefined, wrappedNativeToken: Address | undefined): boolean {
  return Boolean(asset && wrappedNativeToken && isAddressEqual(asset.address, wrappedNativeToken));
}

export function relevantSwapWarnings(quote: SwapQuote): SwapQuote["warnings"] {
  const selectedAssets = new Set([quote.input.asset, quote.output.asset]);
  const seen = new Set<string>();
  return quote.warnings.filter((warning) => {
    if (warning.asset && !selectedAssets.has(warning.asset)) return false;
    const key = `${warning.code}\u0000${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateIndicativeSwap(input: {
  specifiedAmountAtomic: bigint;
  intent: SwapQuote["intent"];
  inputAsset: PoolAsset;
  outputAsset: PoolAsset;
  poolAddress: Address;
  poolId: string;
  quote: SwapQuote;
  chainId: number;
}): void {
  const { specifiedAmountAtomic, intent, inputAsset, outputAsset, poolAddress, poolId, quote, chainId } = input;
  if (quote.stateSnapshot.chainId !== chainId) throw new Error("Indicative quote targets the wrong chain");
  if (quote.stateSnapshot.poolId !== poolId || !isAddressEqual(quote.stateSnapshot.poolAddress, poolAddress)) {
    throw new Error("Indicative quote targets an unexpected pool");
  }
  if (quote.stateSnapshot.tradingPaused) throw new Error("Trading paused while pricing this swap");
  if (quote.intent !== intent) throw new Error(`Indicative quote is not ${intent}`);
  if (quote.input.asset !== inputAsset.id || quote.output.asset !== outputAsset.id) {
    throw new Error("Indicative quote pair does not match the selection");
  }
  if (quote.input.decimals !== inputAsset.decimals || quote.output.decimals !== outputAsset.decimals) {
    throw new Error("Indicative quote decimals do not match asset discovery");
  }
  const fixedAmount = intent === "exact-input" ? quote.input.atomicAmount : quote.output.atomicAmount;
  if (BigInt(fixedAmount) !== specifiedAmountAtomic) {
    throw new Error(`Indicative quote changed the ${intent === "exact-input" ? "input" : "output"} amount`);
  }
  if (BigInt(quote.input.atomicAmount) <= 0n) throw new Error("Indicative quote input must be positive");
  if (BigInt(quote.output.atomicAmount) <= 0n) throw new Error("Indicative quote output must be positive");
}

export function validateFirmSwap(input: {
  address: Address;
  allowance: bigint;
  balance: bigint;
  chainId: number;
  firm: FirmSwapQuote;
  indicative: SwapQuote;
  inputAsset: PoolAsset;
  inputNative: boolean;
  now?: number;
  outputAsset: PoolAsset;
  outputNative: boolean;
  plannedApprovalAmount?: bigint;
  poolAddress: Address;
  poolId: string;
}): void {
  const {
    address, allowance, balance, chainId, firm, indicative, inputAsset, inputNative,
    outputAsset, outputNative, plannedApprovalAmount, poolAddress, poolId,
  } = input;
  const firmInput = BigInt(firm.input.atomicAmount);
  const firmOutput = BigInt(firm.output.atomicAmount);
  const message = firm.authorization.typedData.message;

  if (firm.transaction.chainId !== chainId || firm.stateSnapshot.chainId !== chainId
    || firm.authorization.typedData.domain.chainId !== chainId) {
    throw new Error("Firm quote targets the wrong chain");
  }
  if (firm.intent !== indicative.intent) throw new Error("Firm quote intent does not match the reviewed swap");
  if (firm.stateSnapshot.poolId !== poolId
    || !isAddressEqual(firm.stateSnapshot.poolAddress, poolAddress)
    || !isAddressEqual(firm.transaction.to, poolAddress)
    || !isAddressEqual(firm.authorization.typedData.domain.verifyingContract, poolAddress)) {
    throw new Error("Firm quote targets an unexpected pool");
  }
  if (!isAddressEqual(firm.requirements.sender, address)
    || !isAddressEqual(message.payer, address)
    || !isAddressEqual(message.recipient, address)) {
    throw new Error("Firm quote requires a different sender or recipient");
  }
  if (firm.input.asset !== inputAsset.id || firm.output.asset !== outputAsset.id
    || !isAddressEqual(message.inputAsset, inputAsset.address)
    || !isAddressEqual(message.outputAsset, outputAsset.address)) {
    throw new Error("Firm quote pair does not match the reviewed swap");
  }
  if ((firm.intent === "exact-input" && firm.input.atomicAmount !== indicative.input.atomicAmount)
    || (firm.intent === "exact-output" && firm.output.atomicAmount !== indicative.output.atomicAmount)
    || firmInput <= 0n
    || BigInt(message.inputAmount) !== firmInput
    || firmOutput <= 0n
    || BigInt(message.outputAmount) !== firmOutput) {
    throw new Error("Firm quote amounts do not match the reviewed swap");
  }
  if (balance < firmInput) throw new Error(`Insufficient ${inputNative ? "BNB" : inputAsset.symbol} balance`);

  const expectedMethod = inputNative
    ? "swapExactNativeForAsset"
    : outputNative ? "swapExactAssetForNative" : "swapExactAssetForAsset";
  if (firm.transaction.method !== expectedMethod) throw new Error("Firm quote native mode does not match the reviewed swap");
  const expectedValue = inputNative ? firmInput : 0n;
  if (BigInt(firm.transaction.value) !== expectedValue) throw new Error("Firm quote transaction value is incorrect");

  if (inputNative) {
    if (firm.requirements.approvals.length !== 0) throw new Error("Native input unexpectedly requires approval");
  } else {
    if (firm.requirements.approvals.length !== 1) throw new Error("Firm quote approval requirement is missing");
    const approval = firm.requirements.approvals[0];
    if (!isAddressEqual(approval.token, inputAsset.address)
      || !isAddressEqual(approval.spender, poolAddress)
      || BigInt(approval.minimumAtomicAmount) !== firmInput) {
      throw new Error("Firm quote approval requirement does not match the reviewed swap");
    }
    if (plannedApprovalAmount !== undefined && plannedApprovalAmount !== firmInput) {
      throw new Error("Planned token approval is not exact for the firm quote");
    }
    if (plannedApprovalAmount === undefined
      && (allowance < firmInput || allowance < BigInt(approval.minimumAtomicAmount))) {
      throw new Error("Token approval is insufficient for the firm quote");
    }
  }

  if (firm.firmQuoteId.toLowerCase() !== message.quoteId.toLowerCase()
    || firm.guard.packedDeadline !== message.deadline) {
    throw new Error("Firm quote authorization does not match its executable transaction");
  }
  const mustSubmitAt = Date.parse(firm.mustSubmitBy);
  if (mustSubmitAt !== Number(BigInt(firm.executionDeadline)) * 1_000) {
    throw new Error("Firm quote deadline is inconsistent");
  }
  if (mustSubmitAt <= (input.now ?? Date.now())) throw new Error("Firm quote expired before wallet confirmation");
}

export function buildAtomicSwapCalls(input: {
  firm: FirmSwapQuote;
  inputAsset: PoolAsset;
  now?: number;
  poolAddress: Address;
}): AtomicCall[] {
  const { firm, inputAsset, poolAddress } = input;
  if (firm.transaction.method === "swapExactNativeForAsset") {
    throw new Error("Native-input swaps do not require an atomic approval batch");
  }
  return buildAtomicApprovalCalls({
    approvals: [{ amount: BigInt(firm.input.atomicAmount), assetId: inputAsset.id, token: inputAsset.address }],
    mustSubmitBy: firm.mustSubmitBy,
    now: input.now,
    requirements: firm.requirements.approvals,
    spender: poolAddress,
    transaction: firm.transaction,
  });
}
