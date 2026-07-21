import { decodeFunctionData, type Address } from "viem";

import { erc20Abi } from "../../data/chain/abis";
import {
  atomicBatchResult,
  atomicCapabilityStatus,
  atomicConnectionKey,
  buildAtomicApprovalCalls,
  classifyAtomicSendError,
  supportsAtomicBatch,
} from "./atomicBatch";

const token = "0x0000000000000000000000000000000000000001" as Address;
const pool = "0x0000000000000000000000000000000000000010" as Address;
const hash = `0x${"a".repeat(64)}` as const;

describe("atomic wallet batches", () => {
  it.each(["supported", "ready"] as const)("enables atomic batches for an atomic: %s capability", (status) => {
    expect(atomicCapabilityStatus({ atomic: { status } })).toBe(status);
    expect(supportsAtomicBatch({ atomic: status })).toBe(true);
  });

  it("treats missing and unsupported atomic capabilities as unavailable", () => {
    expect(supportsAtomicBatch(undefined)).toBe(false);
    expect(supportsAtomicBatch({})).toBe(false);
    expect(supportsAtomicBatch({ atomic: { status: "unsupported" } })).toBe(false);
  });

  it("scopes fallback decisions to the account and connector", () => {
    expect(atomicConnectionKey(token, { id: "wallet-a", uid: "connector-1" })).toBe(`${token}:connector-1`);
    expect(atomicConnectionKey(token, { id: "wallet-a" })).toBe(`${token}:wallet-a`);
    expect(atomicConnectionKey(undefined, undefined)).toBe("");
  });

  it("builds an exact approval before the executable call", () => {
    const calls = buildAtomicApprovalCalls({
      approvals: [{ amount: 10n, assetId: "TOKEN", token }],
      mustSubmitBy: "2030-01-01T00:00:00.000Z",
      now: 0,
      requirements: [{ minimumAtomicAmount: "10", spender: pool, token }],
      spender: pool,
      transaction: { data: "0x1234", to: pool, value: "0" },
    });

    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0].data })).toEqual({
      args: [pool, 10n],
      functionName: "approve",
    });
    expect(calls[1]).toEqual({ data: "0x1234", to: pool, value: 0n });
  });

  it("rejects approval, spender, value, and deadline mismatches", () => {
    const base = {
      approvals: [{ amount: 10n, assetId: "TOKEN", token }],
      mustSubmitBy: "2030-01-01T00:00:00.000Z",
      now: 0,
      requirements: [{ minimumAtomicAmount: "10", spender: pool, token }],
      spender: pool,
      transaction: { data: "0x1234" as const, to: pool, value: "0" },
    };
    expect(() => buildAtomicApprovalCalls({ ...base, requirements: [] })).toThrow(/requirements/);
    expect(() => buildAtomicApprovalCalls({ ...base, requirements: [{ ...base.requirements[0], minimumAtomicAmount: "11" }] })).toThrow(/amount/);
    expect(() => buildAtomicApprovalCalls({ ...base, transaction: { ...base.transaction, value: "1" } })).toThrow(/native value/);
    expect(() => buildAtomicApprovalCalls({ ...base, mustSubmitBy: "1970-01-01T00:00:00.000Z" })).toThrow(/expired/);
  });

  it("distinguishes atomic setup, support, and wallet rejection failures", () => {
    expect(classifyAtomicSendError({ code: 5750 })).toBe("setup-rejected");
    expect(classifyAtomicSendError({ cause: { code: 5760 } })).toBe("unsupported");
    expect(classifyAtomicSendError({ code: 4001 })).toBe("wallet-rejected");
    expect(classifyAtomicSendError(new Error("RPC unavailable"))).toBe("other");
  });

  it("normalizes atomic batch status without treating uncertainty as safe fallback", () => {
    expect(atomicBatchResult({ error: new Error("RPC"), expectedChainId: 97, status: undefined })).toEqual({ kind: "query-error" });
    expect(atomicBatchResult({ error: null, expectedChainId: 97, status: { atomic: true, status: "pending" } })).toEqual({ kind: "pending" });
    expect(atomicBatchResult({ error: null, expectedChainId: 97, status: { atomic: false, status: "success" } })).toEqual({ hash: undefined, kind: "non-atomic" });
    expect(atomicBatchResult({ error: null, expectedChainId: 97, status: { atomic: true, status: "failure" } })).toEqual({ hash: undefined, kind: "failure" });
    expect(atomicBatchResult({
      error: null,
      expectedChainId: 97,
      status: { atomic: true, chainId: 97, receipts: [{ status: "success", transactionHash: hash }], status: "success" },
    })).toEqual({ hash, kind: "success" });
  });
});
