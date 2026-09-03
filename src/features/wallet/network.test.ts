import { getWalletNetworkRequirement } from "./network";

describe("routed wallet network requirements", () => {
  it("requests the route source chain, not its destination chain", () => {
    const requirement = getWalletNetworkRequirement({
      connectedChainId: 1,
      destinationChainId: 4663,
      sourceChainId: 8453,
    });

    expect(requirement).toMatchObject({ kind: "switch", sourceNetwork: { id: 8453, name: "Base" } });
  });

  it("keeps connected, source, and destination networks independent", () => {
    expect(getWalletNetworkRequirement({
      connectedChainId: 4663,
      destinationChainId: 1,
      sourceChainId: 4663,
    })).toMatchObject({ kind: "ready", sourceNetwork: { id: 4663 } });

    expect(getWalletNetworkRequirement({
      connectedChainId: undefined,
      destinationChainId: 56,
      sourceChainId: 1,
    })).toMatchObject({ kind: "disconnected", sourceNetwork: { id: 1 } });
  });

  it("does not offer a switch for an unregistered source network", () => {
    expect(getWalletNetworkRequirement({
      connectedChainId: 1,
      destinationChainId: 4663,
      sourceChainId: 999,
    })).toEqual({ kind: "unsupported-source", sourceChainId: 999 });
  });
});

