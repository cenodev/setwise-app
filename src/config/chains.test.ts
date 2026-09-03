import {
  getRoutedSwapNetwork,
  getWalletNetwork,
  isRoutedSwapChainId,
  isSetwiseExecutionChainId,
  routedSwapNetworks,
  setwiseTestnetChainId,
} from "./chains";

describe("network registry", () => {
  it("represents every initial routed network with the same chain shape", () => {
    expect(routedSwapNetworks.map(({ id }) => id)).toEqual([1, 56, 8453, 4663]);
    for (const chainId of [1, 56, 8453, 4663]) {
      expect(isRoutedSwapChainId(chainId)).toBe(true);
      expect(getRoutedSwapNetwork(chainId)?.id).toBe(chainId);
      expect(getWalletNetwork(chainId)?.id).toBe(chainId);
    }
  });

  it("keeps the executable Setwise deployment separate from routed mainnets", () => {
    expect(setwiseTestnetChainId).toBe(97);
    expect(isRoutedSwapChainId(setwiseTestnetChainId)).toBe(false);
    expect(getRoutedSwapNetwork(setwiseTestnetChainId)).toBeUndefined();
    expect(getWalletNetwork(setwiseTestnetChainId)?.testnet).toBe(true);
    expect(isSetwiseExecutionChainId(setwiseTestnetChainId)).toBe(true);
    for (const chainId of [1, 56, 8453, 4663]) {
      expect(isSetwiseExecutionChainId(chainId)).toBe(false);
    }
  });
});
