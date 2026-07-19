export type PublicRuntimeConfig = {
  appUrl: string;
  bscTestnetRpcUrl: string;
  explorerUrl: string;
  poolId: string;
  reownProjectId: string | null;
  rfqApiUrl: string;
  walletConfigured: boolean;
};

type PublicEnv = Partial<Record<
  | "VITE_APP_URL"
  | "VITE_BSC_TESTNET_RPC_URL"
  | "VITE_BSC_TESTNET_EXPLORER_URL"
  | "VITE_POOL_ID"
  | "VITE_REOWN_PROJECT_ID"
  | "VITE_RFQ_API_URL",
  string
>>;

const DEFAULT_BSC_TESTNET_RPC_URL = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

function normalizeUrl(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  return new URL(candidate).toString().replace(/\/$/, "");
}

export function resolveRuntimeConfig(
  env: PublicEnv,
  browserOrigin = "http://localhost:5173",
): PublicRuntimeConfig {
  const reownProjectId = env.VITE_REOWN_PROJECT_ID?.trim() || null;

  return {
    appUrl: normalizeUrl(env.VITE_APP_URL, browserOrigin),
    bscTestnetRpcUrl: normalizeUrl(
      env.VITE_BSC_TESTNET_RPC_URL,
      DEFAULT_BSC_TESTNET_RPC_URL,
    ),
    explorerUrl: normalizeUrl(
      env.VITE_BSC_TESTNET_EXPLORER_URL,
      "https://testnet.bscscan.com",
    ),
    poolId: env.VITE_POOL_ID?.trim() || "bstock-ai-bsc-testnet",
    reownProjectId,
    rfqApiUrl: normalizeUrl(
      env.VITE_RFQ_API_URL,
      "https://setwise-rfq-api.datadex.workers.dev",
    ),
    walletConfigured: reownProjectId !== null,
  };
}

const browserOrigin = typeof window === "undefined" ? undefined : window.location.origin;

export const runtimeConfig = resolveRuntimeConfig(import.meta.env, browserOrigin);
