import { resolveRuntimeConfig } from "./env";

describe("resolveRuntimeConfig", () => {
  it("uses safe local defaults without inventing a wallet project ID", () => {
    const config = resolveRuntimeConfig({}, "http://localhost:4173");

    expect(config.appUrl).toBe("http://localhost:4173");
    expect(config.walletConfigured).toBe(false);
    expect(config.reownProjectId).toBeNull();
    expect(config.rfqApiUrl).toBe("http://localhost:8787");
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
});
