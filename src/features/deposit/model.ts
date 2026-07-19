import { encodeFunctionData, isAddressEqual, type Address, type Hex } from "viem";

import { erc20Abi } from "../../data/chain/abis";

export type OrderedAsset = {
  address: Address;
  id: string;
};

export function orderAssetsByContract<T extends OrderedAsset>(
  assets: readonly T[],
  contractOrder: readonly Address[],
): T[] {
  const byAddress = new Map(assets.map((asset) => [asset.address.toLowerCase(), asset]));
  const ordered = contractOrder.map((address) => byAddress.get(address.toLowerCase()));
  if (ordered.some((asset) => asset === undefined) || ordered.length !== assets.length) {
    throw new Error("Pool discovery does not match the contract asset order");
  }
  return ordered as T[];
}

export function allowedLockSelection(configured: readonly number[], lockedShares: bigint) {
  const choices = [...new Set(configured)].sort((a, b) => a - b);
  const allowed = lockedShares > 0n ? choices.filter((days) => days === 0) : choices;
  return {
    choices,
    allowed,
    selected: allowed.includes(0) ? 0 : (allowed[0] ?? 0),
  };
}

export type ApprovalInput = {
  amount: bigint;
  allowance: bigint;
  assetId: string;
  token: Address;
};

export function planApprovals(inputs: readonly ApprovalInput[]): ApprovalInput[] {
  return inputs.filter((input) => input.amount > 0n && input.allowance < input.amount);
}

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

export type AtomicDepositCall = {
  data: Hex;
  to: Address;
  value: bigint;
};

type ApprovalRequirement = {
  minimumAtomicAmount: string;
  spender: Address;
  token: Address;
};

type DepositTransaction = {
  data: Hex;
  method: "depositPortfolio" | "depositSingleAsset";
  to: Address;
  value: string;
};

export function buildAtomicDepositCalls(input: {
  approvals: readonly ApprovalInput[];
  mustSubmitBy: string;
  now?: number;
  poolAddress: Address;
  requirements: readonly ApprovalRequirement[];
  transaction: DepositTransaction;
}): AtomicDepositCall[] {
  const { approvals, mustSubmitBy, poolAddress, requirements, transaction } = input;
  if (approvals.length === 0) throw new Error("Atomic approval batching requires at least one approval");
  if (Date.parse(mustSubmitBy) <= (input.now ?? Date.now())) {
    throw new Error("Firm quote expired before atomic wallet submission");
  }
  if (transaction.method !== "depositPortfolio") {
    throw new Error("Atomic approval batching is only available for portfolio deposits");
  }
  if (!isAddressEqual(transaction.to, poolAddress)) throw new Error("Atomic deposit targets an unexpected pool");
  if (BigInt(transaction.value) !== 0n) throw new Error("Atomic deposit unexpectedly requests native value");

  const calls = approvals.map((approval): AtomicDepositCall => {
    const matching = requirements.filter((requirement) => isAddressEqual(requirement.token, approval.token));
    if (matching.length !== 1) throw new Error(`Firm quote has invalid approval requirements for ${approval.assetId}`);
    const [requirement] = matching;
    if (!requirement || !isAddressEqual(requirement.spender, poolAddress)) {
      throw new Error(`Firm quote has an unexpected spender for ${approval.assetId}`);
    }
    if (BigInt(requirement.minimumAtomicAmount) !== approval.amount) {
      throw new Error(`Firm quote changed the exact approval amount for ${approval.assetId}`);
    }
    return {
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [poolAddress, approval.amount],
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
