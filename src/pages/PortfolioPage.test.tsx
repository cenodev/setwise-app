import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Address } from "viem";

import type { PortfolioView, UsePortfolioResult } from "../features/portfolio/usePortfolio";
import type { Pool, PoolState } from "../data/rfq/deposits";
import type { PoolSummary } from "../data/rfq/pools";
import { toSetDefinition } from "../data/sets";
import { PortfolioPage } from "./PortfolioPage";

const mocks = vi.hoisted(() => ({ usePortfolio: vi.fn() }));

vi.mock("../features/portfolio/usePortfolio", async (importOriginal) => {
  const original = await importOriginal<typeof import("../features/portfolio/usePortfolio")>();
  return { ...original, usePortfolio: mocks.usePortfolio };
});

const account = "0x0000000000000000000000000000000000000001" as Address;

function address(value: number): Address {
  return `0x${value.toString(16).padStart(40, "0")}`;
}

function setData(id: string, offset: number, chainId = 97) {
  const summary = {
    assets: [{ address: address(offset + 3), decimals: 6, id: `${id}-asset`, index: 0, symbol: "USDT", weight: 100 }],
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
  } as PoolState;
  return { definition, pool, state };
}

function result(view: PortfolioView): UsePortfolioResult {
  return { error: null, loading: false, refreshing: false, retry: vi.fn(), view };
}

describe("PortfolioPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows aggregate and per-Set values while marking partial coverage", () => {
    const first = setData("set-alpha", 10);
    const failed = setData("set-beta", 20);
    mocks.usePortfolio.mockReturnValue(result({
      externalLiquidity: { sources: [], totalValueUsd: { numerator: 0n, denominator: 1n } },
      externalLiquidityCoverage: { available: 2, total: 2 },
      freshness: { newestTimestamp: first.state.blockTimestamp, oldestTimestamp: first.state.blockTimestamp, stale: 0, status: "partial", total: 2 },
      publicTvl: { coverage: { available: 1, errors: 1, stale: 0, total: 2, unsupported: 0 }, status: "partial", value: { numerator: 100n, denominator: 1n } },
      sets: [
        {
          snapshot: { ...first, status: "ready" },
          wallet: {
            poolId: first.pool.id,
            position: {
              account,
              assetBalances: [],
              blockNumber: 110n,
              chainId: 97,
              nativeBalance: 0n,
              shares: { canClaim: false, locked: 2_000_000n, lockedUntil: 0n, totalAttributed: 5_000_000n, unlocked: 3_000_000n },
            },
            status: "ready",
          },
        },
        { snapshot: { definition: failed.definition, error: new Error("offline"), status: "error" }, wallet: { error: new Error("offline"), poolId: failed.pool.id, status: "error" } },
      ],
      userLiquidity: { coverage: { available: 1, errors: 1, stale: 0, total: 2, unsupported: 0 }, status: "partial", value: { numerator: 50n, denominator: 1n } },
      walletLoading: false,
    }));

    render(<MemoryRouter><PortfolioPage /></MemoryRouter>);

    expect(screen.getByText("Partial portfolio.")).toBeVisible();
    const totals = screen.getByRole("region", { name: "Portfolio totals" });
    expect(within(totals).getByText("$100.00")).toBeVisible();
    expect(within(totals).getByText("$50.00")).toBeVisible();
    expect(within(totals).getByText(/separate from Set reserves/i)).toBeVisible();
    const firstCard = screen.getByRole("heading", { name: "set-alpha" }).closest("article");
    expect(firstCard).not.toBeNull();
    expect(within(firstCard as HTMLElement).getByText("100.00%")).toBeVisible();
    expect(within(firstCard as HTMLElement).getByText("Snapshot block 110")).toBeVisible();
    expect(screen.getByText("Public data unavailable")).toBeVisible();
  });

  it("renders disconnected, stale, and unsupported states explicitly", () => {
    const stale = setData("set-stale", 10);
    const unsupported = setData("set-eth", 20, 1);
    mocks.usePortfolio.mockReturnValue(result({
      externalLiquidity: { sources: [], totalValueUsd: { numerator: 0n, denominator: 1n } },
      externalLiquidityCoverage: { available: 2, total: 2 },
      freshness: { newestTimestamp: stale.state.blockTimestamp, oldestTimestamp: stale.state.blockTimestamp, stale: 1, status: "stale", total: 2 },
      publicTvl: { coverage: { available: 1, errors: 0, stale: 1, total: 2, unsupported: 1 }, status: "partial", value: { numerator: 100n, denominator: 1n } },
      sets: [
        { snapshot: { ...stale, status: "stale" }, wallet: { poolId: stale.pool.id, status: "disconnected" } },
        { snapshot: { definition: unsupported.definition, status: "unsupported-chain" }, wallet: { chainId: 1, poolId: unsupported.pool.id, status: "unsupported-chain" } },
      ],
      userLiquidity: { coverage: { available: 0, errors: 0, stale: 0, total: 2, unsupported: 1 }, status: "disconnected" },
      walletLoading: false,
    }));

    render(<MemoryRouter><PortfolioPage /></MemoryRouter>);

    expect(screen.getAllByText("Connect wallet")).toHaveLength(2);
    expect(screen.getByText("Stale snapshot")).toBeVisible();
    expect(screen.getByText("Unsupported chain")).toBeVisible();
    expect(screen.getByText("Stale Set data.")).toBeVisible();
  });
});
