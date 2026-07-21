import { resolveRuntimeConfig } from "./env";

describe("resolveRuntimeConfig", () => {
  it("uses safe local defaults without inventing a wallet project ID", () => {
    const config = resolveRuntimeConfig({}, "http://localhost:4173");

    expect(config.appUrl).toBe("http://localhost:4173");
    expect(config.poolId).toBe("bstock-ai-no-bnb-bsc-testnet");
    expect(config.nativeGasReserveBnb).toBe("0.001");
    expect(config.walletConfigured).toBe(false);
    expect(config.reownProjectId).toBeNull();
    expect(config.rfqApiUrl).toBe("https://setwise-rfq-api.datadex.workers.dev");
    expect(config.tokenListUrl).toBe("https://raw.githubusercontent.com/cenodev/setwise-token-list/main/data/token-list.json");
  });

  it("recognizes a configured Reown project", () => {
    const config = resolveRuntimeConfig({
      VITE_APP_URL: "https://app.setwise.example/",
      VITE_REOWN_PROJECT_ID: "project-id",
      VITE_RFQ_API_URL: "https://rfq.setwise.example/",
    });

    expect(config.appUrl).toBe("https://app.setwise.example");
    expect(config.rfqApiUrl).toBe("https://rfq.setwise.example");
    expect(config.walletConfigured).toBe(true);
  });

  it("validates the native gas reserve without converting it through number", () => {
    expect(resolveRuntimeConfig({ VITE_NATIVE_GAS_RESERVE_BNB: "0.0025" }).nativeGasReserveBnb).toBe("0.0025");
    expect(() => resolveRuntimeConfig({ VITE_NATIVE_GAS_RESERVE_BNB: "1e-3" }))
      .toThrow(/VITE_NATIVE_GAS_RESERVE_BNB/);
  });
});
