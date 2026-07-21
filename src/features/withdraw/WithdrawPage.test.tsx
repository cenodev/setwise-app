import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { Pool, PoolState } from "../../data/rfq/deposits";
import { WithdrawPage } from "./WithdrawPage";

const mocks = vi.hoisted(() => ({
  chainRefetch: vi.fn(),
  createActivity: vi.fn(),
  markActivityFailed: vi.fn(),
  markActivityPending: vi.fn(),
  markActivitySuccessful: vi.fn(),
  queryInvalidation: vi.fn(),
  requestFirmWithdrawalQuote: vi.fn(),
  requestWithdrawalQuote: vi.fn(),
  sendTransaction: vi.fn(),
  saveActivity: vi.fn(),
  simulateContract: vi.fn(),
  tradingPaused: false,
  waitForTransactionReceipt: vi.fn(),
  writeContract: vi.fn(),
}));

const poolAddress = "0x1000000000000000000000000000000000000000";
const investor = "0x2000000000000000000000000000000000000000";
const wrappedNative = "0x119FF2a8b74dfCE4c378CE4bd2c10201bf47e395";
const tokenAddress = "0x4000000000000000000000000000000000000000";
const directHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const firmHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const assets: Pool["assets"] = [
  { address: wrappedNative, decimals: 18, id: "WBNB", index: 0, name: "Wrapped BNB", symbol: "WBNB", weight: 50 },
  { address: tokenAddress, decimals: 6, id: "USDT", index: 1, name: "Tether USD", symbol: "USDT", weight: 50 },
];

const pool: Pool = {
  assets,
  chain: { id: 97, name: "BSC Testnet" },
  contract: { address: poolAddress },
  display: { description: "A test Set", name: "Test Set", sortOrder: 0 },
  id: "bstock-ai-no-bnb-bsc-testnet",
  lpToken: { address: poolAddress, decimals: 18, symbol: "SETWISE" },
  quotePolicy: { allowedLockDays: [0] },
  capabilities: {
    nativeAsset: true,
    swaps: { exactInput: true, exactOutput: true, firm: true, indicative: true },
    withdrawals: { firm: true, proportional: true, singleAsset: true },
  },
};

function poolState(): PoolState {
  return {
    assets: assets.map((asset) => ({
      actualAtomicBalance: "1000000000000000000",
      amount: "1",
      asset: asset.id,
      atomicAmount: "1000000000000000000",
      balanceStatus: "synced" as const,
      decimals: asset.decimals,
      index: asset.index,
      market: { askUsd: "1", bidUsd: "1", observedAt: "2026-07-21T12:00:00.000Z" },
      multiplier: "1",
      recordedAtomicBalance: "1000000000000000000",
      valueUsd: "1",
    })),
    blockNumber: "123",
    blockTimestamp: "2026-07-21T12:00:00.000Z",
    chainId: 97,
    contract: { wrappedNativeToken: wrappedNative },
    poolAddress,
    poolId: pool.id,
    totalSupply: { amount: "10", atomicAmount: "10000000000000000000", decimals: 18 },
    totalValueUsd: "10",
    trading: {
      deposits: "available",
      paused: mocks.tradingPaused,
      proportionalWithdrawals: "available",
      singleAssetWithdrawals: mocks.tradingPaused ? "paused" : "available",
    },
  };
}

const chainData = {
  assetBalances: { USDT: 1_000_000n, WBNB: 1_000_000_000_000_000_000n },
  canClaim: false,
  lockedShares: 2_000_000_000_000_000_000n,
  lockedUntil: 1_800_000_000n,
  orderedAssets: assets,
  unlockedShares: 10_000_000_000_000_000_000n,
};

function indicative(mode: "proportional" | "single-asset") {
  const now = Date.now();
  return {
    execution: mode === "proportional" ? "direct-onchain" : "requires-firm-quote",
    indicativeQuoteId: `indicative-${mode}`,
    input: { amount: "1", asset: "SETWISE", atomicAmount: "1000000000000000000", decimals: 18 },
    marketSnapshot: [
      { askUsd: "600", asset: "WBNB", bidUsd: "600" },
      { askUsd: "1", asset: "USDT", bidUsd: "1" },
    ],
    mode,
    operation: "withdrawal",
    outputs: mode === "proportional" ? [
      { amount: "0.01", asset: "WBNB", atomicAmount: "10000000000000000", decimals: 18 },
      { amount: "5", asset: "USDT", atomicAmount: "5000000", decimals: 6 },
    ] : [{ amount: "0.02", asset: "WBNB", atomicAmount: "20000000000000000", decimals: 18 }],
    pricedAt: new Date(now).toISOString(),
    quoteType: "indicative",
    stateSnapshot: { chainId: 97, poolAddress, poolId: pool.id, tradingPaused: mocks.tradingPaused },
    validUntil: new Date(now + 60_000).toISOString(),
    warnings: [
      { asset: "WBNB", code: "SESSION", message: "Underlying session not verified" },
      { asset: "WBNB", code: "SESSION", message: "Underlying session not verified" },
      { asset: "USDT", code: "SESSION", message: "Underlying session not verified" },
    ],
  };
}

function firm(mustSubmitBy = new Date(Date.now() + 60_000).toISOString()) {
  return {
    firmQuoteId: "firm-1",
    investor,
    mode: "single-asset",
    mustSubmitBy,
    operation: "withdrawal",
    output: { amount: "0.02", asset: "WBNB", atomicAmount: "20000000000000000", decimals: 18 },
    quoteType: "firm",
    receiveNative: true,
    requirements: { minimumPoolTokenBalance: "1000000000000000000", sender: investor },
    shares: { amount: "1", asset: "SETWISE", atomicAmount: "1000000000000000000", decimals: 18 },
    status: "executable",
    transaction: { chainId: 97, data: "0x1234", method: "withdrawSingleAsset", to: poolAddress, value: "0" },
  };
}

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.queryInvalidation }),
  useQuery: () => {
    return { data: chainData, error: null, isPending: false, refetch: mocks.chainRefetch };
  },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: investor }),
  usePublicClient: () => ({
    simulateContract: mocks.simulateContract,
    waitForTransactionReceipt: mocks.waitForTransactionReceipt,
  }),
  useSendTransaction: () => ({ sendTransactionAsync: mocks.sendTransaction }),
  useWriteContract: () => ({ writeContractAsync: mocks.writeContract }),
}));

vi.mock("../../data/rfq/withdrawals", (importOriginal) =>
  importOriginal<typeof import("../../data/rfq/withdrawals")>().then((original) => ({
    ...original,
    requestFirmWithdrawalQuote: mocks.requestFirmWithdrawalQuote,
    requestWithdrawalQuote: mocks.requestWithdrawalQuote,
  })));

vi.mock("../activity/store", () => ({
  createWithdrawalActivity: mocks.createActivity,
  markActivityFailed: mocks.markActivityFailed,
  markActivityPending: mocks.markActivityPending,
  markActivitySuccessful: mocks.markActivitySuccessful,
  saveActivity: mocks.saveActivity,
}));

async function enterProportionalAmount() {
  render(<MemoryRouter><WithdrawPage pool={pool} poolState={poolState()} /></MemoryRouter>);
  fireEvent.change(screen.getByRole("textbox", { name: "Set shares" }), { target: { value: "1" } });
  const action = await screen.findByRole("button", { name: "Confirm withdrawal" });
  await waitFor(() => expect(action).toBeEnabled());
  return action;
}

async function enterNativeSingleAssetAmount() {
  render(<MemoryRouter><WithdrawPage pool={pool} poolState={poolState()} /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Single asset" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Receive native BNB" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Set shares" }), { target: { value: "1" } });
  const action = await screen.findByRole("button", { name: "Review withdrawal" });
  await waitFor(() => expect(action).toBeEnabled());
  return action;
}

describe("WithdrawPage", () => {
  beforeEach(() => {
    mocks.tradingPaused = false;
    mocks.createActivity.mockReset().mockImplementation((input: object) => ({
      ...input,
      id: "withdrawal-activity-1",
      operation: "withdrawal",
      timestamp: 1,
    }));
    mocks.markActivityFailed.mockReset();
    mocks.markActivityPending.mockReset();
    mocks.markActivitySuccessful.mockReset();
    mocks.saveActivity.mockReset();
    mocks.chainRefetch.mockReset().mockResolvedValue({ data: chainData });
    mocks.queryInvalidation.mockReset().mockResolvedValue(undefined);
    mocks.requestWithdrawalQuote.mockReset().mockImplementation(({ outputAsset }: { outputAsset?: string }) =>
      Promise.resolve(indicative(outputAsset ? "single-asset" : "proportional")));
    mocks.requestFirmWithdrawalQuote.mockReset().mockResolvedValue(firm());
    mocks.simulateContract.mockReset().mockResolvedValue({ request: {} });
    mocks.writeContract.mockReset().mockResolvedValue(directHash);
    mocks.sendTransaction.mockReset().mockResolvedValue(firmHash);
    mocks.waitForTransactionReceipt.mockReset().mockResolvedValue({ status: "success" });
  });

  it("previews every proportional output, simulates, and submits directly without a firm quote or approval", async () => {
    const action = await enterProportionalAmount();
    expect(await screen.findByText("0.01")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText(/Locked shares are excluded from Max/)).toBeInTheDocument();
    expect(screen.getAllByText("Underlying session not verified")).toHaveLength(1);

    fireEvent.click(action);

    await screen.findByRole("button", { name: "New withdrawal" });
    expect(mocks.simulateContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "withdrawPortfolio" }));
    expect(mocks.writeContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "withdrawPortfolio" }));
    expect(mocks.requestFirmWithdrawalQuote).not.toHaveBeenCalled();
    expect(mocks.requestWithdrawalQuote).toHaveBeenCalledWith(expect.objectContaining({ poolId: pool.id }));
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.chainRefetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.createActivity).toHaveBeenCalledWith(expect.objectContaining({
      mode: "proportional",
      outputs: [
        { amount: "0.01", symbol: "WBNB" },
        { amount: "5", symbol: "USDT" },
      ],
      setId: pool.id,
      shares: { amount: "1", symbol: "SETWISE" },
      status: "pending",
    }));
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
    expect(mocks.markActivityPending).toHaveBeenCalledWith("withdrawal-activity-1", directHash);
    expect(mocks.markActivitySuccessful).toHaveBeenCalledWith("withdrawal-activity-1", directHash);
    expect(mocks.queryInvalidation).toHaveBeenCalledWith({
      exact: true,
      queryKey: ["sets", pool.id, "state"],
    });
    expect(mocks.queryInvalidation).toHaveBeenCalledWith({
      queryKey: ["wallet-pool-position", pool.id],
    });
  });

  it("requests and immediately submits a validated firm quote for native BNB output", async () => {
    const action = await enterNativeSingleAssetAmount();
    expect(screen.getByText(/unwrapped from WBNB/)).toBeInTheDocument();

    fireEvent.click(action);

    await screen.findByRole("button", { name: "New withdrawal" });
    expect(mocks.requestFirmWithdrawalQuote).toHaveBeenCalledWith(expect.objectContaining({
      investor,
      outputAsset: "WBNB",
      poolId: pool.id,
      poolTokenAmount: "1",
      receiveNative: true,
    }));
    expect(mocks.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({
      account: investor,
      data: "0x1234",
      to: poolAddress,
      value: 0n,
    }));
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.writeContract).not.toHaveBeenCalled();
    expect(mocks.createActivity).toHaveBeenCalledWith(expect.objectContaining({
      mode: "single-asset",
      outputs: [{ amount: "0.02", symbol: "BNB" }],
      setId: pool.id,
    }));
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
    expect(mocks.markActivitySuccessful).toHaveBeenCalledWith("withdrawal-activity-1", firmHash);
  });

  it("keeps proportional withdrawal available while trading is paused", async () => {
    mocks.tradingPaused = true;
    const action = await enterProportionalAmount();
    expect(screen.getByText(/direct proportional withdrawals remain available/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Single asset" })).toBeDisabled();
    expect(action).toBeEnabled();
  });

  it("never opens a wallet request for an expired firm quote", async () => {
    mocks.requestFirmWithdrawalQuote.mockReset().mockResolvedValue(firm(new Date(Date.now() - 1_000).toISOString()));
    const action = await enterNativeSingleAssetAmount();

    fireEvent.click(action);

    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
    expect(screen.getByRole("button", { name: "Refresh quote" })).toBeEnabled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.saveActivity).not.toHaveBeenCalled();
  });

  it("provides a retry after wallet rejection", async () => {
    mocks.sendTransaction.mockReset().mockRejectedValue(Object.assign(new Error("User rejected request"), { code: 4001 }));
    const action = await enterNativeSingleAssetAmount();

    fireEvent.click(action);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Rejected in wallet/);
    expect(screen.getByRole("button", { name: "Try withdrawal again" })).toBeEnabled();
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
    expect(mocks.markActivityFailed).toHaveBeenCalledWith(
      "withdrawal-activity-1",
      "Rejected in wallet. You can try again when ready.",
      undefined,
    );
  });

  it("stops direct execution when simulation fails", async () => {
    mocks.simulateContract.mockReset().mockRejectedValue(new Error("execution reverted: reserve"));
    const action = await enterProportionalAmount();

    fireEvent.click(action);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Simulation failed/);
    expect(screen.getByRole("button", { name: "Retry simulation" })).toBeEnabled();
    expect(mocks.writeContract).not.toHaveBeenCalled();
    expect(mocks.saveActivity).not.toHaveBeenCalled();
  });

  it("keeps the transaction link and retry action after an on-chain revert", async () => {
    mocks.waitForTransactionReceipt.mockReset().mockResolvedValue({ status: "reverted" });
    const action = await enterProportionalAmount();

    fireEvent.click(action);

    expect(await screen.findByRole("alert")).toHaveTextContent(/reverted on chain/);
    expect(screen.getByRole("button", { name: "Try withdrawal again" })).toBeEnabled();
    expect(screen.getByRole("link", { name: /0xaaaa/ })).toHaveAttribute("href", expect.stringContaining(directHash));
    expect(mocks.markActivityFailed).toHaveBeenCalledWith(
      "withdrawal-activity-1",
      expect.stringMatching(/reverted on chain/i),
      directHash,
    );
  });

  it("rejects an indicative quote belonging to another Set", async () => {
    mocks.requestWithdrawalQuote.mockReset().mockResolvedValue({
      ...indicative("proportional"),
      stateSnapshot: { ...indicative("proportional").stateSnapshot, poolId: "another-set" },
    });
    render(<MemoryRouter><WithdrawPage pool={pool} poolState={poolState()} /></MemoryRouter>);

    fireEvent.change(screen.getByRole("textbox", { name: "Set shares" }), { target: { value: "1" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/wrong Set/i);
    expect(screen.getByRole("button", { name: "Confirm withdrawal" })).toBeDisabled();
  });

  it("uses the selected Set's withdrawal capabilities", () => {
    render(
      <MemoryRouter>
        <WithdrawPage
          pool={{
            ...pool,
            capabilities: {
              nativeAsset: false,
              swaps: { exactInput: true, exactOutput: true, firm: true, indicative: true },
              withdrawals: { firm: false, proportional: true, singleAsset: false },
            },
          }}
          poolState={poolState()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Proportional" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Single asset" })).toBeDisabled();
  });

  it("does not offer native output when the selected Set disables it", () => {
    render(
      <MemoryRouter>
        <WithdrawPage
          pool={{
            ...pool,
            capabilities: {
              nativeAsset: false,
              swaps: { exactInput: true, exactOutput: true, firm: true, indicative: true },
              withdrawals: { firm: true, proportional: true, singleAsset: true },
            },
          }}
          poolState={poolState()}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Single asset" }));
    expect(screen.queryByRole("checkbox", { name: "Receive native BNB" })).not.toBeInTheDocument();
  });
});
