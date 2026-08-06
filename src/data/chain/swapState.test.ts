import type { Address, PublicClient } from "viem";

import { readSwapChainState } from "./swapState";

const account = "0x0000000000000000000000000000000000000001" as Address;
const routerAddress = "0x0000000000000000000000000000000000000002" as Address;
const poolAddress = "0x0000000000000000000000000000000000000003" as Address;
const tokenA = "0x0000000000000000000000000000000000000010" as Address;
const tokenB = "0x0000000000000000000000000000000000000020" as Address;

describe("swap chain state", () => {
  it("reads every allowance from the wallet to the Set Router and preserves a consumed zero", async () => {
    const readContract = vi.fn((request: { address: Address; args: readonly Address[]; functionName: string }) => {
      if (request.functionName === "balanceOf") return Promise.resolve(request.address === tokenA ? 100n : 200n);
      return Promise.resolve(request.address === tokenA ? 0n : 25n);
    });
    const client = {
      getBalance: vi.fn().mockResolvedValue(5n),
      readContract,
    } as unknown as Pick<PublicClient, "getBalance" | "readContract">;

    const state = await readSwapChainState({
      account,
      assets: [{ address: tokenA, id: "A" }, { address: tokenB, id: "B" }],
      client,
      routerAddress,
    });

    expect(state).toEqual({
      assets: {
        A: { allowance: 0n, balance: 100n },
        B: { allowance: 25n, balance: 200n },
      },
      nativeBalance: 5n,
    });
    const allowanceReads = readContract.mock.calls
      .map(([request]) => request)
      .filter((request) => request.functionName === "allowance");
    expect(allowanceReads).toHaveLength(2);
    expect(allowanceReads.every((request) => request.args[0] === account && request.args[1] === routerAddress)).toBe(true);
    expect(allowanceReads.every((request) => !request.args.includes(poolAddress))).toBe(true);
  });
});
