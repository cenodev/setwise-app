import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { SetsPage, sortSets } from "./SetsPage";
import type { PoolSummary } from "../data/rfq/pools";
import type { PoolState } from "../data/rfq/deposits";
import type { SetDefinition } from "../data/sets";

const poolAddress = "0x1111111111111111111111111111111111111111";
const lpAddress = "0x2222222222222222222222222222222222222222";
const usdtAddress = "0x3333333333333333333333333333333333333333";

function summary(id: string, chainId = 97, sortOrder = 0): PoolSummary {
  return {
    id,
    display: { description: `Description for ${id}`, name: `Set ${id}`, sortOrder },
    chain: { id: chainId, name: chainId === 97 ? "BSC Testnet" : "Ethereum" },
    contract: { address: poolAddress },
    lpToken: { symbol: "SETWISE", decimals: 18, address: lpAddress },
    assets: [
      { id: "USDT", symbol: "mUSDT", address: usdtAddress, decimals: 6, weight: 50, index: 0 },
    ],
  };
}

function state(poolId: string): PoolState {
  return {
    poolId,
    chainId: 97,
    poolAddress,
    blockNumber: "12345",
    blockTimestamp: new Date().toISOString(),
    trading: { paused: false, deposits: "available" },
    totalValueUsd: "999.99",
    totalSupply: { amount: "1000", atomicAmount: "1000000000000000000000", decimals: 18 },
    assets: [
      {
        asset: "USDT", amount: "999", atomicAmount: "999000000", decimals: 6,
        index: 0, recordedAtomicBalance: "999000000", actualAtomicBalance: "999000000",
        balanceStatus: "synced", multiplier: "1", valueUsd: "999.99",
        market: { bidUsd: "0.999", askUsd: "1.001", observedAt: new Date().toISOString() },
      },
    ],
  };
}

const mocks = vi.hoisted(() => ({
  getPools: vi.fn(),
  getPoolState: vi.fn(),
  online: true,
}));

vi.mock("../data/rfq/pools", () => ({
  getPools: mocks.getPools,
}));

vi.mock("../data/rfq/deposits", () => ({
  getPoolState: mocks.getPoolState,
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

function renderPage(path = "/sets") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <SetsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SetsPage", () => {
  beforeEach(() => {
    mocks.getPools.mockReset();
    mocks.getPoolState.mockReset();
    mocks.online = true;
  });

  it("shows loading state while the registry is pending", () => {
    mocks.getPools.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByText("Loading Sets…")).toBeVisible();
  });

  it("shows an error panel with retry when the registry fails", async () => {
    mocks.getPools
      .mockRejectedValueOnce(new Error("registry down"))
      .mockResolvedValue([summary("alpha-set")]);
    mocks.getPoolState.mockResolvedValue(state("alpha-set"));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("registry down");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Set alpha-set" })).toBeVisible();
  });

  it("shows an empty state when the registry returns no Sets", async () => {
    mocks.getPools.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByRole("heading", { name: "No Sets yet" })).toBeVisible();
  });

  it("renders one card per registry Set", async () => {
    mocks.getPools.mockResolvedValue([
      summary("beta-set"),
      summary("alpha-set"),
    ]);
    mocks.getPoolState.mockResolvedValue(state("alpha-set"));
    renderPage();

    expect(await screen.findByRole("heading", { name: "Set alpha-set" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Set beta-set" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Set directory" })).toBeVisible();
  });

  it("sorts Sets by configured display order with a deterministic id fallback", async () => {
    mocks.getPools.mockResolvedValue([
      summary("zeta-set", 97, 30),
      summary("alpha-set", 97, 10),
      summary("mid-set", 97, 20),
    ]);
    mocks.getPoolState.mockResolvedValue(state("alpha-set"));
    renderPage();

    await screen.findByRole("heading", { name: "Set alpha-set" });
    const directory = screen.getByRole("region", { name: "Set directory" });
    const headings = within(directory).getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(["Set alpha-set", "Set mid-set", "Set zeta-set"]);
  });

  it("links every Set to its detail route", async () => {
    mocks.getPools.mockResolvedValue([summary("alpha-set")]);
    mocks.getPoolState.mockResolvedValue(state("alpha-set"));
    renderPage();

    await screen.findByRole("heading", { name: "Set alpha-set" });
    expect(screen.getByRole("link", { name: "View Set" })).toHaveAttribute(
      "href",
      "/sets/alpha-set/overview",
    );
  });

  it("provides a swap action only for supported Sets", async () => {
    mocks.getPools.mockResolvedValue([
      summary("alpha-set"),
      summary("eth-set", 1),
    ]);
    mocks.getPoolState.mockResolvedValue(state("alpha-set"));
    renderPage();

    await screen.findByRole("heading", { name: "Set alpha-set" });
    const alphaCard = screen.getByRole("article", { name: "Set alpha-set" });
    expect(within(alphaCard).getByRole("link", { name: "Swap" })).toHaveAttribute(
      "href",
      "/swap?set=alpha-set",
    );

    const ethCard = screen.getByRole("article", { name: "Set eth-set" });
    expect(within(ethCard).queryByRole("link", { name: "Swap" })).not.toBeInTheDocument();
  });

  it("isolates a failed state request to its own card", async () => {
    mocks.getPools.mockResolvedValue([
      summary("alpha-set"),
      summary("beta-set"),
    ]);
    mocks.getPoolState.mockImplementation((poolId: string) =>
      poolId === "alpha-set"
        ? Promise.reject(new Error("alpha state failed"))
        : Promise.resolve(state("beta-set")),
    );
    renderPage();

    const alphaCard = await screen.findByRole("article", { name: "Set alpha-set" });
    expect(await within(alphaCard).findByRole("alert")).toHaveTextContent("Live state unavailable");

    const betaCard = screen.getByRole("article", { name: "Set beta-set" });
    expect(await within(betaCard).findByText("$999.99")).toBeVisible();
    expect(within(betaCard).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not require a wallet connection", async () => {
    mocks.getPools.mockResolvedValue([summary("alpha-set")]);
    mocks.getPoolState.mockResolvedValue(state("alpha-set"));
    renderPage();

    expect(await screen.findByRole("heading", { name: "Set alpha-set" })).toBeVisible();
    expect(screen.queryByText(/connect wallet/i)).not.toBeInTheDocument();
  });

  it("shows the legacy redirect notice when the notice param is present", async () => {
    mocks.getPools.mockResolvedValue([summary("alpha-set")]);
    mocks.getPoolState.mockResolvedValue(state("alpha-set"));
    renderPage("/sets?notice=legacy-redirect");

    expect(await screen.findByText(/That link is no longer used/)).toBeVisible();
  });
});

describe("sortSets", () => {
  function def(id: string): SetDefinition {
    return {
      chainId: 97,
      chainName: "BSC Testnet",
      id,
      supported: true,
      pool: summary(id),
    };
  }

  it("uses id as the deterministic fallback when display orders match", () => {
    const sorted = sortSets([def("zeta"), def("alpha"), def("mid")]);
    expect(sorted.map((s) => s.id)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("returns an empty array for empty input", () => {
    expect(sortSets([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [def("b"), def("a")];
    sortSets(input);
    expect(input.map((s) => s.id)).toEqual(["b", "a"]);
  });
});
