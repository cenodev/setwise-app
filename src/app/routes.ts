import { runtimeConfig } from "../config/env";

export type SetTab = "overview" | "deposit" | "withdraw";

export const SET_TABS: readonly { label: string; tab: SetTab }[] = [
  { label: "Overview", tab: "overview" },
  { label: "Deposit", tab: "deposit" },
  { label: "Withdraw", tab: "withdraw" },
] as const;

export function setsPath(): string {
  return "/sets";
}

export function assetsPath(): string {
  return "/";
}

export function assetPath(assetId: string): string {
  return `/assets/${encodeURIComponent(assetId)}`;
}

export function setPath(setId: string, tab: SetTab = "overview"): string {
  return `/sets/${encodeURIComponent(setId)}/${tab}`;
}

export function portfolioPath(): string {
  return "/portfolio";
}

export function swapPath(setId?: string): string {
  if (!setId) return "/swap";
  return `/swap?set=${encodeURIComponent(setId)}`;
}

/** Chain-qualified destination market preselection for the routed swap route. */
export type RoutedSwapMarketParam = Readonly<{
  address: string;
  chainId: number;
}>;

export function routedSwapPath(market?: RoutedSwapMarketParam): string {
  if (!market) return "/swap/routed";
  return `/swap/routed?chain=${market.chainId}&token=${encodeURIComponent(market.address)}`;
}

const routedSwapTokenPattern = /^0x[0-9a-fA-F]{40}$/;

/**
 * Parses the routed swap destination-market query state. Malformed parameters
 * are ignored rather than guessed at, so a broken deep link can never silently
 * preselect different money.
 */
export function readRoutedSwapMarketParam(searchParams: URLSearchParams): RoutedSwapMarketParam | null {
  const chainId = Number(searchParams.get("chain"));
  const address = searchParams.get("token") ?? "";
  if (!Number.isInteger(chainId) || chainId <= 0) return null;
  if (!routedSwapTokenPattern.test(address)) return null;
  return { address, chainId };
}

export function activityPath(): string {
  return "/activity";
}

export function faucetPath(): string {
  return "/faucet";
}

/** Legacy configured Set id used only for compatibility redirects. */
export function legacyConfiguredSetId(): string | null {
  const id = runtimeConfig.defaultPoolId.trim();
  return id.length > 0 ? id : null;
}

export type LegacyRouteTarget =
  | { kind: "set-tab"; path: string; setId: string; tab: SetTab }
  | { kind: "sets-directory"; path: string; reason: "missing-legacy-set" };

/**
 * Map retired single-pool URLs onto the multi-Set route contract.
 * When no legacy Set is configured, send users to the directory with a notice.
 */
export function resolveLegacyRoute(tab: SetTab): LegacyRouteTarget {
  const setId = legacyConfiguredSetId();
  if (!setId) {
    return {
      kind: "sets-directory",
      path: `${setsPath()}?notice=legacy-redirect`,
      reason: "missing-legacy-set",
    };
  }
  return {
    kind: "set-tab",
    path: setPath(setId, tab),
    setId,
    tab,
  };
}
