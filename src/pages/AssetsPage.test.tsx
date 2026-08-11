import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { AssetsPage } from "./AssetsPage";
import { tokenMetadataKey, type TokenMetadata } from "../data/tokens";

const mocks = vi.hoisted(() => ({
  fetchAssetMetricsCatalog: vi.fn(),
}));

vi.mock("../data/assetMetrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/assetMetrics")>();
  return { ...actual, fetchAssetMetricsCatalog: mocks.fetchAssetMetricsCatalog };
});

function token(symbol: string, address: string): TokenMetadata {
  return {
    address,
    chainId: 1,
    chainName: "Ethereum",
    name: `${symbol} asset`,
    provider: "example",
    symbol,
  };
}

function tableAssetNames(): string[] {
  const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
  return rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

describe("AssetsPage sorting", () => {
  beforeEach(() => {
    const alpha = token("ALPHA", "0x1000000000000000000000000000000000000000");
    const beta = token("BETA", "0x2000000000000000000000000000000000000000");
    const gamma = token("GAMMA", "0x3000000000000000000000000000000000000000");
    mocks.fetchAssetMetricsCatalog.mockReset();
    mocks.fetchAssetMetricsCatalog.mockResolvedValue({
      cache: { ageSeconds: 30, maxStaleSeconds: 900, status: "fresh" },
      coverage: { batchCount: 1, pairCount: 2, supportedTokenCount: 3, tokenCount: 3 },
      generatedAt: "2026-08-11T18:05:00.000Z",
      metrics: new Map([
        [tokenMetadataKey(alpha.chainId, alpha.address), {
          liquidityUsd: 100,
          poolCount: 1,
          priceUsd: 1,
          topVenue: "uniswap",
          volume24hUsd: 10,
        }],
        [tokenMetadataKey(beta.chainId, beta.address), {
          liquidityUsd: 50,
          poolCount: 1,
          priceUsd: 1,
          topVenue: "uniswap",
          volume24hUsd: 200,
        }],
      ]),
      tokens: [alpha, beta, gamma],
    });
  });

  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <AssetsPage />
      </QueryClientProvider>,
    );
  }

  it("sorts liquidity and volume while keeping unavailable metrics last", async () => {
    renderPage();

    const table = await screen.findByRole("table");
    expect(within(table).getByRole("button", { name: /liquidity.*descending/i })).toBeVisible();
    expect(tableAssetNames()).toEqual(expect.arrayContaining([expect.stringContaining("ALPHA")]));
    expect(tableAssetNames().map((name) => name.match(/ALPHA|BETA|GAMMA/)?.[0])).toEqual([
      "ALPHA",
      "BETA",
      "GAMMA",
    ]);

    fireEvent.click(within(table).getByRole("button", { name: /sort by 24h volume/i }));
    expect(tableAssetNames().map((name) => name.match(/ALPHA|BETA|GAMMA/)?.[0])).toEqual([
      "ALPHA",
      "BETA",
      "GAMMA",
    ]);

    fireEvent.click(within(table).getByRole("button", { name: /24h volume.*ascending/i }));
    expect(tableAssetNames().map((name) => name.match(/ALPHA|BETA|GAMMA/)?.[0])).toEqual([
      "BETA",
      "ALPHA",
      "GAMMA",
    ]);

    fireEvent.click(within(table).getByRole("button", { name: /sort by liquidity/i }));
    expect(tableAssetNames().map((name) => name.match(/ALPHA|BETA|GAMMA/)?.[0])).toEqual([
      "BETA",
      "ALPHA",
      "GAMMA",
    ]);
  });

  it("uses network logos and omits long descriptions", async () => {
    renderPage();

    expect(await screen.findAllByRole("img", { name: "Networks: Ethereum" })).not.toHaveLength(0);
    expect(screen.queryByText(/Token-holder rights/)).not.toBeInTheDocument();
  });
});
