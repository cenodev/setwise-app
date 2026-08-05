import type { Address, PublicClient } from "viem";

import { erc20Abi } from "./abis";

export type SwapChainAsset = { address: Address; id: string };
export type SwapAssetChainState = { allowance: bigint; balance: bigint };
export type SwapChainState = {
  assets: Record<string, SwapAssetChainState>;
  nativeBalance: bigint;
};

export async function readSwapChainState(input: {
  account: Address;
  assets: readonly SwapChainAsset[];
  client: Pick<PublicClient, "getBalance" | "readContract">;
  routerAddress: Address;
}): Promise<SwapChainState> {
  const { account, assets, client, routerAddress } = input;
  const [nativeBalance, tokenStates] = await Promise.all([
    client.getBalance({ address: account }),
    Promise.all(assets.map(async (asset) => {
      const [balance, allowance] = await Promise.all([
        client.readContract({
          address: asset.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
        }),
        client.readContract({
          address: asset.address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account, routerAddress],
        }),
      ]);
      return [asset.id, { allowance, balance }] as const;
    })),
  ]);

  return { assets: Object.fromEntries(tokenStates), nativeBalance };
}
