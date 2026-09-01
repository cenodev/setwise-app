import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AssetsPage } from "./AssetsPage";
import { tokenMetadataKey, type TokenMetadata } from "../data/tokens";

const mocks = vi.hoisted(() => ({
  fetchAssetMetricsCatalog: vi.fn(),
  useTokenCatalog: vi.fn(),
}));

vi.mock("../data/assetMetrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/assetMetrics")>();
  return { ...actual, fetchAssetMetricsCatalog: mocks.fetchAssetMetricsCatalog };
});

vi.mock("../data/tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/tokens")>();
  return { ...actual, useTokenCatalog: mocks.useTokenCatalog };
});

function token(
  symbol: string,
  underlyingSymbol: string,
  provider: string,
  address: string,
  chainId = 1,
): TokenMetadata {
  return {
    address,
    assetType: "equity",
    chainId,
    chainName: chainId === 1 ? "Ethereum" : "Polygon",
    name: `${underlyingSymbol} tokenized stock by ${provider}`,
    provider,
    symbol,
    underlyingLogoURI: `https://assets.example/${underlyingSymbol}.webp`,
    underlyingSymbol,
  };
}

function tableStockNames(): string[] {
  const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
  return rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

describe("AssetsPage", () => {
  const alphaFirst = token(
    "xALPHA",
    "ALPHA",
    "first-provider",
    "0x1000000000000000000000000000000000000000",
  );
  const alphaSecond = token(
    "yALPHA",
    "ALPHA",
    "second-provider",
    "0x2000000000000000000000000000000000000000",
    137,
  );
  const beta = token(
    "xBETA",
    "BETA",
    "first-provider",
    "0x3000000000000000000000000000000000000000",
  );
  const gamma = token(
    "xGAMMA",
    "GAMMA",
    "first-provider",
    "0x4000000000000000000000000000000000000000",
  );

  beforeEach(() => {
    mocks.fetchAssetMetricsCatalog.mockReset();
    mocks.useTokenCatalog.mockReset();
    mocks.useTokenCatalog.mockReturnValue({ data: undefined });
    mocks.fetchAssetMetricsCatalog.mockResolvedValue({
      cache: { ageSeconds: 30, maxStaleSeconds: 900, status: "fresh" },
      coverage: { batchCount: 1, pairCount: 3, supportedTokenCount: 4, tokenCount: 4 },
      generatedAt: "2026-08-11T18:05:00.000Z",
      metrics: new Map([
        [tokenMetadataKey(alphaFirst.chainId, alphaFirst.address), {
          liquidityUsd: 100,
          poolCount: 1,
          priceUsd: 42,
          topVenue: "uniswap",
          volume24hUsd: 10,
        }],
        [tokenMetadataKey(alphaSecond.chainId, alphaSecond.address), {
          liquidityUsd: 200,
          poolCount: 1,
          priceUsd: 41,
          topVenue: "quickswap",
          volume24hUsd: 20,
        }],
        [tokenMetadataKey(beta.chainId, beta.address), {
          liquidityUsd: 50,
          poolCount: 1,
          priceUsd: 20,
          topVenue: "uniswap",
          volume24hUsd: 200,
        }],
      ]),
      tokens: [alphaFirst, alphaSecond, beta, gamma],
    });
  });

  it("uses underlying logos from the direct token list when the metrics snapshot omits them", async () => {
    mocks.fetchAssetMetricsCatalog.mockResolvedValueOnce({
      cache: { ageSeconds: 30, maxStaleSeconds: 900, status: "fresh" },
      coverage: { batchCount: 1, pairCount: 1, supportedTokenCount: 1, tokenCount: 1 },
      generatedAt: "2026-08-11T18:05:00.000Z",
      metrics: new Map([[tokenMetadataKey(alphaFirst.chainId, alphaFirst.address), {
        liquidityUsd: 100,
        poolCount: 1,
        priceUsd: 42,
        topVenue: "uniswap",
        volume24hUsd: 10,
      }]]),
      tokens: [{ ...alphaFirst, underlyingLogoURI: undefined }],
    });
    mocks.useTokenCatalog.mockReturnValue({ data: [alphaFirst] });

    renderPage();

    const comparison = await screen.findByRole("region", { name: "Stock market comparison" });
    expect(comparison.querySelector("img")).toHaveAttribute(
      "src",
      "https://assets.example/ALPHA.webp",
    );
  });

  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AssetsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("renders one row per underlying stock with aggregated providers and metrics", async () => {
    renderPage();

    const comparison = await screen.findByRole("region", { name: "Stock market comparison" });
    const table = within(comparison).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Stock",
      "Best DEX price",
      expect.stringContaining("DEX liquidity"),
      expect.stringContaining("24h volume"),
      "Providers",
      "Networks",
    ]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(tableStockNames().map((name) => name.match(/ALPHA|BETA|GAMMA/)?.[0])).toEqual([
      "ALPHA",
      "BETA",
    ]);
    const alphaRow = within(table).getByRole("link", { name: /ALPHA/i }).closest("tr");
    expect(alphaRow).not.toBeNull();
    expect(within(alphaRow!).getByText("2")).toBeVisible();
    expect(within(alphaRow!).queryByText("First Provider, Second Provider")).not.toBeInTheDocument();
    expect(within(alphaRow!).getByText("$41.00")).toBeVisible();
    expect(within(alphaRow!).getByText("$300.00")).toBeVisible();
    const stockLogo = alphaRow!.querySelector("img");
    expect(stockLogo).toHaveAttribute(
      "src",
      "https://assets.example/ALPHA.webp",
    );
    expect(stockLogo).toHaveClass("token-icon--rounded-square");
    expect(within(alphaRow!).getByRole("link", { name: /ALPHA/i })).toHaveAttribute("href", "/assets/alpha");

    const mobileComparison = screen.getByRole("region", { name: "Mobile stock comparison" });
    expect(within(mobileComparison).getByRole("link", { name: /ALPHA/i })).toHaveAttribute(
      "href",
      "/assets/alpha",
    );
    expect(within(mobileComparison).getByText("2 providers")).toBeVisible();
    expect(within(mobileComparison).queryByText(/First Provider, Second Provider/i)).not.toBeInTheDocument();
  });

  it("searches by underlying ticker and provider", async () => {
    renderPage();
    await screen.findByRole("table");
    const search = screen.getByRole("textbox", { name: "Search stocks" });

    fireEvent.change(search, { target: { value: "BETA" } });
    expect(tableStockNames()).toEqual([expect.stringContaining("BETA")]);

    fireEvent.change(search, { target: { value: "second provider" } });
    expect(tableStockNames()).toEqual([expect.stringContaining("ALPHA")]);
  });

  it("shows liquid stocks by default and allows unavailable stocks to be included", async () => {
    renderPage();
    await screen.findByRole("table");
    const filter = screen.getByRole("switch", { name: "Only stocks with liquidity" });

    expect(filter).toBeChecked();
    expect(tableStockNames().map((name) => name.match(/ALPHA|BETA|GAMMA/)?.[0])).toEqual([
      "ALPHA",
      "BETA",
    ]);
    expect(screen.getByText("2 stocks")).toBeVisible();

    fireEvent.click(filter);
    expect(filter).not.toBeChecked();
    expect(tableStockNames().map((name) => name.match(/ALPHA|BETA|GAMMA/)?.[0])).toEqual([
      "ALPHA",
      "BETA",
      "GAMMA",
    ]);
    expect(screen.getByText("3 stocks")).toBeVisible();
  });

  it("sorts by volume while leaving unavailable metrics last", async () => {
    renderPage();
    const table = await screen.findByRole("table");
    fireEvent.click(screen.getByRole("switch", { name: "Only stocks with liquidity" }));

    fireEvent.click(within(table).getByRole("button", { name: /sort by 24h volume/i }));
    expect(tableStockNames().map((name) => name.match(/ALPHA|BETA|GAMMA/)?.[0])).toEqual([
      "ALPHA",
      "BETA",
      "GAMMA",
    ]);
    fireEvent.click(within(table).getByRole("button", { name: /24h volume.*ascending/i }));
    expect(tableStockNames().map((name) => name.match(/ALPHA|BETA|GAMMA/)?.[0])).toEqual([
      "BETA",
      "ALPHA",
      "GAMMA",
    ]);
  });
});
