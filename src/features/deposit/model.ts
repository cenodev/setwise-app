import { type Address, type Hex } from "viem";

import { buildAtomicApprovalCalls, type AtomicCall } from "../wallet/atomicBatch";

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
}): AtomicCall[] {
  const { approvals, mustSubmitBy, poolAddress, requirements, transaction } = input;
  if (transaction.method !== "depositPortfolio") {
    throw new Error("Atomic approval batching is only available for portfolio deposits");
  }
  return buildAtomicApprovalCalls({
    approvals,
    mustSubmitBy,
    now: input.now,
    requirements,
    spender: poolAddress,
    transaction,
  });
}
