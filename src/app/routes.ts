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
