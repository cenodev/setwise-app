import { useEffect, useState } from "react";

import { enrichTokenDisplay, type TokenMetadataIndex, useTokenMetadata } from "../data/tokens";

export type TokenIdentityAsset = {
  address: string;
  name?: string;
  symbol: string;
  underlying?: { symbol: string };
};

type TokenIconProps = { logoURI?: string; symbol: string };

function initials(symbol: string): string {
  return symbol.trim().split(/[^a-z0-9]+/i).filter(Boolean).map((part) => part[0]).join("").slice(0, 3).toUpperCase() || "?";
}

export function TokenIcon({ logoURI, symbol }: TokenIconProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logoURI]);
  if (!logoURI || failed) return <span className="token-icon token-icon--fallback" aria-hidden="true">{initials(symbol)}</span>;
  return <img className="token-icon" src={logoURI} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function tokenDisplay(asset: TokenIdentityAsset, chainId: number, index?: TokenMetadataIndex) {
  return enrichTokenDisplay(asset, chainId, index);
}

export function TokenIdentity({
  asset,
  chainId,
  compact = false,
}: {
  asset: TokenIdentityAsset;
  chainId: number;
  compact?: boolean;
}) {
  const metadata = useTokenMetadata();
  const display = tokenDisplay(asset, chainId, metadata.data);
  return (
    <span className={compact ? "token-identity token-identity--compact" : "token-identity"}>
      <TokenIcon logoURI={display.logoURI} symbol={display.symbol} />
      <span className="token-identity__copy">
        <strong>{display.symbol}</strong>
        {!compact && <span>{display.name}</span>}
        {!compact && (display.underlyingSymbol || display.assetType) && (
          <small>{[display.underlyingSymbol, display.assetType].filter(Boolean).join(" · ")}</small>
        )}
      </span>
    </span>
  );
}
