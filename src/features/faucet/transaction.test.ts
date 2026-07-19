import { executeFaucetClaim } from "./transaction";

describe("faucet claim transaction", () => {
  it("invalidates faucet data and refreshes every claimed wallet balance after a successful receipt", async () => {
    const hash: `0x${string}` = `0x${"ab".repeat(32)}`;
    const stages: string[] = [];
    const refreshedBalances = {
      mUSDT: 1_000_000_000_000_000_000_000n,
      mbSPCX: 10_000_000_000_000_000_000n,
      mbSNDK: 10_000_000_000_000_000_000n,
      mbPLTR: 10_000_000_000_000_000_000n,
      mbQCOM: 10_000_000_000_000_000_000n,
      mbDRAM: 10_000_000_000_000_000_000n,
      mbGOOGL: 10_000_000_000_000_000_000n,
      mbMU: 10_000_000_000_000_000_000n,
      mbNVDA: 10_000_000_000_000_000_000n,
    };
    const invalidate = vi.fn(() => Promise.resolve());
    const refresh = vi.fn(() => Promise.resolve(refreshedBalances));
    const successReceipt = { status: "success" } as const;

    const result = await executeFaucetClaim({
      write: vi.fn(() => Promise.resolve(hash)),
      waitForReceipt: vi.fn(() => Promise.resolve(successReceipt)),
      invalidate,
      refresh,
      onStage: (stage) => stages.push(stage),
    });

    expect(invalidate).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(Object.keys(result)).toHaveLength(9);
    expect(result).toEqual(refreshedBalances);
    expect(stages).toEqual(["wallet-requested", "submitted", "confirming", "success"]);
  });
});
