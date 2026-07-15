import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createConfig, http, type Config } from "wagmi";
import { injected } from "wagmi/connectors";

import { requiredChain, requiredChainId, supportedNetworks } from "./chains";
import { runtimeConfig } from "./env";

const metadata = {
  name: "Setwise",
  description: "Setwise testnet trading and portfolio prototype",
  url: runtimeConfig.appUrl,
  icons: [`${runtimeConfig.appUrl}/setwise-mark.svg`],
};

function createFallbackConfig(): Config {
  return createConfig({
    chains: [requiredChain],
    connectors: [injected()],
    transports: {
      [requiredChainId]: http(runtimeConfig.bscTestnetRpcUrl),
    },
  });
}

function createWalletConfig(): Config {
  if (!runtimeConfig.reownProjectId) {
    return createFallbackConfig();
  }

  const wagmiAdapter = new WagmiAdapter({
    networks: [...supportedNetworks],
    projectId: runtimeConfig.reownProjectId,
    ssr: false,
  });

  createAppKit({
    adapters: [wagmiAdapter],
    networks: [...supportedNetworks],
    defaultNetwork: requiredChain,
    projectId: runtimeConfig.reownProjectId,
    metadata,
    allWallets: "SHOW",
    allowUnsupportedChain: false,
    defaultAccountTypes: { eip155: "eoa" },
    enableWalletGuide: false,
    features: {
      analytics: false,
      email: false,
      socials: false,
      swaps: false,
      onramp: false,
    },
  });

  return wagmiAdapter.wagmiConfig;
}

export const wagmiConfig = createWalletConfig();
