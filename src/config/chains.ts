import { bscTestnet } from "@reown/appkit/networks";

export const supportedNetworks = [bscTestnet] as const;
export const requiredChain = bscTestnet;
export const requiredChainId = bscTestnet.id;
