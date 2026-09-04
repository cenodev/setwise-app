import { describe, expect, it } from "vitest";
import type { Hash } from "viem";

import { explorerAddressUrl, explorerTxUrl } from "./explorers";

const hash = `0x${"ab".repeat(32)}` as Hash;
const address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;

describe("explorer links", () => {
  it("builds transaction links for every routed chain", () => {
    expect(explorerTxUrl(1, hash)).toBe(`https://etherscan.io/tx/${hash}`);
    expect(explorerTxUrl(56, hash)).toBe(`https://bscscan.com/tx/${hash}`);
    expect(explorerTxUrl(8453, hash)).toBe(`https://basescan.org/tx/${hash}`);
    expect(explorerTxUrl(4663, hash)).toBe(`https://robinhoodchain.blockscout.com/tx/${hash}`);
  });

  it("builds address links", () => {
    expect(explorerAddressUrl(8453, address)).toBe(`https://basescan.org/address/${address}`);
  });

  it("follows the deployment explorer override for BSC Testnet", () => {
    expect(explorerTxUrl(97, hash)).toMatch(/^https:\/\/.+\/tx\//);
  });

  it("returns undefined for unknown chains instead of guessing a URL", () => {
    expect(explorerTxUrl(1337, hash)).toBeUndefined();
    expect(explorerAddressUrl(1337, address)).toBeUndefined();
  });
});
