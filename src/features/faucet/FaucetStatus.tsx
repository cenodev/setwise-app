import type { FaucetAvailability } from "./model";

export type FaucetTransactionStage =
  | "idle"
  | "wallet-requested"
  | "submitted"
  | "confirming"
  | "success"
  | "rejected"
  | "reverted";

const reasonMessages = {
  disconnected: "Connect a wallet before claiming.",
  "wrong-network": "Switch to BSC Testnet before claiming.",
  offline: "You are offline. Reconnect before claiming.",
  paused: "Claims are temporarily paused by the faucet operator.",
  cooldown: "This wallet is still in its on-chain cooldown period.",
  "insufficient-inventory": "The faucet does not have enough of every asset for a complete basket.",
} as const;

export function FaucetAvailabilityNotice({ availability }: { availability: FaucetAvailability }) {
  if (!availability.reason) return <div className="success-panel" role="status">This wallet can claim the complete basket.</div>;
  return <div className="warning-panel" role="alert">{reasonMessages[availability.reason]}</div>;
}

export function FaucetTransactionStatus({ stage, error }: { stage: FaucetTransactionStage; error?: string }) {
  if (stage === "idle") return null;
  if (stage === "success") {
    return <div className="success-panel" role="status">Claim confirmed. Faucet inventory and wallet balances were refreshed.</div>;
  }
  if (stage === "rejected") {
    return <div className="error-panel" role="alert">Wallet request rejected{error ? `: ${error}` : "."}</div>;
  }
  if (stage === "reverted") {
    return <div className="error-panel" role="alert">Claim reverted{error ? `: ${error}` : "."}</div>;
  }
  const message = stage === "wallet-requested"
    ? "Confirm the claim transaction in your wallet."
    : stage === "submitted"
      ? "Claim submitted to BSC Testnet."
      : "Waiting for on-chain confirmation…";
  return <div className="notice" role="status">{message}</div>;
}
