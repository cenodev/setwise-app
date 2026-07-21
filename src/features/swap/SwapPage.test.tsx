import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { decodeFunctionData } from "viem";

import { erc20Abi } from "../../data/chain/abis";
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
  createActivity: vi.fn(),
  poolStateRefetch: vi.fn(),
  requestFirmSwapQuote: vi.fn(),
  requestSwapQuote: vi.fn(),
  saveActivity: vi.fn(),
  sendTransaction: vi.fn(),
  sendCalls: vi.fn<(input: { calls: AtomicTestCall[] }) => Promise<{ id: string }>>(),
  firmInputDelta: 0n,
  tradingPaused: false,
  updateActivity: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContract: vi.fn(),
}));

const poolAddress = "0x1000000000000000000000000000000000000000";
const wallet = "0x2000000000000000000000000000000000000000";
const wrappedAddress = "0x3000000000000000000000000000000000000000";
const usdtAddress = "0x4000000000000000000000000000000000000000";
const tokenAddress = "0x5000000000000000000000000000000000000000";
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

function poolState() {
  return {
    assets: assets.map((asset) => ({ asset: asset.id, index: asset.index, market: { askUsd: "1", bidUsd: "1" } })),
    chainId: 97,
    contract: { wrappedNativeToken: wrappedAddress },
    poolAddress,
    poolId: pool.id,
    trading: { deposits: "available", paused: mocks.tradingPaused, swaps: mocks.tradingPaused ? "paused" : "available" },
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

function firm(input: {
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
  const quoteId = `0x${"1".repeat(64)}`;
  return {
    authorization: {
      digest: quoteId,
      signature: "0x1234",
      signer: tokenAddress,
      typedData: {
        domain: { chainId: 97, name: "SetwisePool", verifyingContract: poolAddress, version: "2.0.0" },
        message: { deadline: "123", inputAmount: finalInputAtomic, inputAsset: inputMetadata.address, outputAmount: preview.output.atomicAmount, outputAsset: outputMetadata.address, payer: input.payer, quoteId, recipient: input.payer },
        primaryType: "SwapQuote",
        types: {},
      },
    },
    createdAt: new Date((deadline - 10) * 1_000).toISOString(),
    executionDeadline: String(deadline),
    firmQuoteId: quoteId,
    guard: { inputTolerancePpm: "5000", maximumInputBalance: "1", minimumOutputBalance: "1", offchainInputBalance: "1", offchainOutputBalance: "1", outputTolerancePpm: "5000", packedDeadline: "123" },
    input: finalInput,
    intent,
    mustSubmitBy: new Date(deadline * 1_000).toISOString(),
    operation: "swap",
    output: preview.output,
    persisted: true,
    quoteType: "firm",
    requirements: {
      approvals: input.inputNative ? [] : [{ minimumAtomicAmount: finalInputAtomic, spender: poolAddress, token: inputMetadata.address }],
      sender: input.payer,
    },
    stateSnapshot: { blockHash: `0x${"2".repeat(64)}`, blockNumber: "1", blockTimestamp: "1", chainId: 97, poolAddress, poolId: pool.id },
    status: "executable",
    transaction: {
      chainId: 97,
      data: "0x1234",
      method: input.inputNative ? "swapExactNativeForAsset" : input.outputNative ? "swapExactAssetForNative" : "swapExactAssetForAsset",
      to: poolAddress,
      value: input.inputNative ? finalInputAtomic : "0",
    },
    venues: [],
    warnings: [],
  };
}

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    const key = options.queryKey[0];
    if (key === "sets") return { data: [pool], error: null, isPending: false, refetch: vi.fn().mockResolvedValue({ data: [pool] }) };
    if (key === "pool") return { data: pool, error: null, isPending: false, refetch: vi.fn().mockResolvedValue({ data: pool }) };
    if (key === "pool-state") return { data: poolState(), error: null, isPending: false, refetch: mocks.poolStateRefetch };
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
  usePublicClient: () => ({ waitForTransactionReceipt: mocks.waitForTransactionReceipt }),
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
  saveActivity: mocks.saveActivity,
  updateActivity: mocks.updateActivity,
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
    mocks.requestFirmSwapQuote.mockReset().mockImplementation((input: Parameters<typeof firm>[0]) => Promise.resolve(firm(input)));
    mocks.writeContract.mockReset().mockImplementation(({ address, args }: { address: string; args: readonly [string, bigint] }) => {
      const asset = assets.find((candidate) => candidate.address === address)!;
      mocks.allowances[asset.id] = args[1];
      return Promise.resolve(approvalHash);
    });
    mocks.sendTransaction.mockReset().mockResolvedValue(swapHash);
    mocks.sendCalls.mockReset().mockResolvedValue({ id: "batch-1" });
    mocks.waitForTransactionReceipt.mockReset().mockResolvedValue({ status: "success" });
    mocks.createActivity.mockReset().mockImplementation((input: object) => ({ ...input, id: "activity-1", operation: "swap", timestamp: 1 }));
    mocks.saveActivity.mockReset();
    mocks.updateActivity.mockReset();
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

  it("confirms an exact ERC-20 approval before requesting and submitting a firm quote", async () => {
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    await screen.findByRole("button", { name: "New swap" });
    expect(mocks.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      args: [poolAddress, 10n * 10n ** 18n],
      functionName: "approve",
    }));
    expect(mocks.writeContract.mock.invocationCallOrder[0]).toBeLessThan(mocks.requestFirmSwapQuote.mock.invocationCallOrder[0]);
    expect(mocks.requestFirmSwapQuote.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendTransaction.mock.invocationCallOrder[0]);
    expect(mocks.updateActivity).toHaveBeenCalledWith("activity-1", expect.objectContaining({ hash: swapHash, status: "success" }));
    expect(mocks.chainRefetch.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(mocks.poolStateRefetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("submits exact approval and firm swap in one forced-atomic batch", async () => {
    mocks.atomicCapability = "supported";
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    await screen.findByRole("button", { name: "New swap" });
    expect(mocks.sendCalls).toHaveBeenCalledWith(expect.objectContaining({
      account: wallet,
      chainId: 97,
      forceAtomic: true,
    }));
    const calls = mocks.sendCalls.mock.calls[0]?.[0].calls;
    expect(calls).toHaveLength(2);
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0].data })).toEqual({
      args: [poolAddress, 10n * 10n ** 18n],
      functionName: "approve",
    });
    expect(calls[1]).toEqual({ data: "0x1234", to: poolAddress, value: 0n });
    expect(mocks.requestFirmSwapQuote.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendCalls.mock.invocationCallOrder[0]);
    expect(mocks.writeContract).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.updateActivity).toHaveBeenCalledWith("activity-1", expect.objectContaining({ hash: swapHash, status: "success" }));
  });

  it("approves the final firm input atomically when exact-output pricing moves", async () => {
    mocks.atomicCapability = "ready";
    mocks.firmInputDelta = 1n * 10n ** 18n;
    render(<MemoryRouter><SwapPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Exact output" }));
    fireEvent.change(screen.getByRole("textbox", { name: "You receive amount" }), { target: { value: "20" } });
    const review = await screen.findByRole("button", { name: "Review swap" });
    await waitFor(() => expect(review).toBeEnabled());
    await executeReviewedSwap(review);

    await screen.findByRole("button", { name: "New swap" });
    const calls = mocks.sendCalls.mock.calls[0]?.[0].calls;
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0].data })).toEqual({
      args: [poolAddress, 11n * 10n ** 18n],
      functionName: "approve",
    });
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it("offers an explicit sequential retry when atomic wallet setup is rejected", async () => {
    mocks.atomicCapability = "ready";
    mocks.sendCalls.mockRejectedValueOnce({ code: 5750 });
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/sequential approval and swap/i);
    fireEvent.click(screen.getByRole("button", { name: "Try swap again" }));
    const retry = await screen.findByRole("button", { name: "Approve exact amount & swap" });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);

    await screen.findByRole("button", { name: "New swap" }, { timeout: 3_000 });
    expect(mocks.sendCalls).toHaveBeenCalledTimes(1);
    expect(mocks.writeContract).toHaveBeenCalledTimes(1);
    expect(mocks.requestFirmSwapQuote).toHaveBeenCalledTimes(2);
    expect(mocks.requestFirmSwapQuote.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.writeContract.mock.invocationCallOrder[0]);
  });

  it("reports a submitted atomic batch failure without attempting sequential fallback", async () => {
    mocks.atomicCapability = "supported";
    mocks.batchStatus = { atomic: true, chainId: 97, status: "failure" };
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/No approval or swap was applied/i);
    expect(mocks.writeContract).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.updateActivity).toHaveBeenCalledWith("activity-1", expect.objectContaining({ status: "failed" }));
  });

  it("retries status instead of falling back after a batch ID was returned", async () => {
    mocks.atomicCapability = "supported";
    mocks.batchStatus = null;
    mocks.batchStatusError = new Error("status RPC unavailable");
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/sequential fallback is disabled/i);
    fireEvent.click(screen.getByRole("button", { name: "Retry batch status" }));
    expect(mocks.batchStatusRefetch).toHaveBeenCalledTimes(1);
    expect(mocks.writeContract).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("does not duplicate an atomic submission while the wallet request is open", async () => {
    mocks.atomicCapability = "supported";
    let resolveBatch!: (value: { id: string }) => void;
    mocks.sendCalls.mockImplementation(() => new Promise((resolve) => { resolveBatch = resolve; }));
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    const pending = await screen.findByRole("button", { name: "Confirm atomic swap in wallet…" });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(mocks.sendCalls).toHaveBeenCalledTimes(1);
    resolveBatch({ id: "batch-1" });
    await screen.findByRole("button", { name: "New swap" });
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
      args: [poolAddress, 10n * 10n ** 18n],
    }));
    expect(mocks.requestFirmSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ outputAmount: "20" }));
    expect(mocks.requestFirmSwapQuote.mock.calls[0]?.[0]).not.toHaveProperty("inputAmount");
    expect(mocks.sendTransaction).toHaveBeenCalled();
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
    mocks.requestFirmSwapQuote.mockReset().mockImplementation((input: Parameters<typeof firm>[0]) => Promise.resolve(firm(input, true)));
    mocks.allowances.USDT = 1_000n * 10n ** 18n;
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
    expect(screen.getByRole("button", { name: "Refresh quote" })).toBeEnabled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("never submits an expired firm quote as an atomic batch", async () => {
    mocks.atomicCapability = "supported";
    mocks.requestFirmSwapQuote.mockReset().mockImplementation((input: Parameters<typeof firm>[0]) => Promise.resolve(firm(input, true)));
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
    expect(mocks.sendCalls).not.toHaveBeenCalled();
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it("offers recovery after wallet rejection and records the failed operation", async () => {
    mocks.allowances.USDT = 1_000n * 10n ** 18n;
    mocks.sendTransaction.mockReset().mockRejectedValue(new Error("User rejected request"));
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Rejected in wallet/i);
    expect(screen.getByRole("button", { name: "Try swap again" })).toBeEnabled();
    expect(mocks.updateActivity).toHaveBeenCalledWith("activity-1", expect.objectContaining({ status: "failed" }));
  });

  it("offers retry after an approval rejection without requesting a firm quote", async () => {
    mocks.writeContract.mockReset().mockRejectedValue(new Error("User rejected request"));
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Rejected in wallet/i);
    expect(screen.getByRole("button", { name: "Try swap again" })).toBeEnabled();
    expect(mocks.requestFirmSwapQuote).not.toHaveBeenCalled();
  });

  it("handles an on-chain revert with an explorer-linked failed activity record", async () => {
    mocks.allowances.USDT = 1_000n * 10n ** 18n;
    mocks.waitForTransactionReceipt.mockReset().mockResolvedValue({ status: "reverted" });
    const review = await enterAmount("10");
    await executeReviewedSwap(review);

    expect(await screen.findByRole("alert")).toHaveTextContent(/reverted on chain/i);
    expect(screen.getByRole("button", { name: "Try swap again" })).toBeEnabled();
    expect(screen.getByRole("link", { name: new RegExp(swapHash.slice(0, 6), "i") })).toHaveAttribute("href", expect.stringContaining(swapHash));
    expect(mocks.updateActivity).toHaveBeenCalledWith("activity-1", expect.objectContaining({ status: "failed" }));
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
