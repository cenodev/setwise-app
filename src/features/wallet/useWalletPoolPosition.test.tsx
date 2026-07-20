import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import type { Address } from "viem";

import type { Pool, PoolState } from "../../data/rfq/deposits";
import { useWalletPoolPosition } from "./useWalletPoolPosition";

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  publicClient: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: mocks.account,
  usePublicClient: mocks.publicClient,
}));

const account = "0x0000000000000000000000000000000000000001" as Address;
const poolAddress = "0x0000000000000000000000000000000000000010" as Address;
const lpToken = "0x0000000000000000000000000000000000000011" as Address;
const asset = "0x0000000000000000000000000000000000000020" as Address;
const pool = {
  id: "pool",
  chain: { id: 97, name: "BSC Testnet" },
  contract: { address: poolAddress },
  lpToken: { address: lpToken, decimals: 18, symbol: "SETWISE" },
  quotePolicy: { allowedLockDays: [0] },
  assets: [{ address: asset, decimals: 18, id: "ASSET", index: 0, symbol: "ASSET", weight: 1 }],
} as Pool;
const poolState = {
  blockNumber: "123",
  chainId: 97,
  poolAddress,
  poolId: pool.id,
} as PoolState;

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useWalletPoolPosition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns disconnected without issuing RPC reads", () => {
    const publicClient = { getBalance: vi.fn(), multicall: vi.fn() };
    mocks.account.mockReturnValue({ address: undefined, chainId: undefined, isConnected: false });
    mocks.publicClient.mockReturnValue(publicClient);

    const { result } = renderHook(() => useWalletPoolPosition(pool, poolState), { wrapper });

    expect(result.current.state).toEqual({ status: "disconnected" });
    expect(publicClient.multicall).not.toHaveBeenCalled();
    expect(publicClient.getBalance).not.toHaveBeenCalled();
  });

  it("exposes the reader result without adding presentation state", async () => {
    const publicClient = {
      chain: { id: 97 },
      getBalance: vi.fn().mockResolvedValue(2n),
      multicall: vi.fn().mockResolvedValue([3n, 4n, [0n, 0n], false]),
    };
    mocks.account.mockReturnValue({ account, address: account, chainId: 97, isConnected: true });
    mocks.publicClient.mockReturnValue(publicClient);

    const { result } = renderHook(() => useWalletPoolPosition(pool, poolState), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    expect(result.current.state).toMatchObject({
      position: {
        account,
        assetBalances: [{ assetId: "ASSET", balance: 3n }],
        nativeBalance: 2n,
        shares: { unlocked: 4n, locked: 0n, totalAttributed: 4n },
      },
      status: "ready",
    });
  });
});
