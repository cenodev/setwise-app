import type { Hash } from "viem";

import type { FaucetTransactionStage } from "./FaucetStatus";

export async function executeFaucetClaim<T>(input: {
  write: () => Promise<Hash>;
  waitForReceipt: (hash: Hash) => Promise<{ status: "success" | "reverted" }>;
  invalidate: () => Promise<void>;
  refresh: () => Promise<T>;
  onStage: (stage: FaucetTransactionStage, hash?: Hash) => void;
}): Promise<T> {
  input.onStage("wallet-requested");
  const hash = await input.write();
  input.onStage("submitted", hash);
  await new Promise((resolve) => setTimeout(resolve, 0));
  input.onStage("confirming", hash);
  const receipt = await input.waitForReceipt(hash);
  if (receipt.status !== "success") throw new Error("The transaction receipt reported a revert");
  await input.invalidate();
  const refreshed = await input.refresh();
  input.onStage("success", hash);
  return refreshed;
}
