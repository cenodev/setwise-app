import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { DepositPage } from "./DepositPage";

const mocks = vi.hoisted(() => ({
  atomicStatus: "supported",
  chainRefetch: vi.fn(),
  createActivity: vi.fn(),
  events: [] as string[],
  markActivityFailed: vi.fn(),
  markActivityPending: vi.fn(),
  markActivitySuccessful: vi.fn(),
  poolStateRefetch: vi.fn(),
  requestDepositQuote: vi.fn(),
  requestFirmDepositQuote: vi.fn(),
  sendCalls: vi.fn(),
  sendTransaction: vi.fn(),
  saveActivity: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContract: vi.fn(),
}));

const poolAddress = "0x1000000000000000000000000000000000000000";
const tokenAddress = "0x2000000000000000000000000000000000000000";
const investor = "0x3000000000000000000000000000000000000000";
const approvalHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const depositHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const batchHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const pricedAt = new Date().toISOString();
const validUntil = new Date(Date.now() + 60_000).toISOString();

const asset = {
  address: tokenAddress,
  decimals: 6,
  id: "USDT",
  index: 0,
  name: "Tether USD",
  symbol: "USDT",
  weight: 100,
};

const pool = {
  assets: [asset],
  chain: { id: 97, name: "BSC Testnet" },
  contract: { address: poolAddress },
  id: "bstock-ai-no-bnb-bsc-testnet",
  lpToken: { address: poolAddress, decimals: 18, symbol: "SETWISE" },
  quotePolicy: { allowedLockDays: [0] },
};

const poolState = {
  assets: [{ asset: "USDT", index: 0, market: { askUsd: "1", bidUsd: "1" } }],
  chainId: 97,
  poolAddress,
  poolId: pool.id,
  trading: { deposits: "available", paused: false },
};

const chainData = {
  assets: { USDT: { allowance: 0n, balance: 10_000_000n } },
  canClaim: false,
  lockedShares: 0n,
  lockedUntil: 0n,
  orderedAssets: [asset],
  shareBalance: 0n,
};

const indicativeQuote = {
  deposits: [{ amount: "1", asset: "USDT", atomicAmount: "1000000", decimals: 6 }],
  indicativeQuoteId: "indicative-1",
  lockDays: 0,
  marketSnapshot: [{ askUsd: "1", asset: "USDT", bidUsd: "1" }],
  operation: "deposit",
  orderedAtomicAmounts: ["1000000"],
  output: { amount: "1", asset: "SETWISE", atomicAmount: "1000000000000000000", decimals: 18 },
  pricedAt,
  quoteType: "indicative",
  stateSnapshot: { chainId: 97, poolAddress, tradingPaused: false },
  validUntil,
  warnings: [],
};

const firmQuote = {
  firmQuoteId: "firm-1",
  investor,
  lockDays: 0,
  mode: "portfolio",
  mustSubmitBy: validUntil,
  operation: "deposit",
  orderedAtomicAmounts: ["1000000"],
  quoteType: "firm",
  requirements: {
    approvals: [{ minimumAtomicAmount: "1000000", spender: poolAddress, token: tokenAddress }],
    sender: investor,
  },
  shares: { amount: "1", asset: "SETWISE", atomicAmount: "1000000000000000000", decimals: 18 },
  status: "executable",
  transaction: { chainId: 97, data: "0x1234", method: "depositPortfolio", to: poolAddress, value: "0" },
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    const key = options.queryKey[0];
    if (key === "pool") return {
      data: pool, error: null, isPending: false, refetch: vi.fn().mockResolvedValue({ data: pool }),
    };
    if (key === "pool-state") return {
      data: poolState, error: null, isPending: false, refetch: mocks.poolStateRefetch,
    };
    return {
      data: chainData, error: null, isPending: false, refetch: mocks.chainRefetch,
    };
  },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: investor, connector: { id: "test", uid: "test-connector" } }),
  useCapabilities: () => ({
    data: { atomic: { status: mocks.atomicStatus } },
    isError: false,
    isFetched: true,
    refetch: vi.fn().mockImplementation(() => Promise.resolve({ data: { atomic: { status: mocks.atomicStatus } } })),
  }),
  usePublicClient: () => ({ waitForTransactionReceipt: mocks.waitForTransactionReceipt }),
  useSendCalls: () => ({ sendCallsAsync: mocks.sendCalls }),
  useSendTransaction: () => ({ sendTransactionAsync: mocks.sendTransaction }),
  useWaitForCallsStatus: ({ id }: { id?: string }) => id ? {
    data: {
      atomic: true,
      chainId: 97,
      receipts: [{ status: "success", transactionHash: batchHash }],
      status: "success",
      statusCode: 200,
    },
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  } : { data: undefined, error: null, isFetching: false, refetch: vi.fn() },
  useWriteContract: () => ({ writeContractAsync: mocks.writeContract }),
}));

vi.mock("../../data/rfq/deposits", (importOriginal) =>
  importOriginal<typeof import("../../data/rfq/deposits")>().then((original) => ({
    ...original,
    getPool: vi.fn(),
    getPoolState: vi.fn(),
    requestDepositQuote: mocks.requestDepositQuote,
    requestFirmDepositQuote: mocks.requestFirmDepositQuote,
  })));

vi.mock("../activity/store", () => ({
  createDepositActivity: mocks.createActivity,
  markActivityFailed: mocks.markActivityFailed,
  markActivityPending: mocks.markActivityPending,
  markActivitySuccessful: mocks.markActivitySuccessful,
  saveActivity: mocks.saveActivity,
}));

async function preparePortfolioDeposit() {
  render(<MemoryRouter><DepositPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Portfolio" }));
  fireEvent.change(screen.getByRole("textbox", { name: "USDT amount" }), { target: { value: "1" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Approve assets & deposit" })).toBeEnabled());
}

describe("DepositPage atomic deposits", () => {
  beforeEach(() => {
    mocks.atomicStatus = "supported";
    mocks.events.length = 0;
    mocks.createActivity.mockReset().mockImplementation((input: object) => ({
      ...input,
      id: "deposit-activity-1",
      operation: "deposit",
      timestamp: 1,
    }));
    mocks.markActivityFailed.mockReset();
    mocks.markActivityPending.mockReset();
    mocks.markActivitySuccessful.mockReset();
    mocks.saveActivity.mockReset();
    mocks.chainRefetch.mockReset().mockResolvedValue({ data: chainData });
    mocks.poolStateRefetch.mockReset().mockResolvedValue({ data: poolState });
    mocks.requestDepositQuote.mockReset().mockResolvedValue(indicativeQuote);
    mocks.requestFirmDepositQuote.mockReset().mockImplementation(() => {
      mocks.events.push("firm-quote");
      return Promise.resolve(firmQuote);
    });
    mocks.sendCalls.mockReset().mockImplementation(() => {
      mocks.events.push("send-calls");
      return Promise.resolve({ id: "batch-1" });
    });
    mocks.writeContract.mockReset().mockImplementation(() => {
      mocks.events.push("approval");
      return Promise.resolve(approvalHash);
    });
    mocks.sendTransaction.mockReset().mockImplementation(() => {
      mocks.events.push("deposit");
      return Promise.resolve(depositHash);
    });
    mocks.waitForTransactionReceipt.mockReset().mockResolvedValue({ status: "success" });
  });

  it("gets the firm quote before one force-atomic wallet request and reconciles its receipt", async () => {
    await preparePortfolioDeposit();

    fireEvent.click(screen.getByRole("button", { name: "Approve assets & deposit" }));

    await screen.findByRole("button", { name: "New deposit" });
    expect(mocks.events).toEqual(["firm-quote", "send-calls"]);
    expect(mocks.writeContract).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.sendCalls).toHaveBeenCalledOnce();
    expect(mocks.sendCalls).toHaveBeenCalledWith(expect.objectContaining({
      account: investor,
      calls: [expect.any(Object), expect.any(Object)],
      chainId: 97,
      forceAtomic: true,
    }));
    expect(mocks.createActivity).toHaveBeenCalledWith(expect.objectContaining({
      deposits: [{ amount: "1", symbol: "USDT" }],
      lockDays: 0,
      mode: "portfolio",
      setId: pool.id,
      shares: { amount: "1", symbol: "SETWISE" },
      status: "pending",
    }));
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
    expect(mocks.markActivityPending).toHaveBeenCalledWith("deposit-activity-1");
    expect(mocks.markActivitySuccessful).toHaveBeenCalledWith("deposit-activity-1", batchHash);
    expect(screen.getByRole("link", { name: /0xcccc/ })).toHaveAttribute("href", expect.stringContaining(batchHash));
    expect(mocks.chainRefetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.poolStateRefetch).toHaveBeenCalled();
  });

  it("falls back before submission when atomic capability is unsupported", async () => {
    mocks.atomicStatus = "unsupported";
    render(<MemoryRouter><DepositPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Portfolio" }));
    fireEvent.change(screen.getByRole("textbox", { name: "USDT amount" }), { target: { value: "1" } });
    const action = await screen.findByRole("button", { name: "Approve 1 token & deposit" });
    await waitFor(() => expect(action).toBeEnabled());

    fireEvent.click(action);

    await screen.findByRole("button", { name: "New deposit" });
    expect(mocks.sendCalls).not.toHaveBeenCalled();
    expect(mocks.events).toEqual(["approval", "firm-quote", "deposit"]);
    expect(mocks.writeContract).toHaveBeenCalledOnce();
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
    expect(mocks.markActivityPending).toHaveBeenCalledWith("deposit-activity-1", depositHash);
    expect(mocks.markActivitySuccessful).toHaveBeenCalledWith("deposit-activity-1", depositHash);
  });

  it("uses the sequential path only on an explicit retry after atomic-ready setup is rejected", async () => {
    mocks.atomicStatus = "ready";
    mocks.sendCalls.mockReset().mockImplementation(() => {
      mocks.events.push("send-calls");
      return Promise.reject(Object.assign(new Error("Atomic-ready setup rejected"), { code: 5750 }));
    });
    await preparePortfolioDeposit();

    fireEvent.click(screen.getByRole("button", { name: "Approve assets & deposit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/setup for atomic execution was rejected/i);
    expect(mocks.writeContract).not.toHaveBeenCalled();
    expect(mocks.events).toEqual(["firm-quote", "send-calls"]);
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
    expect(mocks.markActivityFailed).toHaveBeenCalledWith(
      "deposit-activity-1",
      expect.stringMatching(/setup for atomic execution was rejected/i),
    );

    fireEvent.click(screen.getByRole("button", { name: "Try deposit again" }));

    await screen.findByRole("button", { name: "New deposit" });
    expect(mocks.sendCalls).toHaveBeenCalledOnce();
    expect(mocks.events).toEqual(["firm-quote", "send-calls", "approval", "firm-quote", "deposit"]);
    expect(mocks.saveActivity).toHaveBeenCalledTimes(2);
  });

  it("does not create activity for an expired firm quote that never reaches the wallet", async () => {
    mocks.atomicStatus = "unsupported";
    mocks.requestFirmDepositQuote.mockReset().mockResolvedValue({
      ...firmQuote,
      mustSubmitBy: new Date(Date.now() - 1_000).toISOString(),
    });
    render(<MemoryRouter><DepositPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Portfolio" }));
    fireEvent.change(screen.getByRole("textbox", { name: "USDT amount" }), { target: { value: "1" } });
    const action = await screen.findByRole("button", { name: "Approve 1 token & deposit" });
    await waitFor(() => expect(action).toBeEnabled());

    fireEvent.click(action);

    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
    expect(mocks.saveActivity).not.toHaveBeenCalled();
  });
});
