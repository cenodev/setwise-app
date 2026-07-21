import { encodeFunctionData, isAddressEqual, type Address, type Hash, type Hex } from "viem";

import { erc20Abi } from "../../data/chain/abis";

export type AtomicCapabilityStatus = "supported" | "ready" | "unsupported";

export function atomicCapabilityStatus(capabilities: unknown): AtomicCapabilityStatus {
  if (!capabilities || typeof capabilities !== "object") return "unsupported";
  const atomic = (capabilities as { atomic?: unknown }).atomic;
  const status = typeof atomic === "string"
    ? atomic
    : atomic && typeof atomic === "object"
      ? (atomic as { status?: unknown }).status
      : undefined;
  return status === "supported" || status === "ready" ? status : "unsupported";
}

export function supportsAtomicBatch(capabilities: unknown): boolean {
  return atomicCapabilityStatus(capabilities) !== "unsupported";
}

export function atomicConnectionKey(
  address: Address | undefined,
  connector: { id?: string; uid?: string } | undefined,
): string {
  return address ? `${address.toLowerCase()}:${connector?.uid ?? connector?.id ?? "wallet"}` : "";
}

export type AtomicCall = { data: Hex; to: Address; value: bigint };

export type AtomicApproval = {
  amount: bigint;
  assetId: string;
  token: Address;
};

export type AtomicApprovalRequirement = {
  minimumAtomicAmount: string;
  spender: Address;
  token: Address;
};

export function buildAtomicApprovalCalls(input: {
  approvals: readonly AtomicApproval[];
  mustSubmitBy: string;
  now?: number;
  spender: Address;
  requirements: readonly AtomicApprovalRequirement[];
  transaction: { data: Hex; to: Address; value: string };
}): AtomicCall[] {
  const { approvals, mustSubmitBy, requirements, spender, transaction } = input;
  if (approvals.length === 0) throw new Error("Atomic approval batching requires at least one approval");
  if (Date.parse(mustSubmitBy) <= (input.now ?? Date.now())) {
    throw new Error("Firm quote expired before atomic wallet submission");
  }
  if (!isAddressEqual(transaction.to, spender)) throw new Error("Atomic execution targets an unexpected spender");
  if (BigInt(transaction.value) !== 0n) throw new Error("Atomic token execution unexpectedly requests native value");

  const calls = approvals.map((approval): AtomicCall => {
    const matching = requirements.filter((requirement) => isAddressEqual(requirement.token, approval.token));
    if (matching.length !== 1) throw new Error(`Firm quote has invalid approval requirements for ${approval.assetId}`);
    const [requirement] = matching;
    if (!requirement || !isAddressEqual(requirement.spender, spender)) {
      throw new Error(`Firm quote has an unexpected spender for ${approval.assetId}`);
    }
    if (BigInt(requirement.minimumAtomicAmount) !== approval.amount) {
      throw new Error(`Firm quote changed the exact approval amount for ${approval.assetId}`);
    }
    return {
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, approval.amount],
      }),
      to: approval.token,
      value: 0n,
    };
  });

  calls.push({ data: transaction.data, to: transaction.to, value: 0n });
  return calls;
}

export type AtomicSendErrorKind = "setup-rejected" | "unsupported" | "wallet-rejected" | "other";

function errorDetails(error: unknown): { codes: number[]; text: string } {
  const codes: number[] = [];
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 8 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (typeof current === "object") {
      const candidate = current as { cause?: unknown; code?: unknown; details?: unknown; message?: unknown; name?: unknown };
      if (typeof candidate.code === "number") codes.push(candidate.code);
      for (const value of [candidate.name, candidate.message, candidate.details]) {
        if (typeof value === "string") messages.push(value);
      }
      current = candidate.cause;
    } else {
      if (typeof current === "string") messages.push(current);
      break;
    }
  }
  return { codes, text: messages.join(" ").toLowerCase() };
}

export function classifyAtomicSendError(error: unknown): AtomicSendErrorKind {
  const { codes, text } = errorDetails(error);
  if (codes.includes(5750) || text.includes("atomic-ready wallet rejected upgrade")) return "setup-rejected";
  if (codes.includes(5760)
    || text.includes("atomicity not supported")
    || text.includes("atomic execution") && text.includes("not support")
    || text.includes("method not found")
    || text.includes("wallet_sendcalls") && text.includes("not support")) return "unsupported";
  if (codes.includes(4001)
    || text.includes("user rejected")
    || text.includes("user denied")
    || text.includes("rejected the request")) return "wallet-rejected";
  return "other";
}

type CallsStatus = {
  atomic?: boolean;
  chainId?: number;
  receipts?: readonly { status?: string; transactionHash?: Hash }[];
  status?: string;
};

export type AtomicBatchResult =
  | { kind: "pending" }
  | { kind: "query-error" }
  | { hash?: Hash; kind: "non-atomic" | "failure" | "invalid-receipt" }
  | { hash: Hash; kind: "success" };

export function atomicBatchResult(input: {
  error: unknown;
  expectedChainId: number;
  status: CallsStatus | undefined;
}): AtomicBatchResult {
  if (input.error) return { kind: "query-error" };
  if (!input.status) return { kind: "pending" };
  const receipt = input.status.receipts?.at(-1);
  const hash = receipt?.transactionHash;
  if (!input.status.atomic) return { hash, kind: "non-atomic" };
  if (input.status.status === "failure") return { hash, kind: "failure" };
  if (input.status.status !== "success") return { kind: "pending" };
  if (input.status.chainId !== input.expectedChainId || receipt?.status !== "success" || !hash) {
    return { hash, kind: "invalid-receipt" };
  }
  return { hash, kind: "success" };
}
