import type { Address } from "viem";

import deployment from "./generated/bsc-testnet.json";

export type FaucetTokenMetadata = {
  address: Address;
  decimals: number;
  name: string;
  symbol: string;
};

export const bscTestnetDeployment = deployment as {
  chainId: number;
  faucet: { address: Address; cooldownSeconds: string };
  tokens: FaucetTokenMetadata[];
  wrappedNative: FaucetTokenMetadata;
  testBnbFaucetUrl: string;
};
