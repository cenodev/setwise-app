import { act, fireEvent, render, screen, within } from "@testing-library/react";

import type { RoutedMarketOption } from "../../data/marketCatalog";
import {
  MarketPickerModal,
} from "./MarketPickerModal";
import {
  filterPickerMarkets,
  groupPickerMarkets,
} from "./marketPickerModel";

const markets: readonly RoutedMarketOption[] = [
  {
    address: "0xAbC0000000000000000000000000000000000001",
    assetProvider: { id: "backed", name: "Backed" },
    chainId: 1,
    logoURI: "https://example.com/nvdax.png",
    name: "NVIDIA xStock",
    symbol: "NVDAx",
    underlying: { logoURI: "https://example.com/nvda.png", name: "NVIDIA Corp", symbol: "NVDA" },
  },
  {
    address: "0xAbC0000000000000000000000000000000000002",
    assetProvider: { id: "omega", name: "Omega" },
    chainId: 1,
    name: "NVIDIA Omega",
    symbol: "nNVDA",
    underlying: { symbol: "NVDA" },
  },
  {
    address: "0xAbC0000000000000000000000000000000000003",
    assetProvider: { id: "backed", name: "Backed" },
    chainId: 8453,
    name: "Tesla xStock",
    symbol: "TSLAx",
    underlying: { symbol: "TSLA" },
  },
];

describe("filterPickerMarkets", () => {
  it("matches across stock, token, issuer, and address text", () => {
    expect(filterPickerMarkets(markets, { chainId: "all", providerId: "all", query: "nvda" })).toHaveLength(2);
    expect(filterPickerMarkets(markets, { chainId: "all", providerId: "all", query: "tesla" })).toHaveLength(1);
    expect(filterPickerMarkets(markets, { chainId: "all", providerId: "all", query: "omega" })).toHaveLength(1);
    expect(filterPickerMarkets(markets, { chainId: "all", providerId: "all", query: "0003" })).toHaveLength(1);
    expect(filterPickerMarkets(markets, { chainId: "all", providerId: "all", query: "nvda backed" })).toHaveLength(1);
  });

  it("filters by network and issuer", () => {
    expect(filterPickerMarkets(markets, { chainId: "8453", providerId: "all", query: "" })).toHaveLength(1);
    expect(filterPickerMarkets(markets, { chainId: "all", providerId: "omega", query: "" })).toHaveLength(1);
    expect(filterPickerMarkets(markets, { chainId: "1", providerId: "backed", query: "" })).toHaveLength(1);
  });
});

describe("groupPickerMarkets", () => {
  it("groups by underlying and sorts markets by chain", () => {
    const groups = groupPickerMarkets(markets);
    expect(groups.map((group) => group.underlying)).toEqual(["NVDA", "TSLA"]);
    expect(groups[0]?.markets.map((market) => market.symbol)).toEqual(["NVDAx", "nNVDA"]);
  });
});

describe("MarketPickerModal", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubViewport(initialMatches: boolean) {
    let matches = initialMatches;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      get matches() {
        return matches;
      },
      media: "",
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
    })));
    return {
      setMatches(next: boolean) {
        matches = next;
        listeners.forEach((listener) => listener());
      },
    };
  }
  function renderModal(selected: RoutedMarketOption | null = null) {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <MarketPickerModal
        capabilities={null}
        eligibleMarkets={markets}
        isOpen
        onOpenChange={onOpenChange}
        onSelect={onSelect}
        selectedMarket={selected}
      />,
    );
    return { onOpenChange, onSelect };
  }

  it("lists markets grouped by stock with token logos", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("3 of 3 markets")).toBeVisible();
    const dialog = screen.getByRole("dialog");
    // The underlying logo is a decorative image with the published URL.
    expect(dialog.querySelector('img[src="https://example.com/nvda.png"]')).not.toBeNull();
    // Markets without a logo fall back to symbol initials.
    expect(screen.getByText("TSLAx · Backed")).toBeVisible();
  });

  it("searches and filters by network and issuer", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Search markets"), { target: { value: "tesla" } });
    expect(screen.getByText("1 of 3 markets")).toBeVisible();
    expect(screen.queryByText("NVDAx · Backed")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search markets"), { target: { value: "no-such-market" } });
    expect(screen.getByRole("heading", { name: "No markets match" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("3 of 3 markets")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Base" }));
    expect(screen.getByText("1 of 3 markets")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "All networks" }));

    fireEvent.click(screen.getByRole("button", { name: "Omega" }));
    expect(screen.getByText("1 of 3 markets")).toBeVisible();
  });

  it("selects a market and closes the picker", () => {
    const { onOpenChange, onSelect } = renderModal();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /TSLAx · Backed/ }));
    expect(onSelect).toHaveBeenCalledWith(markets[2]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("uses a fixed standard dialog on desktop viewports", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-variant", "standard");
  });

  it("switches to fullscreen on narrow viewports and back", () => {
    const viewport = stubViewport(false);
    renderModal();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-variant", "standard");
    act(() => viewport.setMatches(true));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-variant", "fullscreen");
    act(() => viewport.setMatches(false));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-variant", "standard");
  });
});
