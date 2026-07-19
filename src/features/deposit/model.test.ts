import type { Address } from "viem";

import { allowedLockSelection, orderAssetsByContract, planApprovals } from "./model";

const first = "0x0000000000000000000000000000000000000001" as Address;
const second = "0x0000000000000000000000000000000000000002" as Address;

describe("deposit model", () => {
  it("uses the contract order rather than API array order", () => {
    const assets = [{ id: "B", address: second }, { id: "A", address: first }];
    expect(orderAssetsByContract(assets, [first, second]).map((asset) => asset.id)).toEqual(["A", "B"]);
    expect(() => orderAssetsByContract(assets, [first])).toThrow(/does not match/);
  });

  it("allows only unlocked deposits while an existing lock is present", () => {
    expect(allowedLockSelection([90, 0, 30], 1n)).toEqual({
      choices: [0, 30, 90],
      allowed: [0],
      selected: 0,
    });
  });

  it("plans only exact deficient nonzero approvals in input order", () => {
    const planned = planApprovals([
      { assetId: "A", token: first, amount: 10n, allowance: 9n },
      { assetId: "B", token: second, amount: 0n, allowance: 0n },
      { assetId: "C", token: second, amount: 4n, allowance: 4n },
    ]);
    expect(planned.map((item) => item.assetId)).toEqual(["A"]);
  });
});
