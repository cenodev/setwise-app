import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { isStaleSnapshot, SetDirectoryCard } from "./SetDirectoryCard";
import type { PoolState } from "../../data/rfq/deposits";
import type { SetDefinition } from "../../data/sets";
import type { TokenMetadataIndex } from "../../data/tokens";

const poolAddress = "0x1111111111111111111111111111111111111111";
const lpAddress = "0x2222222222222222222222222222222222222222";
const usdtAddress = "0x3333333333333333333333333333333333333333";
const bnbAddress = "0x4444444444444444444444444444444444444444";

function definition(id: string, chainId = 97): SetDefinition {
  return {
    chainId,
    chainName: chainId === 97 ? "BSC Testnet" : "Ethereum",
    id,
    supported: chainId === 97,
    pool: {
      id,
      display: { description: `Description for ${id}`, name: `Set ${id}`, sortOrder: 0 },
      chain: { id: chainId, name: chainId === 97 ? "BSC Testnet" : "Ethereum" },
      contract: { address: poolAddress },
      lpToken: { symbol: "SETWISE", decimals: 18, address: lpAddress },
      assets: [
        { id: "USDT", symbol: "mUSDT", address: usdtAddress, decimals: 6, weight: 50, index: 0 },
        { id: "BNB", symbol: "WBNB", address: bnbAddress, decimals: 18, weight: 50, index: 1 },
      ],
    },
  };
}

function state(poolId: string, overrides?: Partial<PoolState>): PoolState {
  return {
    poolId,
    chainId: 97,
    poolAddress,
    blockNumber: "12345",
    blockTimestamp: new Date().toISOString(),
    trading: { paused: false, deposits: "available" },
    totalValueUsd: "1234567.89",
    totalSupply: { amount: "1000000", atomicAmount: "1000000000000000000000000", decimals: 18 },
    assets: [
      {
        asset: "USDT", amount: "500000", atomicAmount: "500000000000", decimals: 6,
        index: 0, recordedAtomicBalance: "500000000000", actualAtomicBalance: "500000000000",
        balanceStatus: "synced", multiplier: "1", valueUsd: "500000",
        market: { bidUsd: "0.999", askUsd: "1.001", observedAt: new Date().toISOString() },
      },
      {
        asset: "BNB", amount: "1000", atomicAmount: "1000000000000000000000", decimals: 18,
        index: 1, recordedAtomicBalance: "1000000000000000000000", actualAtomicBalance: "1000000000000000000000",
        balanceStatus: "synced", multiplier: "1", valueUsd: "734567.89",
        market: { bidUsd: "734", askUsd: "735", observedAt: new Date().toISOString() },
      },
    ],
    ...overrides,
  };
}

const mocks = vi.hoisted(() => ({
  getPoolState: vi.fn(),
  online: true,
}));

vi.mock("../../data/rfq/deposits", () => ({
  getPoolState: mocks.getPoolState,
}));

vi.mock("../../lib/useOnlineStatus", () => ({
  useOnlineStatus: () => mocks.online,
}));

function renderCard(set: SetDefinition, tokenIndex?: TokenMetadataIndex) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SetDirectoryCard set={set} tokenIndex={tokenIndex} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SetDirectoryCard", () => {
  beforeEach(() => {
    mocks.getPoolState.mockReset();
    mocks.online = true;
  });

  it("renders Set metadata and constituent assets", () => {
    mocks.getPoolState.mockResolvedValue(state("alpha-set"));
    renderCard(definition("alpha-set"));

    expect(screen.getByRole("heading", { name: "alpha-set" })).toBeVisible();
    expect(screen.getByText("BSC Testnet")).toBeVisible();
    const assets = screen.getByRole("list", { name: "alpha-set constituents" });
    expect(assets).toBeVisible();
    expect(screen.getByText("mUSDT")).toBeVisible();
    expect(screen.getByText("WBNB")).toBeVisible();
    expect(screen.getAllByText("50%")).toHaveLength(2);
  });

  it("shows live TVL and snapshot when state loads", async () => {
    mocks.getPoolState.mockResolvedValue(state("alpha-set"));
    renderCard(definition("alpha-set"));

    expect(await screen.findByText("$1234567.89")).toBeVisible();
    expect(screen.getByText("Set TVL")).toBeVisible();
    expect(screen.getByText("Snapshot")).toBeVisible();
    expect(screen.getByText("Trading")).toBeVisible();
  });

  it("shows loading state while fetching pool state", () => {
    mocks.getPoolState.mockReturnValue(new Promise(() => {}));
    renderCard(definition("alpha-set"));

    expect(screen.getByText("Loading live state…")).toBeVisible();
  });

  it("shows per-card error with retry when state fetch fails", async () => {
    mocks.getPoolState.mockRejectedValue(new Error("state exploded"));
    renderCard(definition("alpha-set"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Live state unavailable");
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("retries state fetch on retry click", async () => {
    mocks.getPoolState
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue(state("alpha-set"));
    renderCard(definition("alpha-set"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Live state unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("$1234567.89")).toBeVisible();
  });

  it("shows paused status when trading is paused", async () => {
    mocks.getPoolState.mockResolvedValue(
      state("alpha-set", { trading: { paused: true, deposits: "paused" } }),
    );
    renderCard(definition("alpha-set"));

    expect(await screen.findByText("Paused")).toBeVisible();
  });

  it("shows stale badge for old snapshots", async () => {
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    mocks.getPoolState.mockResolvedValue(
      state("alpha-set", { blockTimestamp: oldTimestamp }),
    );
    renderCard(definition("alpha-set"));

    expect(await screen.findByText("Stale")).toBeVisible();
  });

  it("shows unsupported chain message and hides swap for unsupported Sets", () => {
    renderCard(definition("eth-set", 1));

    expect(screen.getByText("Unsupported chain")).toBeVisible();
    expect(screen.getByText(/not supported in this environment/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Swap" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Set" })).toHaveAttribute(
      "href",
      "/sets/eth-set/overview",
    );
  });

  it("does not fetch state for unsupported-chain Sets", () => {
    renderCard(definition("eth-set", 1));
    expect(mocks.getPoolState).not.toHaveBeenCalled();
  });

  it("links to the correct detail and swap routes", () => {
    mocks.getPoolState.mockResolvedValue(state("alpha-set"));
    renderCard(definition("alpha-set"));

    expect(screen.getByRole("link", { name: "View Set" })).toHaveAttribute(
      "href",
      "/sets/alpha-set/overview",
    );
    expect(screen.getByRole("link", { name: "Swap" })).toHaveAttribute(
      "href",
      "/swap?set=alpha-set",
    );
  });

  it("distinguishes Set TVL from external DEX liquidity", () => {
    mocks.getPoolState.mockResolvedValue(state("alpha-set"));
    renderCard(definition("alpha-set"));

    expect(
      screen.getByText(/not external DEX liquidity/i),
    ).toBeVisible();
  });

  it("uses token metadata logos when available", async () => {
    mocks.getPoolState.mockResolvedValue(state("alpha-set"));
    const index = new Map([
      [`97:${usdtAddress.toLowerCase()}`, {
        address: usdtAddress, chainId: 97, name: "Mock USDT", symbol: "mUSDT",
        logoURI: "https://example.com/usdt.png",
      }],
    ]) as unknown as TokenMetadataIndex;
    renderCard(definition("alpha-set"), index);

    const logo = await screen.findByAltText("");
    expect(logo).toHaveAttribute("src", "https://example.com/usdt.png");
  });

  it("does not fetch state when offline", () => {
    mocks.online = false;
    mocks.getPoolState.mockReturnValue(new Promise(() => {}));
    renderCard(definition("alpha-set"));

    expect(screen.getByText("Loading live state…")).toBeVisible();
  });
});

describe("isStaleSnapshot", () => {
  it("returns false for a recent timestamp", () => {
    const now = Date.now();
    expect(isStaleSnapshot(new Date(now - 60_000).toISOString(), now)).toBe(false);
  });

  it("returns true for a timestamp older than five minutes", () => {
    const now = Date.now();
    expect(isStaleSnapshot(new Date(now - 6 * 60 * 1000).toISOString(), now)).toBe(true);
  });

  it("returns true for an invalid timestamp", () => {
    expect(isStaleSnapshot("not-a-date")).toBe(true);
  });
});
