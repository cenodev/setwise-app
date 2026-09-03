import { assetPath, assetsPath, readRoutedSwapMarketParam, resolveLegacyRoute, routedSwapPath, setPath, setsPath, swapPath } from "./routes";
import { runtimeConfig } from "../config/env";

describe("route helpers", () => {
  it("builds Set tab paths with encoded ids", () => {
    expect(setPath("bstock-ai", "overview")).toBe("/sets/bstock-ai/overview");
    expect(setPath("a/b", "deposit")).toBe("/sets/a%2Fb/deposit");
  });

  it("builds swap deep links with an optional selected Set", () => {
    expect(assetsPath()).toBe("/");
    expect(assetPath("issuer:asset/a")).toBe("/assets/issuer%3Aasset%2Fa");
    expect(swapPath()).toBe("/swap");
    expect(swapPath("bstock-ai")).toBe("/swap?set=bstock-ai");
  });

  it("builds and parses routed swap market deep links", () => {
    const market = { address: "0xAbC0000000000000000000000000000000000001", chainId: 8453 };
    expect(routedSwapPath()).toBe("/swap/routed");
    const path = routedSwapPath(market);
    expect(path).toBe(`/swap/routed?chain=8453&token=${encodeURIComponent(market.address)}`);
    expect(readRoutedSwapMarketParam(new URLSearchParams(path.split("?")[1]))).toEqual({
      address: market.address,
      chainId: 8453,
    });
  });

  it("rejects malformed routed swap market parameters instead of guessing", () => {
    expect(readRoutedSwapMarketParam(new URLSearchParams())).toBeNull();
    expect(readRoutedSwapMarketParam(new URLSearchParams("chain=abc&token=0xabc"))).toBeNull();
    expect(readRoutedSwapMarketParam(new URLSearchParams("chain=0&token=0xabc"))).toBeNull();
    expect(readRoutedSwapMarketParam(new URLSearchParams("chain=8453&token=not-a-address"))).toBeNull();
    expect(readRoutedSwapMarketParam(new URLSearchParams("chain=8453"))).toBeNull();
  });

  it("redirects legacy routes to the configured Set tabs", () => {
    const legacyId = runtimeConfig.defaultPoolId;
    expect(resolveLegacyRoute("overview")).toEqual({
      kind: "set-tab",
      path: setPath(legacyId, "overview"),
      setId: legacyId,
      tab: "overview",
    });
    expect(resolveLegacyRoute("deposit").path).toBe(setPath(legacyId, "deposit"));
    expect(resolveLegacyRoute("withdraw").path).toBe(setPath(legacyId, "withdraw"));
  });

  it("falls back to the Sets directory when no legacy Set is configured", async () => {
    vi.resetModules();
    vi.doMock("../config/env", () => ({
      runtimeConfig: {
        defaultPoolId: "   ",
      },
    }));
    const { resolveLegacyRoute: resolveWithoutLegacy, setsPath: setsPathFresh } = await import("./routes");
    expect(resolveWithoutLegacy("overview")).toEqual({
      kind: "sets-directory",
      path: `${setsPathFresh()}?notice=legacy-redirect`,
      reason: "missing-legacy-set",
    });
    expect(setsPath()).toBe("/sets");
    vi.doUnmock("../config/env");
    vi.resetModules();
  });
});
