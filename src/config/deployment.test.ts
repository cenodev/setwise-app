import { isAddress } from "viem";

import { bscTestnetDeployment } from "./deployment";

describe("bscTestnetDeployment", () => {
  it("pins the verified Set Router trust anchor for chain 97", () => {
    expect(bscTestnetDeployment.chainId).toBe(97);
    expect(bscTestnetDeployment.router.address).toBe("0x00355Ed1Fc7cD618AEC5A8E8fD31686376499ccB");
    expect(isAddress(bscTestnetDeployment.router.address)).toBe(true);
  });
});
