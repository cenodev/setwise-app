export type FaucetBlockReason =
  | "disconnected"
  | "wrong-network"
  | "offline"
  | "paused"
  | "cooldown"
  | "insufficient-inventory"
  | null;

export type FaucetAvailability = {
  canClaim: boolean;
  reason: FaucetBlockReason;
};

export function faucetAvailability(input: {
  connected: boolean;
  correctChain: boolean;
  online: boolean;
  paused: boolean;
  nextEligibleAt: bigint;
  nowSeconds: bigint;
  hasSufficientInventory: boolean;
}): FaucetAvailability {
  if (!input.connected) return { canClaim: false, reason: "disconnected" };
  if (!input.correctChain) return { canClaim: false, reason: "wrong-network" };
  if (!input.online) return { canClaim: false, reason: "offline" };
  if (input.paused) return { canClaim: false, reason: "paused" };
  if (input.nextEligibleAt > input.nowSeconds) return { canClaim: false, reason: "cooldown" };
  if (!input.hasSufficientInventory) return { canClaim: false, reason: "insufficient-inventory" };
  return { canClaim: true, reason: null };
}

export function relativeTime(timestampSeconds: bigint, nowMs: number): string {
  const seconds = Math.max(0, Number(timestampSeconds) - Math.floor(nowMs / 1_000));
  if (seconds === 0) return "now";
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  if (minutes > 0) return `in ${minutes}m ${remainder}s`;
  return `in ${remainder}s`;
}
