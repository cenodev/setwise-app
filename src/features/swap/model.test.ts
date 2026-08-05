import type { FirmSwapQuote, SwapQuote } from "../../data/rfq/swaps";
import liveRouterFirmQuote from "../../data/rfq/fixtures/router-firm-quote.json";
import { firmSwapQuoteSchema, trustedRouterAddress } from "../../data/rfq/swaps";
import type { PoolAsset } from "../../data/rfq/deposits";
import { decodeFunctionData, encodeFunctionData, hashTypedData, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, setwiseRouterAbi } from "../../data/chain/abis";
import {
  buildAtomicSwapCalls,
  isSupportedSwapPair,
  maximumSwapInput,
  reverseSwapPair,
  validateFirmSwap,
} from "./model";

const poolAddress: Address = "0x1000000000000000000000000000000000000000";
const inputAddress: Address = "0x2000000000000000000000000000000000000000";
const outputAddress: Address = "0x3000000000000000000000000000000000000000";
const address: Address = "0x4000000000000000000000000000000000000000";
const routerAddress: Address = trustedRouterAddress;
const signerAccount = privateKeyToAccount(`0x${"a".repeat(64)}`);
const quoteId = `0x${"1".repeat(64)}` as const;
const inputAsset: PoolAsset = { address: inputAddress, decimals: 18, id: "USDT", index: 0, symbol: "USDT", weight: 50 };
const outputAsset: PoolAsset = { address: outputAddress, decimals: 18, id: "TOKEN", index: 1, symbol: "TOKEN", weight: 50 };
const inputAtomic = "10000000000000000000";
const outputAtomic = "2000000000000000000";
const deadline = Math.floor(Date.now() / 1_000) + 3_600;

const indicative = {
  input: { amount: "10", asset: "USDT", atomicAmount: inputAtomic, decimals: 18 },
  intent: "exact-input",
  output: { amount: "2", asset: "TOKEN", atomicAmount: outputAtomic, decimals: 18 },
} as SwapQuote;

const poolAuthorizationTypes = {
  SwapQuote: [
    { name: "payer", type: "address" },
    { name: "inputAsset", type: "address" },
    { name: "outputAsset", type: "address" },
    { name: "inputAmount", type: "uint256" },
    { name: "outputAmount", type: "uint256" },
    { name: "quoteId", type: "bytes32" },
    { name: "deadline", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
} as const;

const routerAuthorizationTypes = {
  SetwiseAuthorization: [
    { name: "chainId", type: "uint256" },
    { name: "router", type: "address" },
    { name: "pool", type: "address" },
    { name: "funder", type: "address" },
    { name: "recipient", type: "address" },
    { name: "assetIn", type: "address" },
    { name: "assetOut", type: "address" },
    { name: "nativeIn", type: "bool" },
    { name: "nativeOut", type: "bool" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOut", type: "uint256" },
    { name: "quoteId", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

async function makeFirm(options: {
  inputAtomic?: string;
  intent?: "exact-input" | "exact-output";
  nativeIn?: boolean;
  nativeOut?: boolean;
} = {}): Promise<FirmSwapQuote> {
  const finalInputAtomic = options.inputAtomic ?? inputAtomic;
  const nativeIn = options.nativeIn ?? false;
  const nativeOut = options.nativeOut ?? false;
  const packedDeadline = String(deadline);
  const poolSigningData = {
    domain: { chainId: 97, name: "SetwisePool", verifyingContract: poolAddress, version: "2.0.0" },
    message: { deadline: BigInt(packedDeadline), inputAmount: BigInt(finalInputAtomic), inputAsset: inputAddress, outputAmount: BigInt(outputAtomic), outputAsset: outputAddress, payer: routerAddress, quoteId, recipient: address },
    primaryType: "SwapQuote",
    types: poolAuthorizationTypes,
  } as const;
  const routerSigningData = {
    domain: { chainId: 97, name: "SetwiseRouter", verifyingContract: routerAddress, version: "1" },
    message: {
      amountIn: BigInt(finalInputAtomic), amountOut: BigInt(outputAtomic), assetIn: inputAddress, assetOut: outputAddress,
      chainId: 97n, deadline: BigInt(packedDeadline), funder: address, nativeIn, nativeOut,
      pool: poolAddress, quoteId, recipient: address, router: routerAddress,
    },
    primaryType: "SetwiseAuthorization",
    types: routerAuthorizationTypes,
  } as const;
  const [poolSignature, routerSignature] = await Promise.all([
    signerAccount.signTypedData(poolSigningData),
    signerAccount.signTypedData(routerSigningData),
  ]);
  const poolTypedData = {
    ...poolSigningData,
    message: { ...poolSigningData.message, deadline: packedDeadline, inputAmount: finalInputAtomic, outputAmount: outputAtomic },
    types: { SwapQuote: [...poolAuthorizationTypes.SwapQuote] },
  };
  const routerTypedData = {
    ...routerSigningData,
    message: { ...routerSigningData.message, amountIn: finalInputAtomic, amountOut: outputAtomic, chainId: 97, deadline: packedDeadline },
    types: { SetwiseAuthorization: [...routerAuthorizationTypes.SetwiseAuthorization] },
  };
  const routerSwap = {
    amountIn: finalInputAtomic,
    amountOut: outputAtomic,
    assetIn: inputAddress,
    assetOut: outputAddress,
    auxiliaryData: "0x" as const,
    deadline: packedDeadline,
    nativeIn,
    nativeOut,
    pool: poolAddress,
    quoteId,
    recipient: address,
    signature: poolSignature,
  };
  const base = {
    authorization: {
      digest: hashTypedData(poolSigningData),
      keyVersion: "current",
      router: {
        address: routerAddress,
        digest: hashTypedData(routerSigningData),
        funder: address,
        signature: routerSignature,
        signatureType: "eoa",
        typedData: routerTypedData,
      },
      signature: poolSignature,
      signatureType: "eoa",
      signer: signerAccount.address,
      typedData: poolTypedData,
    },
    createdAt: new Date((deadline - 10) * 1_000).toISOString(),
    execution: "router",
    executionDeadline: String(deadline),
    firmQuoteId: quoteId,
    guard: { inputTolerancePpm: "5000", maximumInputBalance: "1", minimumOutputBalance: "1", offchainInputBalance: "1", offchainOutputBalance: "1", outputTolerancePpm: "5000", packedDeadline },
    input: { ...indicative.input, atomicAmount: finalInputAtomic },
    intent: options.intent ?? "exact-input",
    mustSubmitBy: new Date(deadline * 1_000).toISOString(),
    operation: "swap",
    output: indicative.output,
    persisted: true,
    quoteType: "firm",
    requirements: { approvals: nativeIn ? [] : [{ minimumAtomicAmount: finalInputAtomic, spender: routerAddress, token: inputAddress }], sender: address },
    stateSnapshot: { blockHash: `0x${"2".repeat(64)}`, blockNumber: "1", blockTimestamp: "1", chainId: 97, poolAddress, poolId: "pool" },
    status: "executable",
    transaction: {
      adapter: {
        funder: address,
        swap: {
          ...routerSwap,
        },
      },
      chainId: 97,
      data: encodeFunctionData({
        abi: setwiseRouterAbi,
        functionName: "swapSetwise",
        args: [{
          ...routerSwap,
          amountIn: BigInt(routerSwap.amountIn),
          amountOut: BigInt(routerSwap.amountOut),
          deadline: BigInt(routerSwap.deadline),
        }, address, routerSignature],
      }),
      method: "swapSetwise",
      to: routerAddress,
      value: nativeIn ? finalInputAtomic : "0",
    },
    venues: [],
    warnings: [],
  } as unknown as FirmSwapQuote;
  return base;
}

function firm(overrides: Record<string, unknown> = {}): FirmSwapQuote {
  return { ...structuredClone(baseFirm), ...overrides };
}

const baseFirm = await makeFirm();

type EncodedSwapOverrides = Partial<{
  amountIn: bigint;
  amountOut: bigint;
  assetIn: Address;
  assetOut: Address;
  auxiliaryData: `0x${string}`;
  deadline: bigint;
  nativeIn: boolean;
  nativeOut: boolean;
  pool: Address;
  quoteId: `0x${string}`;
  recipient: Address;
  signature: `0x${string}`;
}>;

function replaceCalldata(
  value: FirmSwapQuote,
  swapOverrides: EncodedSwapOverrides = {},
  funder: Address = address,
  routerSignature: `0x${string}` = value.authorization.router.signature,
): void {
  const swap = value.transaction.adapter.swap;
  value.transaction.data = encodeFunctionData({
    abi: setwiseRouterAbi,
    functionName: "swapSetwise",
    args: [{
      pool: swap.pool,
      assetIn: swap.assetIn,
      assetOut: swap.assetOut,
      nativeIn: swap.nativeIn,
      nativeOut: swap.nativeOut,
      amountIn: BigInt(swap.amountIn),
      amountOut: BigInt(swap.amountOut),
      quoteId: swap.quoteId,
      deadline: BigInt(swap.deadline),
      recipient: swap.recipient,
      signature: swap.signature,
      auxiliaryData: swap.auxiliaryData,
      ...swapOverrides,
    }, funder, routerSignature],
  });
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
  quoteSigner: signerAccount.address,
  routerAddress,
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

  it("accepts a fully matching ERC-20 router firm quote", async () => {
    await expect(validateFirmSwap(validInput())).resolves.toBeUndefined();
  });

  it("validates the confirmed BSC testnet Router quote fixture from decoded calldata", async () => {
    const live = firmSwapQuoteSchema.parse(liveRouterFirmQuote);
    const liveInputAsset: PoolAsset = { address: live.authorization.typedData.message.inputAsset, decimals: live.input.decimals, id: live.input.asset, index: 0, symbol: live.input.asset, weight: 50 };
    const liveOutputAsset: PoolAsset = { address: live.authorization.typedData.message.outputAsset, decimals: live.output.decimals, id: live.output.asset, index: 1, symbol: live.output.asset, weight: 50 };
    const liveIndicative = { input: live.input, intent: live.intent, output: live.output } as SwapQuote;

    await expect(validateFirmSwap({
      address: live.requirements.sender,
      allowance: BigInt(live.input.atomicAmount),
      balance: BigInt(live.input.atomicAmount),
      chainId: live.transaction.chainId,
      firm: live,
      indicative: liveIndicative,
      inputAsset: liveInputAsset,
      inputNative: false,
      now: 0,
      outputAsset: liveOutputAsset,
      outputNative: false,
      poolAddress: live.stateSnapshot.poolAddress,
      poolId: live.stateSnapshot.poolId,
      quoteSigner: live.authorization.signer,
      routerAddress,
    })).resolves.toBeUndefined();
  });

  it("accepts a higher firm input when the reviewed exact output is unchanged", async () => {
    const higherInput = (BigInt(inputAtomic) + 1n).toString();
    const exactOutputIndicative = { ...indicative, intent: "exact-output" } as SwapQuote;
    const exactOutputFirm = await makeFirm({ inputAtomic: higherInput, intent: "exact-output" });

    await expect(validateFirmSwap({
      ...validInput(),
      allowance: BigInt(higherInput),
      balance: BigInt(higherInput),
      firm: exactOutputFirm,
      indicative: exactOutputIndicative,
    })).resolves.toBeUndefined();
  });

  it("validates and constructs an exact planned approval before the firm swap", async () => {
    await expect(validateFirmSwap({
      ...validInput(),
      allowance: 0n,
      plannedApprovalAmount: BigInt(inputAtomic),
    })).resolves.toBeUndefined();
    await expect(validateFirmSwap({
      ...validInput(),
      allowance: 0n,
      plannedApprovalAmount: BigInt(inputAtomic) + 1n,
    })).rejects.toThrow(/not exact/);

    const calls = buildAtomicSwapCalls({ firm: firm(), inputAsset, now: 0, routerAddress });
    expect(calls).toHaveLength(2);
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0].data })).toEqual({
      args: [routerAddress, BigInt(inputAtomic)],
      functionName: "approve",
    });
    expect(decodeFunctionData({ abi: setwiseRouterAbi, data: calls[1].data }).functionName).toBe("swapSetwise");
    expect(calls[1]).toEqual(expect.objectContaining({ to: routerAddress, value: 0n }));
  });

  it.each([
    ["wrong chain", (value: ReturnType<typeof validInput>) => ({ ...value, chainId: 56 })],
    ["wrong sender", (value: ReturnType<typeof validInput>) => ({ ...value, address: outputAddress })],
    ["wrong Set", (value: ReturnType<typeof validInput>) => ({ ...value, poolAddress: outputAddress })],
    ["wrong Router target", (value: ReturnType<typeof validInput>) => ({ ...value, firm: firm({ transaction: { ...firm().transaction, to: poolAddress } }) })],
    ["wrong pool payer", (value: ReturnType<typeof validInput>) => ({ ...value, firm: firm({ authorization: { ...firm().authorization, typedData: { ...firm().authorization.typedData, message: { ...firm().authorization.typedData.message, payer: address } } } }) })],
    ["wrong approval spender", (value: ReturnType<typeof validInput>) => ({ ...value, firm: firm({ requirements: { approvals: [{ minimumAtomicAmount: inputAtomic, spender: poolAddress, token: inputAddress }], sender: address } }) })],
    ["wrong pair", (value: ReturnType<typeof validInput>) => ({ ...value, outputAsset: inputAsset })],
    ["wrong amount", (value: ReturnType<typeof validInput>) => ({ ...value, indicative: { ...indicative, input: { ...indicative.input, atomicAmount: "1" } } })],
    ["wrong value", (value: ReturnType<typeof validInput>) => ({ ...value, firm: firm({ transaction: { ...firm().transaction, value: "1" } }) })],
    ["wrong native mode", (value: ReturnType<typeof validInput>) => ({ ...value, firm: firm({ transaction: { ...firm().transaction, adapter: { ...firm().transaction.adapter, swap: { ...firm().transaction.adapter.swap, nativeOut: true } } } }) })],
    ["insufficient approval", (value: ReturnType<typeof validInput>) => ({ ...value, allowance: BigInt(inputAtomic) - 1n })],
    ["expired deadline", (value: ReturnType<typeof validInput>) => ({ ...value, now: deadline * 1_000 })],
  ])("rejects a firm response with %s", async (_name, mutate) => {
    await expect(validateFirmSwap(mutate(validInput()) as Parameters<typeof validateFirmSwap>[0])).rejects.toThrow();
  });

  it.each<[string, (value: FirmSwapQuote) => void]>([
    ["transaction chain", (q) => { q.transaction.chainId = 56; }],
    ["snapshot chain", (q) => { q.stateSnapshot.chainId = 56; }],
    ["Set domain chain", (q) => { q.authorization.typedData.domain.chainId = 56; }],
    ["Router domain chain", (q) => { q.authorization.router.typedData.domain.chainId = 56; }],
    ["Router message chain", (q) => { q.authorization.router.typedData.message.chainId = 56; }],
    ["Set ID", (q) => { q.stateSnapshot.poolId = "other-set"; }],
    ["Set snapshot address", (q) => { q.stateSnapshot.poolAddress = outputAddress; }],
    ["Set domain address", (q) => { q.authorization.typedData.domain.verifyingContract = outputAddress; }],
    ["Router message Set", (q) => { q.authorization.router.typedData.message.pool = outputAddress; }],
    ["calldata Set", (q) => replaceCalldata(q, { pool: outputAddress })],
    ["Router target", (q) => { q.transaction.to = poolAddress; }],
    ["Router authorization address", (q) => { q.authorization.router.address = poolAddress; }],
    ["Router domain address", (q) => { q.authorization.router.typedData.domain.verifyingContract = poolAddress; }],
    ["Router message address", (q) => { q.authorization.router.typedData.message.router = poolAddress; }],
    ["requirements sender", (q) => { q.requirements.sender = outputAddress; }],
    ["Set payer", (q) => { q.authorization.typedData.message.payer = address; }],
    ["Set recipient", (q) => { q.authorization.typedData.message.recipient = outputAddress; }],
    ["Router funder metadata", (q) => { q.authorization.router.funder = outputAddress; }],
    ["Router message funder", (q) => { q.authorization.router.typedData.message.funder = outputAddress; }],
    ["Router message recipient", (q) => { q.authorization.router.typedData.message.recipient = outputAddress; }],
    ["calldata funder", (q) => replaceCalldata(q, {}, outputAddress)],
    ["calldata recipient", (q) => replaceCalldata(q, { recipient: outputAddress })],
    ["Set signer", (q) => { q.authorization.signer = outputAddress; }],
    ["key version", (q) => { q.authorization.keyVersion = "previous"; }],
    ["Set signature type", (q) => { q.authorization.signatureType = "erc1271"; }],
    ["Router signature type", (q) => { q.authorization.router.signatureType = "erc1271"; }],
    ["Set domain name", (q) => { q.authorization.typedData.domain.name = "Other"; }],
    ["Router domain version", (q) => { q.authorization.router.typedData.domain.version = "2"; }],
    ["Set typed-data fields", (q) => { q.authorization.typedData.types.SwapQuote[0] = { name: "recipient", type: "address" }; }],
    ["Router typed-data fields", (q) => { q.authorization.router.typedData.types.SetwiseAuthorization[0] = { name: "router", type: "address" }; }],
    ["Set input asset", (q) => { q.authorization.typedData.message.inputAsset = outputAddress; }],
    ["Router output asset", (q) => { q.authorization.router.typedData.message.assetOut = inputAddress; }],
    ["calldata input asset", (q) => replaceCalldata(q, { assetIn: outputAddress })],
    ["Set input amount", (q) => { q.authorization.typedData.message.inputAmount = "1"; }],
    ["Router output amount", (q) => { q.authorization.router.typedData.message.amountOut = "1"; }],
    ["calldata input amount", (q) => replaceCalldata(q, { amountIn: 1n })],
    ["Router native-in mode", (q) => { q.authorization.router.typedData.message.nativeIn = true; }],
    ["calldata native-out mode", (q) => replaceCalldata(q, { nativeOut: true })],
    ["Set quote ID", (q) => { q.authorization.typedData.message.quoteId = `0x${"2".repeat(64)}`; }],
    ["Router quote ID", (q) => { q.authorization.router.typedData.message.quoteId = `0x${"2".repeat(64)}`; }],
    ["calldata quote ID", (q) => replaceCalldata(q, { quoteId: `0x${"2".repeat(64)}` })],
    ["packed deadline", (q) => { q.guard.packedDeadline = String(deadline + 1); }],
    ["Set deadline", (q) => { q.authorization.typedData.message.deadline = String(deadline + 1); }],
    ["Router deadline", (q) => { q.authorization.router.typedData.message.deadline = String(deadline + 1); }],
    ["calldata deadline", (q) => replaceCalldata(q, { deadline: BigInt(deadline + 1) })],
    ["execution deadline", (q) => { q.executionDeadline = String(deadline + 1); }],
    ["submission deadline", (q) => { q.mustSubmitBy = new Date((deadline + 1) * 1_000).toISOString(); }],
    ["Set signature", (q) => { q.authorization.signature = `0x${"1".repeat(130)}`; }],
    ["Router signature", (q) => { q.authorization.router.signature = `0x${"1".repeat(130)}`; }],
    ["calldata Set signature", (q) => replaceCalldata(q, { signature: "0xabcd" })],
    ["calldata Router signature", (q) => replaceCalldata(q, {}, address, "0xabcd")],
    ["adapter funder", (q) => { q.transaction.adapter.funder = outputAddress; }],
    ["adapter auxiliary data", (q) => { q.transaction.adapter.swap.auxiliaryData = "0xabcd"; }],
    ["approval token", (q) => { q.requirements.approvals[0].token = outputAddress; }],
    ["approval spender", (q) => { q.requirements.approvals[0].spender = poolAddress; }],
    ["approval amount", (q) => { q.requirements.approvals[0].minimumAtomicAmount = "1"; }],
    ["transaction value", (q) => { q.transaction.value = "1"; }],
    ["unknown method selector", (q) => { q.transaction.data = `0xdeadbeef${q.transaction.data.slice(10)}`; }],
    ["ambiguous trailing calldata", (q) => { q.transaction.data = `${q.transaction.data}00`; }],
  ])("rejects a one-field mutation of %s", async (_field, mutate) => {
    const mutated = firm();
    mutate(mutated);
    await expect(validateFirmSwap({ ...validInput(), firm: mutated })).rejects.toThrow();
  });

  it("accepts native input without approval only with exact transaction value", async () => {
    const nativeFirm = await makeFirm({ nativeIn: true });
    await expect(validateFirmSwap({ ...validInput(), allowance: 0n, firm: nativeFirm, inputNative: true })).resolves.toBeUndefined();
  });

  it("accepts swapSetwise execution for native output without native value", async () => {
    const nativeOutputFirm = await makeFirm({ nativeOut: true });
    await expect(validateFirmSwap({ ...validInput(), firm: nativeOutputFirm, outputNative: true })).resolves.toBeUndefined();
  });
});
