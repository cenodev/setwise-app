import type { TokenMetadata } from "./tokens";

export type RwaAsset = {
  assetType: string | undefined;
  description: string;
  id: string;
  logoURI: string | undefined;
  name: string;
  provider: string;
  symbol: string;
  tokens: TokenMetadata[];
  underlyingSymbol: string | undefined;
};

export type UnderlyingStock = {
  assetType: string | undefined;
  id: string;
  logoURI: string | undefined;
  name: string;
  offerings: RwaAsset[];
  providers: string[];
  symbol: string;
  tokens: TokenMetadata[];
};

export function providerLabel(provider: string): string {
  return provider.split(/[-_]/).filter(Boolean).map((part) => (
    part.charAt(0).toUpperCase() + part.slice(1)
  )).join(" ");
}

export function groupUnderlyingStocks(tokens: readonly TokenMetadata[]): UnderlyingStock[] {
  const groups = new Map<string, TokenMetadata[]>();
  for (const token of tokens) {
    const symbol = (token.underlyingSymbol ?? token.symbol).trim();
    const id = symbol.toLowerCase();
    groups.set(id, [...(groups.get(id) ?? []), token]);
  }

  return [...groups.entries()].map(([id, deployments]) => {
    const preferred = deployments.find((token) => token.logoURI) ?? deployments[0];
    const offerings = groupRwaAssets(deployments);
    const ordered = [...deployments].sort((a, b) => (
      (a.provider ?? "unknown").localeCompare(b.provider ?? "unknown")
        || (a.chainName ?? String(a.chainId)).localeCompare(b.chainName ?? String(b.chainId))
    ));
    return {
      assetType: preferred.assetType,
      id,
      logoURI: preferred.logoURI,
      name: preferred.name,
      offerings,
      providers: offerings.map(({ provider }) => provider),
      symbol: preferred.underlyingSymbol ?? preferred.symbol,
      tokens: ordered,
    };
  }).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function generatedAssetDescription(token: TokenMetadata): string {
  const provider = providerLabel(token.provider ?? "token list");
  const kind = token.assetType ? `tokenized ${token.assetType}` : "tokenized real-world asset";
  const underlying = token.underlyingSymbol && token.underlyingSymbol !== token.symbol
    ? ` linked to ${token.underlyingSymbol}`
    : "";
  return `${token.name} is a ${kind}${underlying}, listed by ${provider}. Token-holder rights and availability depend on the issuer and network.`;
}

export function groupRwaAssets(tokens: readonly TokenMetadata[]): RwaAsset[] {
  const groups = new Map<string, TokenMetadata[]>();
  for (const token of tokens) {
    const provider = (token.provider ?? "unknown").toLowerCase();
    const underlying = (token.underlyingSymbol ?? token.symbol).toLowerCase();
    const key = `${provider}:${underlying}`;
    groups.set(key, [...(groups.get(key) ?? []), token]);
  }

  return [...groups.entries()].map(([id, deployments]) => {
    const preferred = deployments.find((token) => token.logoURI)
      ?? deployments.find((token) => token.description)
      ?? deployments[0];
    const ordered = [...deployments].sort((a, b) => (
      (a.chainName ?? String(a.chainId)).localeCompare(b.chainName ?? String(b.chainId))
    ));
    return {
      assetType: preferred.assetType,
      description: preferred.description ?? generatedAssetDescription(preferred),
      id,
      logoURI: preferred.logoURI,
      name: preferred.name,
      provider: providerLabel(preferred.provider ?? "unknown"),
      symbol: preferred.symbol,
      tokens: ordered,
      underlyingSymbol: preferred.underlyingSymbol,
    };
  }).sort((a, b) => (
    (a.underlyingSymbol ?? a.symbol).localeCompare(b.underlyingSymbol ?? b.symbol)
      || a.provider.localeCompare(b.provider)
  ));
}
