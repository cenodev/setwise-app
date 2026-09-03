import { isAddress, type Address } from "viem";

export type TokenDeploymentIdentity = Readonly<{
  address: Address;
  chainId: number;
}>;

export type TokenDeployment = TokenDeploymentIdentity & Readonly<{
  decimals: number;
  symbol: string;
}>;

export class TokenDeploymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenDeploymentError";
  }
}

/** Symbols are display metadata; only chain ID plus address form token identity. */
export function tokenDeploymentKey(identity: TokenDeploymentIdentity): string {
  return `${identity.chainId}:${identity.address.toLowerCase()}`;
}

export function createTokenDeploymentIndex<T extends TokenDeploymentIdentity>(
  deployments: readonly T[],
): ReadonlyMap<string, T> {
  const index = new Map<string, T>();
  for (const deployment of deployments) {
    if (!Number.isInteger(deployment.chainId) || deployment.chainId <= 0 || !isAddress(deployment.address)) {
      throw new TokenDeploymentError("Token deployment has an invalid chain ID or contract address");
    }
    const key = tokenDeploymentKey(deployment);
    if (index.has(key)) {
      throw new TokenDeploymentError(`Duplicate token deployment ${key}`);
    }
    index.set(key, deployment);
  }
  return index;
}

export function findTokenDeployment<T extends TokenDeploymentIdentity>(
  index: ReadonlyMap<string, T>,
  identity: TokenDeploymentIdentity,
): T | undefined {
  return index.get(tokenDeploymentKey(identity));
}
