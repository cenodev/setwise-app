import { useEffect, useState } from "react";

import type { RoutedMarketOption } from "../../data/marketCatalog";

export type MarketPickerFilters = Readonly<{
  chainId: string;
  providerId: string;
  query: string;
}>;

/**
 * Narrow-viewport flag for adaptive modal sizing (standard dialog on desktop,
 * fullscreen below the breakpoint). Defaults to desktop when `matchMedia` is
 * unavailable (for example in tests).
 */
export function useIsNarrowViewport(breakpointPx = 640): boolean {
  const query = `(max-width: ${breakpointPx - 1}px)`;
  const [isNarrow, setIsNarrow] = useState<boolean>(() => (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false
  ));
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setIsNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return isNarrow;
}

/** Pure search + network + issuer filtering for the market picker list. */
export function filterPickerMarkets(
  markets: readonly RoutedMarketOption[],
  filters: MarketPickerFilters,
): readonly RoutedMarketOption[] {
  const needle = filters.query.trim().toLowerCase();
  return markets.filter((market) => {
    if (filters.chainId !== "all" && market.chainId !== Number(filters.chainId)) return false;
    if (filters.providerId !== "all" && market.assetProvider.id !== filters.providerId) return false;
    if (needle === "") return true;
    const haystack = [
      market.underlying.symbol,
      market.underlying.name ?? "",
      market.symbol,
      market.name,
      market.assetProvider.id,
      market.assetProvider.name,
      market.address,
    ].join(" ").toLowerCase();
    return needle.split(/\s+/).every((token) => haystack.includes(token));
  });
}

export type MarketPickerGroup = Readonly<{
  underlying: string;
  markets: readonly RoutedMarketOption[];
}>;

/** Pure grouping of picker markets by underlying, sorted for display. */
export function groupPickerMarkets(
  markets: readonly RoutedMarketOption[],
): readonly MarketPickerGroup[] {
  const byUnderlying = new Map<string, RoutedMarketOption[]>();
  for (const market of markets) {
    const key = market.underlying.symbol;
    byUnderlying.set(key, [...(byUnderlying.get(key) ?? []), market]);
  }
  return [...byUnderlying.entries()]
    .map(([underlying, group]) => ({
      underlying,
      markets: [...group].sort(
        (a, b) => a.chainId - b.chainId || a.assetProvider.name.localeCompare(b.assetProvider.name),
      ),
    }))
    .sort((a, b) => a.underlying.localeCompare(b.underlying));
}
