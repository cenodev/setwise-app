import { decodeFunctionData, type Address } from "viem";

import { erc20Abi } from "../../data/chain/abis";
import {
  allowedLockSelection,
  atomicCapabilityStatus,
  buildAtomicDepositCalls,
  classifyAtomicSendError,
  orderAssetsByContract,
  planApprovals,
  supportsAtomicBatch,
} from "./model";

const first = "0x0000000000000000000000000000000000000001" as Address;
const second = "0x0000000000000000000000000000000000000002" as Address;
const pool = "0x0000000000000000000000000000000000000010" as Address;

function addressAt(index: number): Address {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

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

  it.each(["supported", "ready"] as const)("enables atomic batches for an atomic: %s capability", (status) => {
    expect(atomicCapabilityStatus({ atomic: { status } })).toBe(status);
    expect(supportsAtomicBatch({ atomic: status })).toBe(true);
  });

  it("treats missing and unsupported atomic capabilities as unavailable", () => {
    expect(supportsAtomicBatch(undefined)).toBe(false);
    expect(supportsAtomicBatch({})).toBe(false);
    expect(supportsAtomicBatch({ atomic: { status: "unsupported" } })).toBe(false);
  });

  it.each([1, 2, 9])("builds %i exact approvals in order with the deposit last", (count) => {
    const approvals = Array.from({ length: count }, (_, index) => ({
      allowance: 0n,
      amount: BigInt(index + 1),
      assetId: `asset-${index}`,
      token: addressAt(index + 1),
    }));
    const calls = buildAtomicDepositCalls({
      approvals,
      mustSubmitBy: "2030-01-01T00:00:00.000Z",
      now: 0,
      poolAddress: pool,
      requirements: approvals.map((approval) => ({
        minimumAtomicAmount: approval.amount.toString(),
        spender: pool,
        token: approval.token,
      })),
      transaction: { data: "0x1234", method: "depositPortfolio", to: pool, value: "0" },
    });

    expect(calls).toHaveLength(count + 1);
    expect(calls.slice(0, -1).map((call) => call.to)).toEqual(approvals.map((approval) => approval.token));
    calls.slice(0, -1).forEach((call, index) => {
      expect(call.value).toBe(0n);
      expect(decodeFunctionData({ abi: erc20Abi, data: call.data })).toEqual({
        functionName: "approve",
        args: [pool, approvals[index]?.amount],
      });
    });
    expect(calls.at(-1)).toEqual({ data: "0x1234", to: pool, value: 0n });
  });

  it("does not construct a batch without deficient approvals", () => {
    expect(() => buildAtomicDepositCalls({
      approvals: [],
      mustSubmitBy: "2030-01-01T00:00:00.000Z",
      now: 0,
      poolAddress: pool,
      requirements: [],
      transaction: { data: "0x", method: "depositPortfolio", to: pool, value: "0" },
    })).toThrow(/at least one approval/);
  });

  it("rejects an expired firm quote before constructing calls", () => {
    expect(() => buildAtomicDepositCalls({
      approvals: [{ allowance: 0n, amount: 1n, assetId: "A", token: first }],
      mustSubmitBy: "2026-01-01T00:00:00.000Z",
      now: Date.parse("2026-01-01T00:00:00.000Z"),
      poolAddress: pool,
      requirements: [{ minimumAtomicAmount: "1", spender: pool, token: first }],
      transaction: { data: "0x", method: "depositPortfolio", to: pool, value: "0" },
    })).toThrow(/expired/);
  });

  it("distinguishes atomic setup, support, and wallet rejection failures", () => {
    expect(classifyAtomicSendError({ code: 5750 })).toBe("setup-rejected");
    expect(classifyAtomicSendError({ cause: { code: 5760 } })).toBe("unsupported");
    expect(classifyAtomicSendError({ code: 4001 })).toBe("wallet-rejected");
    expect(classifyAtomicSendError(new Error("RPC unavailable"))).toBe("other");
  });
});
