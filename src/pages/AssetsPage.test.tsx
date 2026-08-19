import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AssetsPage } from "./AssetsPage";
import { tokenMetadataKey, type TokenMetadata } from "../data/tokens";

const mocks = vi.hoisted(() => ({
  fetchAssetMetricsCatalog: vi.fn(),
}));

vi.mock("../data/assetMetrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/assetMetrics")>();
  return { ...actual, fetchAssetMetricsCatalog: mocks.fetchAssetMetricsCatalog };
});

function token(symbol: string, address: string, assetType?: string): TokenMetadata {
  return {
    address,
    assetType,
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
        <MemoryRouter>
          <AssetsPage />
        </MemoryRouter>
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
    expect(screen.getAllByRole("link", { name: /ALPHA/i })[0]).toHaveAttribute(
      "href",
      "/assets/example%3Aalpha",
    );
    expect(screen.queryByText(/Token-holder rights/)).not.toBeInTheDocument();
  });

  it("filters out assets without positive liquidity", async () => {
    renderPage();

    await screen.findByRole("table");
    const liquidityFilter = screen.getByRole("switch", { name: "Only assets with liquidity" });
    expect(liquidityFilter).not.toBeChecked();

    fireEvent.click(liquidityFilter);
    expect(liquidityFilter).toBeChecked();
    expect(tableAssetNames().map((name) => name.match(/ALPHA|BETA|GAMMA/)?.[0])).toEqual([
      "ALPHA",
      "BETA",
    ]);
    expect(screen.getByText("2 assets")).toBeVisible();
  });

  it("paginates the sorted asset set and resets pagination when searching", async () => {
    const tokens = Array.from({ length: 51 }, (_, index) => token(
      `ASSET${String(index + 1).padStart(2, "0")}`,
      `0x${(index + 1).toString(16).padStart(40, "0")}`,
    ));
    mocks.fetchAssetMetricsCatalog.mockResolvedValue({
      cache: { ageSeconds: 30, maxStaleSeconds: 900, status: "fresh" },
      coverage: { batchCount: 2, pairCount: 0, supportedTokenCount: 51, tokenCount: 51 },
      generatedAt: "2026-08-11T18:05:00.000Z",
      metrics: new Map(),
      tokens,
    });
    renderPage();

    const pagination = await screen.findByRole("navigation", { name: "Asset pages" });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(51);
    expect(within(pagination).getByRole("spinbutton", { name: "Go to page" })).toHaveValue(1);

    fireEvent.click(within(pagination).getByRole("button", { name: "Go to next page" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    expect(within(screen.getByRole("table")).getByText("ASSET51")).toBeVisible();

    fireEvent.change(screen.getByRole("textbox", { name: "Search assets" }), {
      target: { value: "ASSET01" },
    });
    expect(within(screen.getByRole("table")).getByText("ASSET01")).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Asset pages" })).not.toBeInTheDocument();
  });

  it("filters assets by grouped market category tabs", async () => {
    const equity = token("EQUITY", "0x1000000000000000000000000000000000000001", "private-equity");
    const fund = token("FUND", "0x2000000000000000000000000000000000000002", "etf");
    const treasury = token("TREASURY", "0x3000000000000000000000000000000000000003", "treasury");
    const commodity = token("GOLD", "0x4000000000000000000000000000000000000004", "commodity");
    mocks.fetchAssetMetricsCatalog.mockResolvedValue({
      cache: { ageSeconds: 30, maxStaleSeconds: 900, status: "fresh" },
      coverage: { batchCount: 1, pairCount: 0, supportedTokenCount: 4, tokenCount: 4 },
      generatedAt: "2026-08-11T18:05:00.000Z",
      metrics: new Map(),
      tokens: [equity, fund, treasury, commodity],
    });
    renderPage();

    const categories = await screen.findByRole("navigation", { name: "Asset categories" });
    await screen.findByRole("table");
    expect(tableAssetNames()).toHaveLength(4);

    fireEvent.click(within(categories).getByRole("button", { name: "Equities" }));
    expect(tableAssetNames().map((name) => name.match(/EQUITY|FUND|TREASURY|GOLD/)?.[0])).toEqual(["EQUITY"]);
    expect(screen.getByText("1 asset")).toBeVisible();

    fireEvent.click(within(categories).getByRole("button", { name: "Fixed income" }));
    expect(tableAssetNames().map((name) => name.match(/EQUITY|FUND|TREASURY|GOLD/)?.[0])).toEqual(["TREASURY"]);

    fireEvent.click(within(categories).getByRole("button", { name: /More/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Commodities", hidden: true }));
    expect(tableAssetNames().map((name) => name.match(/EQUITY|FUND|TREASURY|GOLD/)?.[0])).toEqual(["GOLD"]);
  });
});
