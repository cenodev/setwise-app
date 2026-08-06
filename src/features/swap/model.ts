import {
  decodeFunctionData,
  encodeFunctionData,
  hashTypedData,
  isAddressEqual,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";

import { setwiseRouterAbi } from "../../data/chain/abis";
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
    throw new Error("Indicative quote targets an unexpected Set");
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

export async function validateFirmSwap(input: {
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
  quoteSigner: Address;
  routerAddress: Address;
}): Promise<void> {
  const {
    address, allowance, balance, chainId, firm, indicative, inputAsset, inputNative,
    outputAsset, outputNative, plannedApprovalAmount, poolAddress, poolId, quoteSigner, routerAddress,
  } = input;
  const firmInput = BigInt(firm.input.atomicAmount);
  const firmOutput = BigInt(firm.output.atomicAmount);
  const poolAuthorization = firm.authorization;
  const poolMessage = poolAuthorization.typedData.message;
  const routerAuthorization = poolAuthorization.router;
  const routerMessage = routerAuthorization.typedData.message;
  const adapter = firm.transaction.adapter;

  let decoded: ReturnType<typeof decodeFunctionData<typeof setwiseRouterAbi>>;
  try {
    decoded = decodeFunctionData({ abi: setwiseRouterAbi, data: firm.transaction.data });
  } catch {
    throw new Error("Firm quote contains invalid swapSetwise calldata");
  }
  if (decoded.functionName !== "swapSetwise" || !decoded.args) {
    throw new Error("Firm quote contains unknown Router calldata");
  }
  const [calldataSwap, calldataFunder, calldataRouterSignature] = decoded.args;
  const canonicalData = encodeFunctionData({
    abi: setwiseRouterAbi,
    functionName: "swapSetwise",
    args: decoded.args,
  });
  if (canonicalData.toLowerCase() !== firm.transaction.data.toLowerCase()) {
    throw new Error("Firm quote contains ambiguous swapSetwise calldata");
  }

  if (firm.transaction.chainId !== chainId || firm.stateSnapshot.chainId !== chainId
    || poolAuthorization.typedData.domain.chainId !== chainId
    || routerAuthorization.typedData.domain.chainId !== chainId
    || routerMessage.chainId !== chainId) {
    throw new Error("Firm quote targets the wrong chain");
  }
  if (firm.intent !== indicative.intent) throw new Error("Firm quote intent does not match the reviewed swap");
  if (firm.stateSnapshot.poolId !== poolId
    || !isAddressEqual(firm.stateSnapshot.poolAddress, poolAddress)
    || !isAddressEqual(firm.transaction.to, routerAddress)
    || !isAddressEqual(poolAuthorization.typedData.domain.verifyingContract, poolAddress)
    || !isAddressEqual(routerMessage.pool, poolAddress)
    || !isAddressEqual(calldataSwap.pool, poolAddress)) {
    throw new Error("Firm quote targets an unexpected Set");
  }
  if (!isAddressEqual(poolAuthorization.signer, quoteSigner)
    || poolAuthorization.keyVersion !== "current"
    || poolAuthorization.signatureType !== "eoa"
    || routerAuthorization.signatureType !== "eoa") {
    throw new Error("Firm quote has unexpected signer metadata");
  }
  if (poolAuthorization.typedData.domain.name !== "SetwisePool"
    || poolAuthorization.typedData.domain.version !== "2.0.0"
    || !hasExactTypedDataFields(poolAuthorization.typedData.types, "SwapQuote", [
      ["payer", "address"],
      ["inputAsset", "address"],
      ["outputAsset", "address"],
      ["inputAmount", "uint256"],
      ["outputAmount", "uint256"],
      ["quoteId", "bytes32"],
      ["deadline", "uint256"],
      ["recipient", "address"],
    ])
    || routerAuthorization.typedData.domain.name !== "SetwiseRouter"
    || routerAuthorization.typedData.domain.version !== "1"
    || !hasExactTypedDataFields(routerAuthorization.typedData.types, "SetwiseAuthorization", [
      ["chainId", "uint256"],
      ["router", "address"],
      ["pool", "address"],
      ["funder", "address"],
      ["recipient", "address"],
      ["assetIn", "address"],
      ["assetOut", "address"],
      ["nativeIn", "bool"],
      ["nativeOut", "bool"],
      ["amountIn", "uint256"],
      ["amountOut", "uint256"],
      ["quoteId", "bytes32"],
      ["deadline", "uint256"],
    ])) {
    throw new Error("Firm quote has unexpected authorization types");
  }
  try {
    const [poolRecoveredSigner, routerRecoveredSigner] = await Promise.all([
      recoverTypedDataAddress({ ...poolAuthorization.typedData, signature: poolAuthorization.signature }),
      recoverTypedDataAddress({ ...routerAuthorization.typedData, signature: routerAuthorization.signature }),
    ]);
    if (!isAddressEqual(poolRecoveredSigner, quoteSigner)
      || !isAddressEqual(routerRecoveredSigner, quoteSigner)
      || !hexEqual(hashTypedData(poolAuthorization.typedData), poolAuthorization.digest)
      || !hexEqual(hashTypedData(routerAuthorization.typedData), routerAuthorization.digest)) {
      throw new Error("unexpected signer");
    }
  } catch {
    throw new Error("Firm quote authorization signatures are invalid");
  }
  if (!isAddressEqual(routerAuthorization.address, routerAddress)
    || !isAddressEqual(routerAuthorization.typedData.domain.verifyingContract, routerAddress)
    || !isAddressEqual(routerMessage.router, routerAddress)) {
    throw new Error("Firm quote targets an unexpected Router");
  }
  if (!isAddressEqual(firm.requirements.sender, address)
    || !isAddressEqual(poolMessage.payer, routerAddress)
    || !isAddressEqual(poolMessage.recipient, address)
    || !isAddressEqual(routerAuthorization.funder, address)
    || !isAddressEqual(routerMessage.funder, address)
    || !isAddressEqual(routerMessage.recipient, address)
    || !isAddressEqual(calldataFunder, address)
    || !isAddressEqual(calldataSwap.recipient, address)) {
    throw new Error("Firm quote requires a different sender or recipient");
  }
  if (firm.input.asset !== inputAsset.id || firm.output.asset !== outputAsset.id
    || !isAddressEqual(poolMessage.inputAsset, inputAsset.address)
    || !isAddressEqual(poolMessage.outputAsset, outputAsset.address)
    || !isAddressEqual(routerMessage.assetIn, inputAsset.address)
    || !isAddressEqual(routerMessage.assetOut, outputAsset.address)
    || !isAddressEqual(calldataSwap.assetIn, inputAsset.address)
    || !isAddressEqual(calldataSwap.assetOut, outputAsset.address)) {
    throw new Error("Firm quote pair does not match the reviewed swap");
  }
  if ((firm.intent === "exact-input" && firm.input.atomicAmount !== indicative.input.atomicAmount)
    || (firm.intent === "exact-output" && firm.output.atomicAmount !== indicative.output.atomicAmount)
    || firmInput <= 0n
    || BigInt(poolMessage.inputAmount) !== firmInput
    || BigInt(routerMessage.amountIn) !== firmInput
    || calldataSwap.amountIn !== firmInput
    || firmOutput <= 0n
    || BigInt(poolMessage.outputAmount) !== firmOutput
    || BigInt(routerMessage.amountOut) !== firmOutput
    || calldataSwap.amountOut !== firmOutput) {
    throw new Error("Firm quote amounts do not match the reviewed swap");
  }
  if (balance < firmInput) throw new Error(`Insufficient ${inputNative ? "BNB" : inputAsset.symbol} balance`);

  if (routerMessage.nativeIn !== inputNative
    || routerMessage.nativeOut !== outputNative
    || calldataSwap.nativeIn !== inputNative
    || calldataSwap.nativeOut !== outputNative) {
    throw new Error("Firm quote native mode does not match the reviewed swap");
  }
  const expectedValue = inputNative ? firmInput : 0n;
  if (BigInt(firm.transaction.value) !== expectedValue) throw new Error("Firm quote transaction value is incorrect");

  if (inputNative) {
    if (firm.requirements.approvals.length !== 0) throw new Error("Native input unexpectedly requires approval");
  } else {
    if (firm.requirements.approvals.length !== 1) throw new Error("Firm quote approval requirement is missing");
    const approval = firm.requirements.approvals[0];
    if (!isAddressEqual(approval.token, inputAsset.address)
      || !isAddressEqual(approval.spender, routerAddress)
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

  const packedDeadline = BigInt(firm.guard.packedDeadline);
  if (firm.firmQuoteId.toLowerCase() !== poolMessage.quoteId.toLowerCase()
    || firm.firmQuoteId.toLowerCase() !== routerMessage.quoteId.toLowerCase()
    || firm.firmQuoteId.toLowerCase() !== calldataSwap.quoteId.toLowerCase()
    || BigInt(poolMessage.deadline) !== packedDeadline
    || BigInt(routerMessage.deadline) !== packedDeadline
    || calldataSwap.deadline !== packedDeadline) {
    throw new Error("Firm quote authorization does not match its executable transaction");
  }
  const mustSubmitAt = Date.parse(firm.mustSubmitBy);
  const executionDeadline = BigInt(firm.executionDeadline);
  if (mustSubmitAt !== Number(executionDeadline) * 1_000
    || (packedDeadline & 0xffff_ffffn) !== executionDeadline) {
    throw new Error("Firm quote deadline is inconsistent");
  }
  if (!isAddressEqual(adapter.funder, calldataFunder)
    || !isAddressEqual(adapter.swap.pool, calldataSwap.pool)
    || !isAddressEqual(adapter.swap.assetIn, calldataSwap.assetIn)
    || !isAddressEqual(adapter.swap.assetOut, calldataSwap.assetOut)
    || adapter.swap.nativeIn !== calldataSwap.nativeIn
    || adapter.swap.nativeOut !== calldataSwap.nativeOut
    || BigInt(adapter.swap.amountIn) !== calldataSwap.amountIn
    || BigInt(adapter.swap.amountOut) !== calldataSwap.amountOut
    || adapter.swap.quoteId.toLowerCase() !== calldataSwap.quoteId.toLowerCase()
    || BigInt(adapter.swap.deadline) !== calldataSwap.deadline
    || !isAddressEqual(adapter.swap.recipient, calldataSwap.recipient)
    || !hexEqual(adapter.swap.signature, calldataSwap.signature)
    || !hexEqual(adapter.swap.auxiliaryData, calldataSwap.auxiliaryData)
    || !hexEqual(poolAuthorization.signature, calldataSwap.signature)
    || !hexEqual(routerAuthorization.signature, calldataRouterSignature)) {
    throw new Error("Firm quote adapter metadata does not match swapSetwise calldata");
  }
  if (mustSubmitAt <= (input.now ?? Date.now())) throw new Error("Firm quote expired before wallet confirmation");
}

function hexEqual(left: Hex, right: Hex): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function hasExactTypedDataFields(
  types: Record<string, { name: string; type: string }[]>,
  primaryType: string,
  expected: readonly (readonly [string, string])[],
): boolean {
  const fields = types[primaryType];
  return fields?.length === expected.length
    && fields.every((field, index) => field.name === expected[index]?.[0] && field.type === expected[index]?.[1]);
}

export function buildAtomicSwapCalls(input: {
  firm: FirmSwapQuote;
  inputAsset: PoolAsset;
  now?: number;
  routerAddress: Address;
}): AtomicCall[] {
  const { firm, inputAsset, routerAddress } = input;
  if (firm.transaction.adapter.swap.nativeIn) {
    throw new Error("Native-input swaps do not require an atomic approval batch");
  }
  return buildAtomicApprovalCalls({
    approvals: [{ amount: BigInt(firm.input.atomicAmount), assetId: inputAsset.id, token: inputAsset.address }],
    mustSubmitBy: firm.mustSubmitBy,
    now: input.now,
    requirements: firm.requirements.approvals,
    spender: routerAddress,
    transaction: firm.transaction,
  });
}
