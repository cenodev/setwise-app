import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { encodeFunctionData, hashTypedData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { setwiseRouterAbi } from "../../data/chain/abis";
import { trustedRouterAddress } from "../../data/rfq/swaps";
import { SwapPage } from "./SwapPage";

type AtomicTestCall = { data: `0x${string}`; to: `0x${string}`; value: bigint };

const mocks = vi.hoisted(() => ({
  allowances: Object.fromEntries<bigint>([]),
  chainError: null as Error | null,
  chainRefetch: vi.fn(),
  atomicCapability: "unsupported",
  batchStatus: null as null | {
    atomic: boolean;
    chainId: number;
    receipts?: { status: string; transactionHash: `0x${string}` }[];
    status: string;
  },
  batchStatusError: null as Error | null,
  batchStatusRefetch: vi.fn(),
  capabilityRefetch: vi.fn(),
  call: vi.fn(),
  createActivity: vi.fn(),
  getCode: vi.fn(),
  markActivityFailed: vi.fn(),
  markActivityPending: vi.fn(),
  markActivitySuccessful: vi.fn(),
  poolStateRefetch: vi.fn(),
  registryPools: [] as unknown[],
  requestFirmSwapQuote: vi.fn(),
  requestSwapQuote: vi.fn(),
  saveActivity: vi.fn(),
  sendTransaction: vi.fn(),
  sendCalls: vi.fn<(input: { calls: AtomicTestCall[] }) => Promise<{ id: string }>>(),
  firmInputDelta: 0n,
  tradingPaused: false,
  waitForTransactionReceipt: vi.fn(),
  writeContract: vi.fn(),
}));

const poolAddress = "0x1000000000000000000000000000000000000000";
const wallet = "0x2000000000000000000000000000000000000000";
const wrappedAddress = "0x3000000000000000000000000000000000000000";
const usdtAddress = "0x4000000000000000000000000000000000000000";
const tokenAddress = "0x5000000000000000000000000000000000000000";
const signerAccount = privateKeyToAccount(`0x${"b".repeat(64)}`);
const approvalHash = `0x${"a".repeat(64)}` as const;
const swapHash = `0x${"b".repeat(64)}` as const;

const assets = [
  { address: usdtAddress, decimals: 18, id: "USDT", index: 0, name: "Tether USD", symbol: "USDT", weight: 40 },
  { address: tokenAddress, decimals: 18, id: "TOKEN", index: 1, name: "Tokenized Asset", symbol: "TOKEN", weight: 40 },
  { address: wrappedAddress, decimals: 18, id: "WBNB", index: 2, name: "Wrapped BNB", symbol: "WBNB", weight: 20 },
];

const pool = {
  assets,
  capabilities: { nativeAsset: true, swaps: { exactInput: true, exactOutput: true, firm: true, indicative: true } },
  chain: { id: 97, name: "BSC Testnet" },
  contract: { address: poolAddress },
  id: "bstock-ai-no-bnb-bsc-testnet",
  lpToken: { address: poolAddress, decimals: 18, symbol: "SETWISE" },
  pairs: [
    { assets: ["USDT", "TOKEN"], enabled: true, feeBps: 10 },
    { assets: ["WBNB", "TOKEN"], enabled: true, feeBps: 10 },
  ],
  quotePolicy: { allowedLockDays: [0] },
};

const secondPoolAddress = "0x6000000000000000000000000000000000000000";
const secondAssetAAddress = "0x7000000000000000000000000000000000000000";
const secondAssetBAddress = "0x8000000000000000000000000000000000000000";
const secondAssets = [
  { address: secondAssetAAddress, decimals: 18, id: "ALPHA", index: 0, name: "Alpha Token", symbol: "ALPHA", weight: 50 },
  { address: secondAssetBAddress, decimals: 18, id: "BETA", index: 1, name: "Beta Token", symbol: "BETA", weight: 50 },
];
const secondPool = {
  assets: secondAssets,
  capabilities: { nativeAsset: false, swaps: { exactInput: true, exactOutput: true, firm: true, indicative: true } },
  chain: { id: 97, name: "BSC Testnet" },
  contract: { address: secondPoolAddress },
  id: "second-set-bsc-testnet",
  lpToken: { address: secondPoolAddress, decimals: 18, symbol: "SETWISE-2" },
  pairs: [{ assets: ["ALPHA", "BETA"], enabled: true, feeBps: 15 }],
  quotePolicy: { allowedLockDays: [0] },
};

function poolState() {
  return {
    assets: assets.map((asset) => ({ asset: asset.id, index: asset.index, market: { askUsd: "1", bidUsd: "1" } })),
    chainId: 97,
    contract: { quoteSigner: signerAccount.address, wrappedNativeToken: wrappedAddress },
    poolAddress,
    poolId: pool.id,
    trading: { deposits: "available", paused: mocks.tradingPaused, swaps: mocks.tradingPaused ? "paused" : "available" },
  };
}

function secondPoolState() {
  return {
    assets: secondAssets.map((asset) => ({ asset: asset.id, index: asset.index, market: { askUsd: "1", bidUsd: "1" } })),
    chainId: 97,
    contract: { quoteSigner: secondAssetBAddress, wrappedNativeToken: secondAssetAAddress },
    poolAddress: secondPoolAddress,
    poolId: secondPool.id,
    trading: { deposits: "available", paused: false, swaps: "available" },
  };
}

function chainData() {
  return {
    assets: Object.fromEntries(assets.map((asset) => [asset.id, {
      allowance: mocks.allowances[asset.id] ?? 0n,
      balance: 1_000n * 10n ** 18n,
    }])),
    nativeBalance: 10n * 10n ** 18n,
  };
}

function indicative(
  inputAsset: string,
  outputAsset: string,
  specifiedAmount: string,
  intent: "exact-input" | "exact-output" = "exact-input",
) {
  const specifiedAtomic = BigInt(specifiedAmount.replace(".", "").padEnd(specifiedAmount.includes(".") ? 19 : specifiedAmount.length + 18, "0"));
  const inputAtomic = intent === "exact-input" ? specifiedAtomic : specifiedAtomic / 2n;
  const outputAtomic = intent === "exact-input" ? specifiedAtomic * 2n : specifiedAtomic;
  const inputAmount = intent === "exact-input" ? specifiedAmount : (Number(specifiedAmount) / 2).toString();
  const outputAmount = intent === "exact-input" ? (Number(specifiedAmount) * 2).toString() : specifiedAmount;
  const now = Date.now();
  return {
    economics: {
      effectiveRate: "2",
      fairRate: "2.01",
      fee: { asset: inputAsset, bps: 10, indicativeAtomicAmount: (inputAtomic / 1_000n).toString(), type: "curve-input-adjustment" },
      inputValueUsd: `${inputAmount}.00`,
      outputValueUsd: `${outputAmount}.00`,
      priceImpactBps: 5,
    },
    indicativeQuoteId: `indicative-${inputAmount}`,
    input: { amount: inputAmount, asset: inputAsset, atomicAmount: inputAtomic.toString(), decimals: 18 },
    intent,
    marketSnapshot: [],
    operation: "swap",
    output: { amount: outputAmount, asset: outputAsset, atomicAmount: outputAtomic.toString(), decimals: 18 },
    pricedAt: new Date(now).toISOString(),
    pricing: { venues: [] },
    quoteType: "indicative",
    stateSnapshot: { chainId: 97, poolAddress, poolId: pool.id, tradingPaused: mocks.tradingPaused },
    validUntil: new Date(now + 60_000).toISOString(),
    warnings: [],
  };
}

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

async function firm(input: {
  inputAmount?: string;
  inputAsset: string;
  inputNative: boolean;
  outputAsset: string;
  outputAmount?: string;
  outputNative: boolean;
  payer: string;
}, expired = false) {
  const intent = input.inputAmount !== undefined ? "exact-input" : "exact-output";
  const specifiedAmount = input.inputAmount ?? input.outputAmount;
  if (specifiedAmount === undefined) throw new Error("Firm request needs an input or output amount");
  const preview = indicative(input.inputAsset, input.outputAsset, specifiedAmount, intent);
  const finalInputAtomic = (BigInt(preview.input.atomicAmount) + mocks.firmInputDelta).toString();
  const finalInput = { ...preview.input, atomicAmount: finalInputAtomic };
  const inputMetadata = assets.find((asset) => asset.id === input.inputAsset)!;
  const outputMetadata = assets.find((asset) => asset.id === input.outputAsset)!;
  const deadline = Math.floor(Date.now() / 1_000) + (expired ? -1 : 60);
  const packedDeadline = String(deadline);
  const quoteId = `0x${"1".repeat(64)}`;
  const routerSwap = {
    amountIn: finalInputAtomic,
    amountOut: preview.output.atomicAmount,
    assetIn: inputMetadata.address,
    assetOut: outputMetadata.address,
    deadline: packedDeadline,
    nativeIn: input.inputNative,
    nativeOut: input.outputNative,
    pool: poolAddress,
    quoteId,
    recipient: input.payer,
  };
  const poolSigningData = {
    domain: { chainId: 97, name: "SetwisePool", verifyingContract: poolAddress as Address, version: "2.0.0" },
    message: { deadline: BigInt(packedDeadline), inputAmount: BigInt(finalInputAtomic), inputAsset: inputMetadata.address as Address, outputAmount: BigInt(preview.output.atomicAmount), outputAsset: outputMetadata.address as Address, payer: trustedRouterAddress, quoteId: quoteId as Hex, recipient: input.payer as Address },
    primaryType: "SwapQuote",
    types: poolAuthorizationTypes,
  } as const;
  const routerSigningData = {
    domain: { chainId: 97, name: "SetwiseRouter", verifyingContract: trustedRouterAddress, version: "1" },
    message: {
      ...routerSwap,
      amountIn: BigInt(routerSwap.amountIn),
      amountOut: BigInt(routerSwap.amountOut),
      assetIn: routerSwap.assetIn as Address,
      assetOut: routerSwap.assetOut as Address,
      chainId: 97n,
      deadline: BigInt(routerSwap.deadline),
      funder: input.payer as Address,
      pool: routerSwap.pool as Address,
      quoteId: routerSwap.quoteId as Hex,
      recipient: routerSwap.recipient as Address,
      router: trustedRouterAddress,
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
    message: { ...poolSigningData.message, deadline: packedDeadline, inputAmount: finalInputAtomic, outputAmount: preview.output.atomicAmount },
    types: { SwapQuote: [...poolAuthorizationTypes.SwapQuote] },
  };
  const routerTypedData = {
    ...routerSigningData,
    message: { ...routerSigningData.message, amountIn: finalInputAtomic, amountOut: preview.output.atomicAmount, chainId: 97, deadline: packedDeadline },
    types: { SetwiseAuthorization: [...routerAuthorizationTypes.SetwiseAuthorization] },
  };
  return {
    authorization: {
      digest: hashTypedData(poolSigningData),
      keyVersion: "current",
      router: {
        address: trustedRouterAddress,
        digest: hashTypedData(routerSigningData),
        funder: input.payer,
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
    input: finalInput,
    intent,
    mustSubmitBy: new Date(deadline * 1_000).toISOString(),
    operation: "swap",
    output: preview.output,
    persisted: true,
    quoteType: "firm",
    requirements: {
      approvals: input.inputNative ? [] : [{ minimumAtomicAmount: finalInputAtomic, spender: trustedRouterAddress, token: inputMetadata.address }],
      sender: input.payer,
    },
    stateSnapshot: { blockHash: `0x${"2".repeat(64)}`, blockNumber: "1", blockTimestamp: "1", chainId: 97, poolAddress, poolId: pool.id },
    status: "executable",
    transaction: {
      adapter: { funder: input.payer, swap: { ...routerSwap, auxiliaryData: "0x", signature: poolSignature } },
      chainId: 97,
      data: encodeFunctionData({
        abi: setwiseRouterAbi,
        functionName: "swapSetwise",
        args: [{
          ...routerSwap,
          pool: routerSwap.pool as Address,
          assetIn: routerSwap.assetIn as Address,
          assetOut: routerSwap.assetOut as Address,
          amountIn: BigInt(routerSwap.amountIn),
          amountOut: BigInt(routerSwap.amountOut),
          quoteId: routerSwap.quoteId as Hex,
          deadline: BigInt(routerSwap.deadline),
          recipient: routerSwap.recipient as Address,
          signature: poolSignature,
          auxiliaryData: "0x",
        }, input.payer as Address, routerSignature],
      }),
      method: "swapSetwise",
      to: trustedRouterAddress,
      value: input.inputNative ? finalInputAtomic : "0",
    },
    venues: [],
    warnings: [],
  };
}

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    const key = options.queryKey[0];
    const poolId = options.queryKey[1];
    if (key === "sets" && options.queryKey.length === 1) return { data: mocks.registryPools, error: null, isPending: false, refetch: vi.fn().mockResolvedValue({ data: mocks.registryPools }) };
    if (key === "sets" && options.queryKey.length === 2) {
      const target = poolId === secondPool.id ? secondPool : pool;
      return { data: target, error: null, isPending: false, refetch: vi.fn().mockResolvedValue({ data: target }) };
    }
    if (key === "sets" && options.queryKey[2] === "state") {
      if (poolId === secondPool.id) {
        return { data: secondPoolState(), error: null, isPending: false, refetch: mocks.poolStateRefetch };
      }
      return { data: poolState(), error: null, isPending: false, refetch: mocks.poolStateRefetch };
    }
    return { data: chainData(), error: mocks.chainError, isPending: false, refetch: mocks.chainRefetch };
  },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: wallet, chainId: 97, connector: { id: "test-wallet", uid: "connector-1" } }),
  useCapabilities: () => ({
    data: { atomic: { status: mocks.atomicCapability } },
    isError: false,
    isFetched: true,
    refetch: mocks.capabilityRefetch,
  }),
  usePublicClient: () => ({
    call: mocks.call,
    getCode: mocks.getCode,
    waitForTransactionReceipt: mocks.waitForTransactionReceipt,
  }),
  useSendCalls: () => ({ sendCallsAsync: mocks.sendCalls }),
  useSendTransaction: () => ({ sendTransactionAsync: mocks.sendTransaction }),
  useWaitForCallsStatus: () => ({
    data: mocks.batchStatus,
    error: mocks.batchStatusError,
    isFetching: false,
    refetch: mocks.batchStatusRefetch,
  }),
  useWriteContract: () => ({ writeContractAsync: mocks.writeContract }),
}));

vi.mock("../../data/rfq/swaps", (importOriginal) =>
  importOriginal<typeof import("../../data/rfq/swaps")>().then((original) => ({
    ...original,
    createSwapIdempotencyKey: () => "swap:test",
    requestFirmSwapQuote: mocks.requestFirmSwapQuote,
    requestSwapQuote: mocks.requestSwapQuote,
  })));

vi.mock("../activity/store", () => ({
  createSwapActivity: mocks.createActivity,
  markActivityFailed: mocks.markActivityFailed,
  markActivityPending: mocks.markActivityPending,
  markActivitySuccessful: mocks.markActivitySuccessful,
  saveActivity: mocks.saveActivity,
}));

async function enterAmount(value = "10") {
  render(<MemoryRouter><SwapPage /></MemoryRouter>);
  fireEvent.change(screen.getByRole("textbox", { name: "You pay amount" }), { target: { value } });
  const review = await screen.findByRole("button", { name: "Review swap" });
  await waitFor(() => expect(review).toBeEnabled());
  return review;
}

async function executeReviewedSwap(review: HTMLElement) {
  fireEvent.click(review);
  const confirm = await screen.findByRole("button", { name: /swap|atomically/i });
  fireEvent.click(confirm);
}

describe("SwapPage", () => {
  beforeEach(() => {
    mocks.allowances = { TOKEN: 1_000n * 10n ** 18n, USDT: 0n, WBNB: 1_000n * 10n ** 18n };
    mocks.atomicCapability = "unsupported";
    mocks.registryPools = [pool, secondPool];
    mocks.batchStatus = {
      atomic: true,
      chainId: 97,
      receipts: [{ status: "success", transactionHash: swapHash }],
      status: "success",
    };
    mocks.batchStatusError = null;
    mocks.firmInputDelta = 0n;
    mocks.chainError = null;
    mocks.tradingPaused = false;
    mocks.chainRefetch.mockReset().mockImplementation(() => Promise.resolve({ data: chainData() }));
    mocks.poolStateRefetch.mockReset().mockImplementation(() => Promise.resolve({ data: poolState() }));
    mocks.capabilityRefetch.mockReset().mockImplementation(() => Promise.resolve({
      data: { atomic: { status: mocks.atomicCapability } },
    }));
    mocks.batchStatusRefetch.mockReset().mockResolvedValue(undefined);
    mocks.requestSwapQuote.mockReset().mockImplementation(({
      inputAmount, inputAsset, outputAmount, outputAsset,
    }: { inputAmount?: string; inputAsset: string; outputAmount?: string; outputAsset: string }) => {
      const intent = inputAmount !== undefined ? "exact-input" : "exact-output";
      return Promise.resolve(indicative(inputAsset, outputAsset, inputAmount ?? outputAmount ?? "", intent));
    });
    mocks.requestFirmSwapQuote.mockReset().mockImplementation((input: Parameters<typeof firm>[0]) => firm(input));
    mocks.writeContract.mockReset().mockImplementation(({ address, args }: { address: string; args: readonly [string, bigint] }) => {
      const asset = assets.find((candidate) => candidate.address === address)!;
      mocks.allowances[asset.id] = args[1];
      return Promise.resolve(approvalHash);
    });
    mocks.sendTransaction.mockReset().mockResolvedValue(swapHash);
    mocks.sendCalls.mockReset().mockResolvedValue({ id: "batch-1" });
    mocks.call.mockReset().mockResolvedValue({ data: "0x" });
    mocks.getCode.mockReset().mockResolvedValue("0x6000");
    mocks.waitForTransactionReceipt.mockReset().mockResolvedValue({ status: "success" });
    mocks.createActivity.mockReset().mockImplementation((input: object) => ({ ...input, id: "activity-1", operation: "swap", timestamp: 1 }));
    mocks.markActivityFailed.mockReset();
    mocks.markActivityPending.mockReset();
    mocks.markActivitySuccessful.mockReset();
    mocks.saveActivity.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("debounces edits and prevents an obsolete quote response from overwriting the latest amount", async () => {
    let resolveFirst!: (value: ReturnType<typeof indicative>) => void;
    const first = new Promise<ReturnType<typeof indicative>>((resolve) => { resolveFirst = resolve; });
    mocks.requestSwapQuote.mockReset()
      .mockReturnValueOnce(first)
      .mockImplementation(({
        inputAmount, inputAsset, outputAsset,
      }: { inputAmount: string; inputAsset: string; outputAsset: string }) => Promise.resolve(indicative(inputAsset, outputAsset, inputAmount)));
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    const input = screen.getByRole("textbox", { name: "You pay amount" });

    fireEvent.change(input, { target: { value: "10" } });
    await waitFor(() => expect(mocks.requestSwapQuote).toHaveBeenCalledTimes(1), { timeout: 1_500 });
    fireEvent.change(input, { target: { value: "20" } });
    resolveFirst(indicative("USDT", "TOKEN", "10"));

    await waitFor(() => expect(mocks.requestSwapQuote).toHaveBeenCalledTimes(2), { timeout: 1_500 });
    await waitFor(() => expect(screen.getByLabelText("You receive amount")).toHaveTextContent("40 TOKEN"));
    expect(screen.getByLabelText("You receive amount")).not.toHaveTextContent("20 TOKEN");
  });

  it("validates a firm quote before confirming an exact ERC-20 approval and submitting", async () => {
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    await screen.findByRole("button", { name: "New swap" });
    expect(mocks.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      args: [trustedRouterAddress, 10n * 10n ** 18n],
      functionName: "approve",
    }));
    expect(mocks.requestFirmSwapQuote.mock.invocationCallOrder[0]).toBeLessThan(mocks.writeContract.mock.invocationCallOrder[0]);
    expect(mocks.writeContract.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendTransaction.mock.invocationCallOrder[0]);
    expect(mocks.markActivitySuccessful).toHaveBeenCalledWith("activity-1", swapHash);
    expect(mocks.chainRefetch.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(mocks.poolStateRefetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces the Set Router as the execution and exact approval target during review", async () => {
    const review = await enterAmount("10");
    fireEvent.click(review);

    const routing = await screen.findByLabelText("Router execution target");
    expect(routing).toHaveTextContent("Execution target");
    expect(routing).toHaveTextContent("Exact approval spender");
    expect(routing).toHaveTextContent("Set Router");
    expect(routing).toHaveTextContent(trustedRouterAddress);
    expect(screen.getByText(/allowance spender is the Set Router, never the Set contract/i)).toBeInTheDocument();
  });

  it("refreshes the consumed exact Router allowance to zero after a successful swap", async () => {
    mocks.sendTransaction.mockReset().mockImplementation(() => {
      mocks.allowances.USDT = 0n;
      return Promise.resolve(swapHash);
    });
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    await screen.findByRole("button", { name: "New swap" });
    const lastRefetch = mocks.chainRefetch.mock.results.at(-1)?.value as Promise<{ data: ReturnType<typeof chainData> }>;
    const refreshed = await lastRefetch;
    expect(refreshed.data.assets.USDT.allowance).toBe(0n);
  });

  it("never opens an approval or submission prompt for an invalid firm authorization", async () => {
    mocks.requestFirmSwapQuote.mockReset().mockImplementation(async (input: Parameters<typeof firm>[0]) => {
      const invalid = await firm(input);
      invalid.authorization.signer = tokenAddress;
      return invalid;
    });
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/signer/i);
    expect(mocks.writeContract).not.toHaveBeenCalled();
    expect(mocks.sendCalls).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("uses the fail-safe sequential preflight when an atomic wallet cannot simulate the stateful batch", async () => {
    mocks.atomicCapability = "supported";
    const review = await enterAmount("10");
    fireEvent.click(review);
    expect((await screen.findAllByText(/cannot simulate an approval-plus-swap batch/i)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Approve exact amount & swap" }));

    await screen.findByRole("button", { name: "New swap" });
    expect(mocks.sendCalls).not.toHaveBeenCalled();
    expect(mocks.writeContract).toHaveBeenCalledTimes(1);
    expect(mocks.call).toHaveBeenCalledWith(expect.objectContaining({
      account: wallet,
      to: trustedRouterAddress,
      value: 0n,
    }));
    expect(mocks.writeContract.mock.invocationCallOrder[0]).toBeLessThan(mocks.call.mock.invocationCallOrder[0]);
    expect(mocks.call.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendTransaction.mock.invocationCallOrder[0]);
  });

  it("approves the final exact-output input before simulating and submitting", async () => {
    mocks.atomicCapability = "ready";
    mocks.firmInputDelta = 1n * 10n ** 18n;
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Exact output" }));
    fireEvent.change(screen.getByRole("textbox", { name: "You receive amount" }), { target: { value: "20" } });
    const review = await screen.findByRole("button", { name: "Review swap" });
    await waitFor(() => expect(review).toBeEnabled());
    await executeReviewedSwap(review);

    await screen.findByRole("button", { name: "New swap" });
    expect(mocks.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      args: [trustedRouterAddress, 11n * 10n ** 18n],
    }));
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.sendCalls).not.toHaveBeenCalled();
  });

  it("blocks wallet submission when the configured Router has no code", async () => {
    mocks.allowances.USDT = 1_000n * 10n ** 18n;
    mocks.getCode.mockResolvedValueOnce(undefined);
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/no deployed code/i);
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.saveActivity).not.toHaveBeenCalled();
  });

  it("blocks wallet submission when Router simulation reports a paused Set", async () => {
    mocks.allowances.USDT = 1_000n * 10n ** 18n;
    mocks.call.mockRejectedValueOnce(new Error("execution reverted: trading paused"));
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/paused on chain/i);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.saveActivity).not.toHaveBeenCalled();
  });

  it("rechecks Set pause state between firm validation and preflight", async () => {
    mocks.allowances.USDT = 1_000n * 10n ** 18n;
    mocks.poolStateRefetch
      .mockResolvedValueOnce({ data: poolState() })
      .mockImplementationOnce(() => {
        mocks.tradingPaused = true;
        return Promise.resolve({ data: poolState() });
      });
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/paused/i);
    expect(mocks.getCode).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("invalidates a successful simulation when connectivity changes before submission", async () => {
    let online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    mocks.allowances.USDT = 1_000n * 10n ** 18n;
    mocks.call.mockImplementationOnce(async () => {
      online = false;
      window.dispatchEvent(new Event("offline"));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      return { data: "0x" };
    });
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/connectivity/i);
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("quotes and executes a user-specified exact output", async () => {
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Exact output" }));
    fireEvent.change(screen.getByRole("textbox", { name: "You receive amount" }), { target: { value: "20" } });

    const review = await screen.findByRole("button", { name: "Review swap" });
    await waitFor(() => expect(review).toBeEnabled());
    expect(mocks.requestSwapQuote).toHaveBeenCalledWith(expect.objectContaining({
      inputAsset: "USDT",
      outputAmount: "20",
      outputAsset: "TOKEN",
    }));
    expect(mocks.requestSwapQuote.mock.calls[0]?.[0]).not.toHaveProperty("inputAmount");
    expect(screen.getByLabelText("You pay amount")).toHaveTextContent("10 USDT");

    await executeReviewedSwap(review);

    await screen.findByRole("button", { name: "New swap" });
    expect(mocks.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      args: [trustedRouterAddress, 10n * 10n ** 18n],
    }));
    expect(mocks.requestFirmSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ outputAmount: "20" }));
    expect(mocks.requestFirmSwapQuote.mock.calls[0]?.[0]).not.toHaveProperty("inputAmount");
    expect(mocks.sendTransaction).toHaveBeenCalled();
  });

  it("approves a changed final firm input exactly before sequential Router execution", async () => {
    mocks.firmInputDelta = 1n * 10n ** 18n;
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Exact output" }));
    fireEvent.change(screen.getByRole("textbox", { name: "You receive amount" }), { target: { value: "20" } });
    const review = await screen.findByRole("button", { name: "Review swap" });
    await waitFor(() => expect(review).toBeEnabled());
    await executeReviewedSwap(review);

    await screen.findByRole("button", { name: "New swap" });
    expect(mocks.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      args: [trustedRouterAddress, 11n * 10n ** 18n],
    }));
    expect(mocks.requestFirmSwapQuote.mock.invocationCallOrder[0]).toBeLessThan(mocks.writeContract.mock.invocationCallOrder[0]);
    expect(mocks.writeContract.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendTransaction.mock.invocationCallOrder[0]);
  });

  it("never sends when the confirmed Router allowance remains below the final firm input", async () => {
    mocks.writeContract.mockReset().mockResolvedValue(approvalHash);
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/approval is insufficient/i);
    expect(mocks.requestFirmSwapQuote).toHaveBeenCalledTimes(1);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("skips approval for native input and submits the API's exact native transaction value", async () => {
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("combobox", { name: "You pay asset" }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "You pay asset" })).getByRole("button", { name: /WBNB.*Wrapped BNB/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Pay with native BNB" }));
    fireEvent.change(screen.getByRole("textbox", { name: "You pay amount" }), { target: { value: "0.1" } });
    const review = await screen.findByRole("button", { name: "Review swap" });
    await waitFor(() => expect(review).toBeEnabled());
    await executeReviewedSwap(review);

    await screen.findByRole("button", { name: "New swap" });
    expect(mocks.writeContract).not.toHaveBeenCalled();
    expect(mocks.requestFirmSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ inputNative: true, outputNative: false }));
    expect(mocks.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ value: 100_000_000_000_000_000n }));
  });

  it("sets outputNative for a token-to-BNB swap", async () => {
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("combobox", { name: "You pay asset" }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "You pay asset" })).getByRole("button", { name: /TOKEN.*Tokenized Asset/i }));
    fireEvent.click(screen.getByRole("combobox", { name: "You receive asset" }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "You receive asset" })).getByRole("button", { name: /WBNB.*Wrapped BNB/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Receive native BNB" }));
    fireEvent.change(screen.getByRole("textbox", { name: "You pay amount" }), { target: { value: "1" } });
    const review = await screen.findByRole("button", { name: "Review swap" });
    await waitFor(() => expect(review).toBeEnabled());
    await executeReviewedSwap(review);

    await screen.findByRole("button", { name: "New swap" });
    expect(mocks.requestFirmSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ inputNative: false, outputNative: true }));
    expect(mocks.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ value: 0n }));
  });

  it("reverses the selected pair and clears the exact-input draft", () => {
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox", { name: "You pay amount" }), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Reverse pair" }));

    expect(screen.getByRole("combobox", { name: "You pay asset" })).toHaveTextContent("TOKEN");
    expect(screen.getByRole("combobox", { name: "You receive asset" })).toHaveTextContent("USDT");
    expect(screen.getByRole("textbox", { name: "You pay amount" })).toHaveValue("");
  });

  it("never opens the wallet for expired executable calldata", async () => {
    mocks.requestFirmSwapQuote.mockReset().mockImplementation((input: Parameters<typeof firm>[0]) => firm(input, true));
    mocks.allowances.USDT = 1_000n * 10n ** 18n;
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
    expect(screen.getByRole("button", { name: "Refresh quote" })).toBeEnabled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.saveActivity).not.toHaveBeenCalled();
  });

  it("never submits an expired firm quote as an atomic batch", async () => {
    mocks.atomicCapability = "supported";
    mocks.requestFirmSwapQuote.mockReset().mockImplementation((input: Parameters<typeof firm>[0]) => firm(input, true));
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
    expect(mocks.sendCalls).not.toHaveBeenCalled();
    expect(mocks.writeContract).not.toHaveBeenCalled();
    expect(mocks.saveActivity).not.toHaveBeenCalled();
  });

  it("offers recovery after wallet rejection and records the failed operation", async () => {
    mocks.allowances.USDT = 1_000n * 10n ** 18n;
    mocks.sendTransaction.mockReset().mockRejectedValue(new Error("User rejected request"));
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(/Rejected in wallet/i);
    expect(error).toHaveTextContent(/Set Router target/i);
    expect(error).toHaveTextContent(trustedRouterAddress);
    expect(screen.getByRole("button", { name: "Try swap again" })).toBeEnabled();
    expect(mocks.markActivityFailed).toHaveBeenCalledWith("activity-1", expect.any(String), undefined);
  });

  it("offers retry after an approval rejection only after validating a firm quote", async () => {
    mocks.writeContract.mockReset().mockRejectedValue(new Error("User rejected request"));
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Rejected in wallet/i);
    expect(screen.getByRole("button", { name: "Try swap again" })).toBeEnabled();
    expect(mocks.requestFirmSwapQuote).toHaveBeenCalledTimes(1);
    expect(mocks.saveActivity).not.toHaveBeenCalled();
  });

  it("handles an on-chain revert with an explorer-linked failed activity record", async () => {
    mocks.allowances.USDT = 1_000n * 10n ** 18n;
    mocks.waitForTransactionReceipt.mockReset().mockResolvedValue({ status: "reverted" });
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/reverted on chain/i);
    expect(screen.getByRole("button", { name: "Try swap again" })).toBeEnabled();
    expect(screen.getByRole("link", { name: new RegExp(swapHash.slice(0, 6), "i") })).toHaveAttribute("href", expect.stringContaining(swapHash));
    expect(mocks.markActivityFailed).toHaveBeenCalledWith("activity-1", expect.any(String), swapHash);
  });

  it("maps an RFQ failure to a single pricing retry action", async () => {
    mocks.requestSwapQuote.mockReset().mockRejectedValue(new Error("RFQ unavailable"));
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox", { name: "You pay amount" }), { target: { value: "10" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("RFQ unavailable");
    expect(screen.getByRole("button", { name: "Retry pricing" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Review swap" })).toBeDisabled();
  });

  it("shows RPC load failure with a read retry", () => {
    mocks.chainError = new Error("RPC unavailable");
    render(<MemoryRouter><SwapPage /></MemoryRouter>);

    expect(screen.getByRole("alert")).toHaveTextContent("RPC unavailable");
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("recovers pricing automatically after an offline transition", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox", { name: "You pay amount" }), { target: { value: "10" } });
    expect(screen.getAllByText(/Offline — reconnect/).length).toBeGreaterThan(0);
    expect(mocks.requestSwapQuote).not.toHaveBeenCalled();

    online = true;
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(mocks.requestSwapQuote).toHaveBeenCalledTimes(1), { timeout: 1_500 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Review swap" })).toBeEnabled());
  });

  it("disables review with a clear paused-market reason", async () => {
    mocks.tradingPaused = true;
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox", { name: "You pay amount" }), { target: { value: "10" } });

    expect(await screen.findByText(/Trading is paused. Swaps are unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review swap" })).toBeDisabled();
    expect(mocks.requestSwapQuote).not.toHaveBeenCalled();
  });
});

describe("SwapPage multi-Set", () => {
  beforeEach(() => {
    mocks.allowances = { TOKEN: 1_000n * 10n ** 18n, USDT: 0n, WBNB: 1_000n * 10n ** 18n, ALPHA: 500n * 10n ** 18n, BETA: 500n * 10n ** 18n };
    mocks.atomicCapability = "unsupported";
    mocks.registryPools = [pool, secondPool];
    mocks.batchStatus = { atomic: true, chainId: 97, receipts: [{ status: "success", transactionHash: swapHash }], status: "success" };
    mocks.batchStatusError = null;
    mocks.firmInputDelta = 0n;
    mocks.chainError = null;
    mocks.tradingPaused = false;
    mocks.chainRefetch.mockReset().mockImplementation(() => Promise.resolve({ data: chainData() }));
    mocks.poolStateRefetch.mockReset().mockImplementation(() => Promise.resolve({ data: poolState() }));
    mocks.capabilityRefetch.mockReset().mockImplementation(() => Promise.resolve({ data: { atomic: { status: mocks.atomicCapability } } }));
    mocks.batchStatusRefetch.mockReset().mockResolvedValue(undefined);
    mocks.requestSwapQuote.mockReset().mockImplementation(({
      inputAmount, inputAsset, outputAmount, outputAsset,
    }: { inputAmount?: string; inputAsset: string; outputAmount?: string; outputAsset: string }) => {
      const intent = inputAmount !== undefined ? "exact-input" : "exact-output";
      return Promise.resolve(indicative(inputAsset, outputAsset, inputAmount ?? outputAmount ?? "", intent));
    });
    mocks.requestFirmSwapQuote.mockReset().mockImplementation((input: Parameters<typeof firm>[0]) => firm(input));
    mocks.writeContract.mockReset().mockResolvedValue(approvalHash);
    mocks.sendTransaction.mockReset().mockResolvedValue(swapHash);
    mocks.sendCalls.mockReset().mockResolvedValue({ id: "batch-1" });
    mocks.call.mockReset().mockResolvedValue({ data: "0x" });
    mocks.getCode.mockReset().mockResolvedValue("0x6000");
    mocks.waitForTransactionReceipt.mockReset().mockResolvedValue({ status: "success" });
    mocks.createActivity.mockReset().mockImplementation((input: object) => ({ ...input, id: "activity-1", operation: "swap", timestamp: 1 }));
    mocks.markActivityFailed.mockReset();
    mocks.markActivityPending.mockReset();
    mocks.markActivitySuccessful.mockReset();
    mocks.saveActivity.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("renders a Set selector populated from the registry", () => {
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    const select = screen.getByRole("combobox", { name: "Set" });
    expect(select).toBeEnabled();
    const options = within(select).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveValue(pool.id);
    expect(options[1]).toHaveValue(secondPool.id);
  });

  it("defaults to the configured pool when no ?set= param is present", () => {
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    const select = screen.getByRole("combobox", { name: "Set" });
    expect(select).toHaveValue(pool.id);
  });

  it("restores the selected Set from the ?set= deep link", () => {
    render(<MemoryRouter initialEntries={[`/swap?set=${secondPool.id}`]}><SwapPage /></MemoryRouter>);
    const select = screen.getByRole("combobox", { name: "Set" });
    expect(select).toHaveValue(secondPool.id);
  });

  it("restricts asset selectors to the selected Set's assets", () => {
    render(<MemoryRouter initialEntries={[`/swap?set=${secondPool.id}`]}><SwapPage /></MemoryRouter>);
    const inputSelector = screen.getByRole("combobox", { name: "You pay asset" });
    expect(inputSelector).toHaveTextContent("ALPHA");
    expect(inputSelector).not.toHaveTextContent("USDT");
  });

  it("shows an error for an unknown Set id with recovery", () => {
    render(<MemoryRouter initialEntries={["/swap?set=nonexistent"]}><SwapPage /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("Unknown Set");
    expect(screen.getByText("nonexistent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use default Set" })).toBeEnabled();
  });

  it("recovers from an unknown Set by switching to the default", () => {
    render(<MemoryRouter initialEntries={["/swap?set=nonexistent"]}><SwapPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Use default Set" }));
    expect(screen.getByRole("combobox", { name: "Set" })).toHaveValue(pool.id);
  });

  it("sends the selected Set's poolId on indicative quote requests", async () => {
    render(<MemoryRouter initialEntries={[`/swap?set=${secondPool.id}`]}><SwapPage /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox", { name: "You pay amount" }), { target: { value: "5" } });
    await waitFor(() => expect(mocks.requestSwapQuote).toHaveBeenCalledTimes(1), { timeout: 1_500 });
    expect(mocks.requestSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ poolId: secondPool.id }));
  });

  it("resets amount and quote state on Set change", async () => {
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox", { name: "You pay amount" }), { target: { value: "10" } });
    await waitFor(() => expect(mocks.requestSwapQuote).toHaveBeenCalledTimes(1), { timeout: 1_500 });

    fireEvent.change(screen.getByRole("combobox", { name: "Set" }), { target: { value: secondPool.id } });
    expect(screen.getByRole("textbox", { name: "You pay amount" })).toHaveValue("");
  });

  it("records Set identity in swap activity", async () => {
    mocks.allowances = { USDT: 1_000n * 10n ** 18n, TOKEN: 1_000n * 10n ** 18n, WBNB: 1_000n * 10n ** 18n };
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox", { name: "You pay amount" }), { target: { value: "10" } });
    const review = await screen.findByRole("button", { name: "Review swap" });
    await waitFor(() => expect(review).toBeEnabled());
    fireEvent.click(review);
    const confirm = await screen.findByRole("button", { name: /swap|atomically/i });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.createActivity).toHaveBeenCalledWith(expect.objectContaining({ setId: pool.id })));
  });

  it("disables the Set selector during wallet submission", async () => {
    mocks.allowances = { USDT: 1_000n * 10n ** 18n, TOKEN: 1_000n * 10n ** 18n, WBNB: 1_000n * 10n ** 18n };
    let resolveSend!: (value: string) => void;
    mocks.sendTransaction.mockReset().mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox", { name: "You pay amount" }), { target: { value: "10" } });
    const review = await screen.findByRole("button", { name: "Review swap" });
    await waitFor(() => expect(review).toBeEnabled());
    fireEvent.click(review);
    const confirm = await screen.findByRole("button", { name: /swap|atomically/i });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Set" })).toBeDisabled());
    resolveSend(swapHash);
  });
});
