import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

function token(chainId: number, chainName: string, address: string): TokenMetadata {
  return {
    address,
    assetType: "equity",
    chainId,
    chainName,
    name: "Alpha tokenized stock",
    provider: "example",
    symbol: "xALPHA",
    underlyingSymbol: "ALPHA",
  };
}

function renderPage(path = "/assets/example%3Aalpha") {
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
  beforeEach(() => {
    const ethereum = token(1, "Ethereum", "0x1000000000000000000000000000000000000000");
    const polygon = token(137, "Polygon", "0x2000000000000000000000000000000000000000");
    mocks.fetchAssetMetricsCatalog.mockReset();
    mocks.fetchAssetMetricsCatalog.mockResolvedValue({
      cache: { ageSeconds: 30, maxStaleSeconds: 900, status: "fresh" },
      coverage: { batchCount: 1, pairCount: 2, supportedTokenCount: 1, tokenCount: 2 },
      generatedAt: "2026-08-16T21:00:45.704Z",
      metrics: new Map([
        [tokenMetadataKey(ethereum.chainId, ethereum.address), {
          liquidityUsd: 1_250,
          poolCount: 3,
          priceUsd: 42.125,
          topVenue: "uniswap",
          volume24hUsd: 450,
        }],
      ]),
      tokens: [ethereum, polygon],
    });
  });

  it("shows aggregate metrics and every network deployment", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "ALPHA" })).toBeVisible();
    expect(screen.getAllByText("$1.3K")).not.toHaveLength(0);
    expect(screen.getAllByText("$450.00")).not.toHaveLength(0);
    expect(screen.getAllByText("$42.13")).not.toHaveLength(0);
    expect(screen.getAllByText("uniswap")).not.toHaveLength(0);
    expect(screen.getAllByText("Ethereum")).not.toHaveLength(0);
    expect(screen.getAllByText("Polygon")).not.toHaveLength(0);
    expect(screen.getAllByText("0x2000000000000000000000000000000000000000")).not.toHaveLength(0);
  });

  it("renders an explicit not-found state for an unknown asset id", async () => {
    renderPage("/assets/example%3Amissing");

    expect(await screen.findByRole("heading", { name: "Asset not found" })).toBeVisible();
    expect(screen.getByText(/not present in the current Setwise token list/i)).toBeVisible();
  });
});
