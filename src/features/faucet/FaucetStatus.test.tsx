import { render, screen } from "@testing-library/react";

import { FaucetAvailabilityNotice, FaucetTransactionStatus } from "./FaucetStatus";
import { faucetAvailability } from "./model";

const availableInput = {
  connected: true,
  correctChain: true,
  online: true,
  paused: false,
  nextEligibleAt: 0n,
  nowSeconds: 100n,
  hasSufficientInventory: true,
};

describe("faucet states", () => {
  it.each([
    ["available", {}, "can claim the complete basket"],
    ["cooldown", { nextEligibleAt: 101n }, "cooldown period"],
    ["paused", { paused: true }, "temporarily paused"],
    ["insufficient inventory", { hasSufficientInventory: false }, "does not have enough"],
    ["disconnected", { connected: false }, "Connect a wallet"],
    ["wrong network", { correctChain: false }, "Switch to BSC Testnet"],
    ["offline", { online: false }, "offline"],
  ])("renders the %s availability state", (_, override, expected) => {
    render(<FaucetAvailabilityNotice availability={faucetAvailability({ ...availableInput, ...override })} />);
    expect(screen.getByText(new RegExp(expected, "i"))).toBeInTheDocument();
  });

  it.each([
    ["rejected" as const, "Wallet request rejected"],
    ["reverted" as const, "Claim reverted"],
    ["success" as const, "Claim confirmed"],
  ])("renders the %s transaction state", (stage, expected) => {
    render(<FaucetTransactionStatus stage={stage} />);
    expect(screen.getByText(new RegExp(expected))).toBeInTheDocument();
  });
});
