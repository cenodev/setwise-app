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

function providerLabel(provider: string): string {
  return provider.split(/[-_]/).filter(Boolean).map((part) => (
    part.charAt(0).toUpperCase() + part.slice(1)
  )).join(" ");
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
