import type { FirmSwapQuote, SwapQuote } from "../../data/rfq/swaps";
import type { PoolAsset } from "../../data/rfq/deposits";
import type { Address } from "viem";
import {
  isSupportedSwapPair,
  maximumSwapInput,
  reverseSwapPair,
  validateFirmSwap,
} from "./model";

const poolAddress: Address = "0x1000000000000000000000000000000000000000";
const inputAddress: Address = "0x2000000000000000000000000000000000000000";
const outputAddress: Address = "0x3000000000000000000000000000000000000000";
const address: Address = "0x4000000000000000000000000000000000000000";
const quoteId = `0x${"1".repeat(64)}` as const;
const inputAsset: PoolAsset = { address: inputAddress, decimals: 18, id: "USDT", index: 0, symbol: "USDT", weight: 50 };
const outputAsset: PoolAsset = { address: outputAddress, decimals: 18, id: "TOKEN", index: 1, symbol: "TOKEN", weight: 50 };
const inputAtomic = "10000000000000000000";
const outputAtomic = "2000000000000000000";
const deadline = Math.floor(Date.now() / 1_000) + 60;

const indicative = {
  input: { amount: "10", asset: "USDT", atomicAmount: inputAtomic, decimals: 18 },
  output: { amount: "2", asset: "TOKEN", atomicAmount: outputAtomic, decimals: 18 },
} as SwapQuote;

function firm(overrides: Record<string, unknown> = {}): FirmSwapQuote {
  const base = {
    authorization: {
      digest: quoteId,
      signature: "0x1234",
      signer: inputAddress,
      typedData: {
        domain: { chainId: 97, name: "SetwisePool", verifyingContract: poolAddress, version: "2.0.0" },
        message: { deadline: "123", inputAmount: inputAtomic, inputAsset: inputAddress, outputAmount: outputAtomic, outputAsset: outputAddress, payer: address, quoteId, recipient: address },
        primaryType: "SwapQuote",
        types: {},
      },
    },
    createdAt: new Date((deadline - 10) * 1_000).toISOString(),
    executionDeadline: String(deadline),
    firmQuoteId: quoteId,
    guard: { inputTolerancePpm: "5000", maximumInputBalance: "1", minimumOutputBalance: "1", offchainInputBalance: "1", offchainOutputBalance: "1", outputTolerancePpm: "5000", packedDeadline: "123" },
    input: indicative.input,
    intent: "exact-input",
    mustSubmitBy: new Date(deadline * 1_000).toISOString(),
    operation: "swap",
    output: indicative.output,
    persisted: true,
    quoteType: "firm",
    requirements: { approvals: [{ minimumAtomicAmount: inputAtomic, spender: poolAddress, token: inputAddress }], sender: address },
    stateSnapshot: { blockHash: `0x${"2".repeat(64)}`, blockNumber: "1", blockTimestamp: "1", chainId: 97, poolAddress, poolId: "pool" },
    status: "executable",
    transaction: { chainId: 97, data: "0x1234", method: "swapExactAssetForAsset", to: poolAddress, value: "0" },
    venues: [],
    warnings: [],
  } as FirmSwapQuote;
  return { ...base, ...overrides };
}

const validInput = () => ({
  address,
  allowance: BigInt(inputAtomic),
  balance: BigInt(inputAtomic),
  chainId: 97,
  firm: firm(),
  indicative,
  inputAsset,
  inputNative: false,
  outputAsset,
  outputNative: false,
  poolAddress,
  poolId: "pool",
});

describe("swap model", () => {
  it("uses discovery pairs, reverses the pair, and prevents identical assets", () => {
    const pairs = [{ assets: ["USDT", "TOKEN"] as const, enabled: true }];
    expect(isSupportedSwapPair(pairs, "USDT", "TOKEN")).toBe(true);
    expect(isSupportedSwapPair(pairs, "TOKEN", "USDT")).toBe(true);
    expect(isSupportedSwapPair(pairs, "USDT", "USDT")).toBe(false);
    expect(reverseSwapPair("USDT", "TOKEN")).toEqual({ inputAssetId: "TOKEN", outputAssetId: "USDT" });
  });

  it("reserves gas only from native Max and never returns a negative amount", () => {
    expect(maximumSwapInput(5_000n, false, 1_000n)).toBe(5_000n);
    expect(maximumSwapInput(5_000n, true, 1_000n)).toBe(4_000n);
    expect(maximumSwapInput(500n, true, 1_000n)).toBe(0n);
  });

  it("accepts a fully matching ERC-20 firm quote", () => {
    expect(() => validateFirmSwap(validInput())).not.toThrow();
  });

  it.each([
    ["wrong chain", (value: ReturnType<typeof validInput>) => ({ ...value, chainId: 56 })],
    ["wrong sender", (value: ReturnType<typeof validInput>) => ({ ...value, address: outputAddress })],
    ["wrong pool", (value: ReturnType<typeof validInput>) => ({ ...value, poolAddress: outputAddress })],
    ["wrong pair", (value: ReturnType<typeof validInput>) => ({ ...value, outputAsset: inputAsset })],
    ["wrong amount", (value: ReturnType<typeof validInput>) => ({ ...value, indicative: { ...indicative, input: { ...indicative.input, atomicAmount: "1" } } })],
    ["wrong value", (value: ReturnType<typeof validInput>) => ({ ...value, firm: firm({ transaction: { ...firm().transaction, value: "1" } }) })],
    ["insufficient approval", (value: ReturnType<typeof validInput>) => ({ ...value, allowance: BigInt(inputAtomic) - 1n })],
    ["expired deadline", (value: ReturnType<typeof validInput>) => ({ ...value, now: deadline * 1_000 })],
  ])("rejects a firm response with %s", (_name, mutate) => {
    expect(() => validateFirmSwap(mutate(validInput()) as Parameters<typeof validateFirmSwap>[0])).toThrow();
  });

  it("accepts native input without approval only with exact transaction value", () => {
    const nativeFirm = firm({
      requirements: { approvals: [], sender: address },
      transaction: { ...firm().transaction, method: "swapExactNativeForAsset", value: inputAtomic },
    });
    expect(() => validateFirmSwap({ ...validInput(), allowance: 0n, firm: nativeFirm, inputNative: true })).not.toThrow();
  });

  it("requires the asset-to-native method for native output", () => {
    const nativeOutputFirm = firm({ transaction: { ...firm().transaction, method: "swapExactAssetForNative" } });
    expect(() => validateFirmSwap({ ...validInput(), firm: nativeOutputFirm, outputNative: true })).not.toThrow();
  });
});
