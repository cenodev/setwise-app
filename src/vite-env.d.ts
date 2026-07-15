/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_APP_URL?: string;
  readonly VITE_BSC_TESTNET_RPC_URL?: string;
  readonly VITE_REOWN_PROJECT_ID?: string;
  readonly VITE_RFQ_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
