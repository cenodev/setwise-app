import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Address } from "viem";

import type { PortfolioView, UsePortfolioResult } from "../features/portfolio/usePortfolio";
import type { Pool, PoolState } from "../data/rfq/deposits";
import type { PoolSummary } from "../data/rfq/pools";
import { toSetDefinition } from "../data/sets";
import { PortfolioPage } from "./PortfolioPage";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  online: true,
  usePortfolio: vi.fn(),
}));

vi.mock("../features/portfolio/usePortfolio", async (importOriginal) => {
  const original = await importOriginal<typeof import("../features/portfolio/usePortfolio")>();
  return { ...original, usePortfolio: mocks.usePortfolio };
});

vi.mock("@reown/appkit/react", () => ({
  useAppKit: () => ({ open: mocks.open }),
}));

vi.mock("../data/tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/tokens")>();
  return {
    ...actual,
    useTokenMetadata: () => ({ data: undefined }),
  };
});

vi.mock("../lib/useOnlineStatus", () => ({
  useOnlineStatus: () => mocks.online,
}));

vi.mock("../config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/env")>();
  return {
    ...actual,
    runtimeConfig: {
      ...actual.runtimeConfig,
      walletConfigured: true,
    },
  };
});

const account = "0x0000000000000000000000000000000000000001" as Address;

function address(value: number): Address {
  return `0x${value.toString(16).padStart(40, "0")}`;
}

function setData(id: string, offset: number, chainId = 97, paused = false) {
  const summary = {
    assets: [
      {
        address: address(offset + 3),
        decimals: 6,
        id: `${id}-asset`,
        index: 0,
        symbol: "USDT",
        weight: 100,
      },
    ],
    chain: { id: chainId, name: chainId === 97 ? "BSC Testnet" : "Ethereum" },
    contract: { address: address(offset + 1) },
    id,
    lpToken: { address: address(offset + 2), decimals: 6, symbol: "SET" },
  } as PoolSummary;
  const definition = toSetDefinition(summary, 97);
  const pool = { ...summary, quotePolicy: { allowedLockDays: [0] } } as Pool;
  const state = {
    blockNumber: `${100 + offset}`,
    blockTimestamp: "2026-07-21T10:00:00.000Z",
    chainId,
    poolAddress: summary.contract.address,
    poolId: id,
    totalSupply: { amount: "10", atomicAmount: "10000000", decimals: 6 },
    totalValueUsd: "100",
    trading: { paused, deposits: paused ? "paused" : "available" },
  } as PoolState;
  return { definition, pool, state };
}

function result(view: PortfolioView | undefined, overrides?: Partial<UsePortfolioResult>): UsePortfolioResult {
  return {
    error: null,
    loading: false,
    refreshing: false,
    retry: vi.fn(),
    view,
    ...overrides,
  };
}

function readyWallet(poolId: string, shares = {
  canClaim: false,
  locked: 2_000_000n,
  lockedUntil: 0n,
  totalAttributed: 5_000_000n,
  unlocked: 3_000_000n,
}) {
  return {
    poolId,
    position: {
      account,
      assetBalances: [],
      blockNumber: 110n,
      chainId: 97,
      nativeBalance: 0n,
      shares,
    },
    status: "ready" as const,
  };
}

describe("PortfolioPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.online = true;
  });

  it("shows aggregate public liquidity without a wallet and a clear connect CTA", () => {
    const first = setData("set-alpha", 10);
    const paused = setData("set-gamma", 30, 97, true);
    mocks.usePortfolio.mockReturnValue(result({
      externalLiquidity: {
        sources: [{
          chainId: 97,
          liquidityUsd: "250",
          sourceAddress: address(99),
          venue: "Pancake",
        }],
        totalValueUsd: { numerator: 250n, denominator: 1n },
      },
      externalLiquidityCoverage: { available: 1, total: 2 },
      freshness: {
        newestTimestamp: first.state.blockTimestamp,
        oldestTimestamp: first.state.blockTimestamp,
        stale: 0,
        status: "ready",
        total: 2,
      },
      publicTvl: {
        coverage: { available: 2, errors: 0, stale: 0, total: 2, unsupported: 0 },
        status: "ready",
        value: { numerator: 200n, denominator: 1n },
      },
      sets: [
        { snapshot: { ...first, status: "ready" }, wallet: { poolId: first.pool.id, status: "disconnected" } },
        { snapshot: { ...paused, status: "ready" }, wallet: { poolId: paused.pool.id, status: "disconnected" } },
      ],
      userLiquidity: {
        coverage: { available: 0, errors: 0, stale: 0, total: 2, unsupported: 0 },
        status: "disconnected",
      },
      walletLoading: false,
    }));

    render(<MemoryRouter><PortfolioPage /></MemoryRouter>);

    const overview = screen.getByRole("region", { name: "Setwise liquidity overview" });
    expect(within(overview).getByText("$200.00")).toBeVisible();
    expect(within(overview).getByText(/sum of Set reserves/i)).toBeVisible();
    expect(within(overview).getByText("1 active")).toBeVisible();
    expect(within(overview).getByText(/1 paused/i)).toBeVisible();
    expect(within(overview).getByText(/2 unique constituents/i)).toBeVisible();
    expect(within(overview).getByText("$250.00")).toBeVisible();
    expect(within(overview).getByText(/not included in Setwise TVL/i)).toBeVisible();
    expect(screen.getByText(/External DEX liquidity is deduplicated/i)).toBeVisible();

    const wallet = screen.getByRole("region", { name: /Connect to see your Set liquidity/i });
    expect(within(wallet).getByText(/Public Setwise liquidity stays visible/i)).toBeVisible();
    const connect = within(wallet).getByRole("button", { name: "Connect wallet" });
    expect(connect).toBeVisible();
    fireEvent.click(connect);
    expect(mocks.open).toHaveBeenCalledWith({ view: "Connect" });
  });

  it("shows connected totals, lock status, and Overview/Deposit/Withdraw links", () => {
    const first = setData("set-alpha", 10);
    const failed = setData("set-beta", 20);
    mocks.usePortfolio.mockReturnValue(result({
      externalLiquidity: { sources: [], totalValueUsd: { numerator: 0n, denominator: 1n } },
      externalLiquidityCoverage: { available: 2, total: 2 },
      freshness: {
        newestTimestamp: first.state.blockTimestamp,
        oldestTimestamp: first.state.blockTimestamp,
        stale: 0,
        status: "partial",
        total: 2,
      },
      publicTvl: {
        coverage: { available: 1, errors: 1, stale: 0, total: 2, unsupported: 0 },
        status: "partial",
        value: { numerator: 100n, denominator: 1n },
      },
      sets: [
        {
          snapshot: { ...first, status: "ready" },
          wallet: readyWallet(first.pool.id),
        },
        {
          snapshot: { definition: failed.definition, error: new Error("offline"), status: "error" },
          wallet: { error: new Error("offline"), poolId: failed.pool.id, status: "error" },
        },
      ],
      userLiquidity: {
        coverage: { available: 1, errors: 1, stale: 0, total: 2, unsupported: 0 },
        status: "partial",
        value: { numerator: 50n, denominator: 1n },
      },
      walletLoading: false,
    }));

    render(<MemoryRouter><PortfolioPage /></MemoryRouter>);

    expect(screen.getByText("Partial portfolio.")).toBeVisible();
    expect(screen.getByText("Partial valuation.")).toBeVisible();

    const wallet = screen.getByRole("region", { name: "Your Set liquidity" });
    expect(within(wallet).getByText("$50.00")).toBeVisible();
    expect(within(wallet).getByText(/1 owned Sets/i)).toBeVisible();

    const firstCard = screen.getByRole("article", { name: "Set set-alpha position" });
    expect(within(firstCard).getByText("50.0000%")).toBeVisible();
    expect(within(firstCard).getByText("5 SET")).toBeVisible();
    expect(within(firstCard).getByText("Locked")).toBeVisible();
    expect(within(firstCard).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/sets/set-alpha/overview",
    );
    expect(within(firstCard).getByRole("link", { name: "Deposit" })).toHaveAttribute(
      "href",
      "/sets/set-alpha/deposit",
    );
    expect(within(firstCard).getByRole("link", { name: "Withdraw" })).toHaveAttribute(
      "href",
      "/sets/set-alpha/withdraw",
    );

    expect(screen.getByText("Public data unavailable")).toBeVisible();
    const failedCard = screen.getByRole("article", { name: "Set set-beta position" });
    expect(within(failedCard).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/sets/set-beta/overview",
    );
    expect(within(failedCard).getByRole("link", { name: "Deposit" })).toHaveAttribute(
      "href",
      "/sets/set-beta/deposit",
    );
  });

  it("renders disconnected, stale, unsupported, offline, and zero-balance states", () => {
    const stale = setData("set-stale", 10);
    const unsupported = setData("set-eth", 20, 1);
    mocks.online = false;
    mocks.usePortfolio.mockReturnValue(result({
      externalLiquidity: { sources: [], totalValueUsd: { numerator: 0n, denominator: 1n } },
      externalLiquidityCoverage: { available: 1, total: 2 },
      freshness: {
        newestTimestamp: stale.state.blockTimestamp,
        oldestTimestamp: stale.state.blockTimestamp,
        stale: 1,
        status: "stale",
        total: 2,
      },
      publicTvl: {
        coverage: { available: 1, errors: 0, stale: 1, total: 2, unsupported: 1 },
        status: "partial",
        value: { numerator: 100n, denominator: 1n },
      },
      sets: [
        { snapshot: { ...stale, status: "stale" }, wallet: { poolId: stale.pool.id, status: "disconnected" } },
        {
          snapshot: { definition: unsupported.definition, status: "unsupported-chain" },
          wallet: { chainId: 1, poolId: unsupported.pool.id, status: "unsupported-chain" },
        },
      ],
      userLiquidity: {
        coverage: { available: 0, errors: 0, stale: 0, total: 2, unsupported: 1 },
        status: "disconnected",
      },
      walletLoading: false,
    }));

    render(<MemoryRouter><PortfolioPage /></MemoryRouter>);

    expect(screen.getByText("You are offline.")).toBeVisible();
    expect(screen.getByText("Stale Set data.")).toBeVisible();
    expect(screen.getByText("Stale snapshot")).toBeVisible();
    expect(screen.getAllByText("Unsupported chain").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "set-eth actions" }).querySelectorAll("a")).toHaveLength(1);
  });

  it("announces loading and offers retry when the portfolio fails", () => {
    const retry = vi.fn();
    mocks.usePortfolio.mockReturnValue(result(undefined, {
      error: new Error("Registry offline"),
      loading: false,
      retry,
    }));

    render(<MemoryRouter><PortfolioPage /></MemoryRouter>);

    expect(screen.getByRole("alert")).toHaveTextContent("Registry offline");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });

  it("keeps position actions keyboard-reachable and labels regions for assistive tech", () => {
    const first = setData("set-alpha", 10);
    mocks.usePortfolio.mockReturnValue(result({
      externalLiquidity: undefined,
      externalLiquidityCoverage: { available: 0, total: 1 },
      freshness: {
        newestTimestamp: first.state.blockTimestamp,
        oldestTimestamp: first.state.blockTimestamp,
        stale: 0,
        status: "ready",
        total: 1,
      },
      publicTvl: {
        coverage: { available: 1, errors: 0, stale: 0, total: 1, unsupported: 0 },
        status: "ready",
        value: { numerator: 100n, denominator: 1n },
      },
      sets: [{
        snapshot: { ...first, status: "ready" },
        wallet: readyWallet(first.pool.id),
      }],
      userLiquidity: {
        coverage: { available: 1, errors: 0, stale: 0, total: 1, unsupported: 0 },
        status: "ready",
        value: { numerator: 50n, denominator: 1n },
      },
      walletLoading: false,
    }));

    render(<MemoryRouter><PortfolioPage /></MemoryRouter>);

    expect(screen.getByRole("region", { name: "Setwise liquidity overview" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Your Set liquidity" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Set positions" })).toBeVisible();

    const actions = screen.getByRole("navigation", { name: "set-alpha actions" });
    const links = within(actions).getAllByRole("link");
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).not.toHaveAttribute("tabindex", "-1");
      expect(link).toBeVisible();
    }
  });

  it("hides Sets whose wallet position is confirmed to hold no liquidity", () => {
    const owned = setData("set-alpha", 10);
    const empty = setData("set-beta", 20);
    mocks.usePortfolio.mockReturnValue(result({
      externalLiquidity: undefined,
      externalLiquidityCoverage: { available: 0, total: 2 },
      freshness: {
        newestTimestamp: owned.state.blockTimestamp,
        oldestTimestamp: owned.state.blockTimestamp,
        stale: 0,
        status: "ready",
        total: 2,
      },
      publicTvl: {
        coverage: { available: 2, errors: 0, stale: 0, total: 2, unsupported: 0 },
        status: "ready",
        value: { numerator: 200n, denominator: 1n },
      },
      sets: [
        { snapshot: { ...owned, status: "ready" }, wallet: readyWallet(owned.pool.id) },
        {
          snapshot: { ...empty, status: "ready" },
          wallet: {
            ...readyWallet(empty.pool.id, {
              canClaim: false,
              locked: 0n,
              lockedUntil: 0n,
              totalAttributed: 0n,
              unlocked: 0n,
            }),
            status: "zero-balance",
          },
        },
      ],
      userLiquidity: {
        coverage: { available: 2, errors: 0, stale: 0, total: 2, unsupported: 0 },
        status: "ready",
        value: { numerator: 50n, denominator: 1n },
      },
      walletLoading: false,
    }));

    render(<MemoryRouter><PortfolioPage /></MemoryRouter>);

    expect(screen.getByRole("article", { name: "Set set-alpha position" })).toBeVisible();
    expect(screen.queryByRole("article", { name: "Set set-beta position" })).not.toBeInTheDocument();
    expect(screen.getByText(/1 of 2 Sets/)).toBeVisible();
  });

  it("shows an empty positions state when no Set has attributed liquidity", () => {
    const first = setData("set-alpha", 10);
    mocks.usePortfolio.mockReturnValue(result({
      externalLiquidity: undefined,
      externalLiquidityCoverage: { available: 0, total: 1 },
      freshness: {
        newestTimestamp: first.state.blockTimestamp,
        oldestTimestamp: first.state.blockTimestamp,
        stale: 0,
        status: "ready",
        total: 1,
      },
      publicTvl: {
        coverage: { available: 1, errors: 0, stale: 0, total: 1, unsupported: 0 },
        status: "ready",
        value: { numerator: 100n, denominator: 1n },
      },
      sets: [{
        snapshot: { ...first, status: "ready" },
        wallet: {
          ...readyWallet(first.pool.id, {
            canClaim: false,
            locked: 0n,
            lockedUntil: 0n,
            totalAttributed: 0n,
            unlocked: 0n,
          }),
          status: "zero-balance",
        },
      }],
      userLiquidity: {
        coverage: { available: 1, errors: 0, stale: 0, total: 1, unsupported: 0 },
        status: "zero-balance",
        value: { numerator: 0n, denominator: 1n },
      },
      walletLoading: false,
    }));

    render(<MemoryRouter><PortfolioPage /></MemoryRouter>);

    expect(screen.getByRole("region", { name: "Set positions" })).toBeVisible();
    expect(screen.getByText(/No Set positions with attributed liquidity/i)).toBeVisible();
    expect(screen.getByText(/No attributed Set shares/i)).toBeVisible();
    expect(screen.queryByRole("article", { name: /^Set / })).not.toBeInTheDocument();
  });
});
