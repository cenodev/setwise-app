export type PublicRuntimeConfig = {
  appUrl: string;
  bscTestnetRpcUrl: string;
  explorerUrl: string;
  nativeGasReserveBnb: string;
  poolId: string;
  reownProjectId: string | null;
  rfqApiUrl: string;
  tokenListUrl: string;
  walletConfigured: boolean;
};

type PublicEnv = Partial<Record<
  | "VITE_APP_URL"
  | "VITE_BSC_TESTNET_RPC_URL"
  | "VITE_BSC_TESTNET_EXPLORER_URL"
  | "VITE_NATIVE_GAS_RESERVE_BNB"
  | "VITE_POOL_ID"
  | "VITE_REOWN_PROJECT_ID"
  | "VITE_RFQ_API_URL"
  | "VITE_TOKEN_LIST_URL",
  string
>>;

const DEFAULT_BSC_TESTNET_RPC_URL = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

function normalizeUrl(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  return new URL(candidate).toString().replace(/\/$/, "");
}

function normalizeNativeGasReserve(value: string | undefined): string {
  const candidate = value?.trim() || "0.001";
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(candidate)) {
    throw new Error("VITE_NATIVE_GAS_RESERVE_BNB must be a non-negative decimal with at most 18 decimal places");
  }
  return candidate;
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
    nativeGasReserveBnb: normalizeNativeGasReserve(env.VITE_NATIVE_GAS_RESERVE_BNB),
    poolId: env.VITE_POOL_ID?.trim() || "bstock-ai-no-bnb-bsc-testnet",
    reownProjectId,
    rfqApiUrl: normalizeUrl(
      env.VITE_RFQ_API_URL,
      "https://setwise-rfq-api.datadex.workers.dev",
    ),
    tokenListUrl: normalizeUrl(
      env.VITE_TOKEN_LIST_URL,
      "https://raw.githubusercontent.com/cenodev/setwise-token-list/main/data/token-list.json",
    ),
    walletConfigured: reownProjectId !== null,
  };
}

const browserOrigin = typeof window === "undefined" ? undefined : window.location.origin;

export const runtimeConfig = resolveRuntimeConfig(import.meta.env, browserOrigin);
