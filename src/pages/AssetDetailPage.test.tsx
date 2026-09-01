import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AssetDetailPage } from "./AssetDetailPage";
import { tokenMetadataKey, type TokenMetadata } from "../data/tokens";

const mocks = vi.hoisted(() => ({
  fetchAssetMetricsCatalog: vi.fn(),
}));

vi.mock("../data/assetMetrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/assetMetrics")>();
  return { ...actual, fetchAssetMetricsCatalog: mocks.fetchAssetMetricsCatalog };
});

function token(
  chainId: number,
  chainName: string,
  address: string,
  provider: string,
  symbol: string,
): TokenMetadata {
  return {
    address,
    assetType: "equity",
    chainId,
    chainName,
    name: "Alpha tokenized stock",
    provider,
    symbol,
    underlyingSymbol: "ALPHA",
  };
}

function renderPage(path = "/assets/alpha") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/assets/:assetId" element={<AssetDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AssetDetailPage", () => {
  const ethereum = token(
    1,
    "Ethereum",
    "0x1000000000000000000000000000000000000000",
    "first-provider",
    "xALPHA",
  );
  const polygon = token(
    137,
    "Polygon",
    "0x2000000000000000000000000000000000000000",
    "second-provider",
    "yALPHA",
  );

  beforeEach(() => {
    mocks.fetchAssetMetricsCatalog.mockReset();
    mocks.fetchAssetMetricsCatalog.mockResolvedValue({
      cache: { ageSeconds: 30, maxStaleSeconds: 900, status: "fresh" },
      coverage: { batchCount: 1, pairCount: 2, supportedTokenCount: 2, tokenCount: 2 },
      generatedAt: "2026-08-16T21:00:45.704Z",
      metrics: new Map([
        [tokenMetadataKey(ethereum.chainId, ethereum.address), {
          liquidityUsd: 1_250,
          poolCount: 3,
          priceUsd: 42.125,
          topVenue: "uniswap",
          volume24hUsd: 450,
        }],
        [tokenMetadataKey(polygon.chainId, polygon.address), {
          liquidityUsd: 500,
          poolCount: 2,
          priceUsd: 41.5,
          topVenue: "quickswap",
          volume24hUsd: 200,
        }],
      ]),
      tokens: [ethereum, polygon],
    });
  });

  it("compares every provider and identifies best price and liquidity", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "ALPHA" })).toBeVisible();
    expect(screen.getByText(/2 tokenized markets from 2 providers/i)).toBeVisible();
    expect(screen.getAllByText("$1.8K")).not.toHaveLength(0);
    expect(screen.getAllByText("$650.00")).not.toHaveLength(0);
    expect(screen.getAllByText("$41.50")).not.toHaveLength(0);

    const comparison = screen.getByRole("region", { name: "Tokenized stock provider comparison" });
    const table = within(comparison).getByRole("table");
    const firstProviderRow = within(table).getByText("First Provider").closest("tr");
    const secondProviderRow = within(table).getByText("Second Provider").closest("tr");
    expect(firstProviderRow).not.toBeNull();
    expect(secondProviderRow).not.toBeNull();
    expect(within(firstProviderRow!).getByText("Best liquidity")).toBeVisible();
    expect(within(secondProviderRow!).getByText("Best price")).toBeVisible();
    expect(within(firstProviderRow!).getByText("Ethereum")).toBeVisible();
    expect(within(secondProviderRow!).getByText("Polygon")).toBeVisible();

    const mobileComparison = screen.getByRole("region", {
      name: "Mobile tokenized stock provider comparison",
    });
    expect(within(mobileComparison).getByText("First Provider")).toBeVisible();
    expect(within(mobileComparison).getByText("Second Provider")).toBeVisible();
    expect(within(mobileComparison).getByText("Ethereum · uniswap")).toBeVisible();
    expect(within(mobileComparison).getByText("Polygon · quickswap")).toBeVisible();
  });

  it("keeps legacy provider-prefixed stock URLs working", async () => {
    renderPage("/assets/first-provider%3Aalpha");

    expect(await screen.findByRole("heading", { level: 1, name: "ALPHA" })).toBeVisible();
  });

  it("renders an explicit not-found state for an unknown stock", async () => {
    renderPage("/assets/missing");

    expect(await screen.findByRole("heading", { name: "Stock not found" })).toBeVisible();
    expect(screen.getByText(/underlying stock is not present/i)).toBeVisible();
  });

  it("keeps providers visible when DEX metrics are unavailable", async () => {
    mocks.fetchAssetMetricsCatalog.mockResolvedValueOnce({
      cache: { ageSeconds: 30, maxStaleSeconds: 900, status: "fresh" },
      coverage: { batchCount: 1, pairCount: 0, supportedTokenCount: 2, tokenCount: 2 },
      generatedAt: "2026-08-16T21:00:45.704Z",
      metrics: new Map(),
      tokens: [ethereum, polygon],
    });

    renderPage();

    const comparison = await screen.findByRole("region", { name: "Tokenized stock provider comparison" });
    const table = within(comparison).getByRole("table");
    expect(within(table).getByText("First Provider")).toBeVisible();
    expect(within(table).getByText("Second Provider")).toBeVisible();
    expect(screen.getByText(/2 tokenized markets from 2 providers/i)).toBeVisible();
  });
});
