import { HStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { useState } from "react";

import type { DeploymentDexMetrics, DexMetricsIndex } from "../data/assetMetrics";
import type { RwaAsset } from "../data/assets";
import { tokenMetadataKey, type TokenMetadata } from "../data/tokens";

export type AssetNetwork = {
  chainId: number;
  name: string;
};

export type AssetDeploymentMetric = {
  metrics: DeploymentDexMetrics | undefined;
  network: AssetNetwork;
  token: TokenMetadata;
};

export type AssetMetricSummary = {
  liquidityUsd: number;
  metricsAvailable: boolean;
  networks: AssetNetwork[];
  poolCount: number;
  priceUsd: number | null;
  topVenue: string | null;
  volume24hUsd: number;
};

const networkIconSlugs: Readonly<Record<number, string>> = {
  [-239]: "ton",
  1: "ethereum",
  56: "bsc",
  97: "bsc",
  101: "solana",
  137: "polygon",
  143: "monad",
  196: "x-layer",
  988: "stable",
  999: "hyperliquid",
  1030: "conflux",
  4663: "robinhood-chain",
  5000: "mantle",
  9745: "plasma",
  42161: "arbitrum",
  42220: "celo",
  43114: "avalanche",
  57073: "ink",
};

function networkIconUrl(chainId: number): string | undefined {
  const slug = networkIconSlugs[chainId];
  return slug ? `https://icons.llamao.fi/icons/chains/rsz_${slug}.jpg` : undefined;
}

export function NetworkLogo({ network }: { network: AssetNetwork }) {
  const [failed, setFailed] = useState(false);
  const logo = networkIconUrl(network.chainId);
  if (!logo || failed) {
    return (
      <span className="asset-network-logo asset-network-logo--fallback" title={network.name}>
        {network.name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className="asset-network-logo"
      src={logo}
      alt=""
      title={network.name}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function NetworkLogos({ networks }: { networks: AssetNetwork[] }) {
  if (networks.length === 0) return null;
  const visible = networks.slice(0, 5);
  return (
    <span
      className="asset-network-logos"
      role="img"
      aria-label={`Networks: ${networks.map(({ name }) => name).join(", ")}`}
    >
      {visible.map((network) => <NetworkLogo key={network.chainId} network={network} />)}
      {networks.length > visible.length && (
        <span className="asset-network-overflow">+{networks.length - visible.length}</span>
      )}
    </span>
  );
}

export function NetworkIdentity({ network }: { network: AssetNetwork }) {
  return (
    <HStack gap={2} vAlign="center">
      <NetworkLogos networks={[network]} />
      <Text>{network.name}</Text>
    </HStack>
  );
}

export function compactUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value > 0 && value < 1 ? 6 : value < 1_000 ? 2 : 1,
    notation: value >= 1_000 ? "compact" : "standard",
    style: "currency",
  }).format(value);
}

export function assetDeploymentMetrics(
  asset: RwaAsset,
  metrics: DexMetricsIndex | undefined,
): AssetDeploymentMetric[] {
  return asset.tokens.map((token) => ({
    metrics: metrics?.get(tokenMetadataKey(token.chainId, token.address)),
    network: {
      chainId: token.chainId,
      name: token.chainName ?? `Chain ${token.chainId}`,
    },
    token,
  }));
}

export function summarizeAssetMetrics(
  asset: RwaAsset,
  metrics: DexMetricsIndex | undefined,
): AssetMetricSummary {
  const deployments = assetDeploymentMetrics(asset, metrics);
  const liquidDeployments = deployments.filter(({ metrics: value }) => (
    value !== undefined && value.liquidityUsd > 0
  ));
  const values = liquidDeployments.flatMap(({ metrics: value }) => value ? [value] : []);
  const mostLiquid = [...values].sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0];
  const mostLiquidPriced = [...values]
    .filter((value) => value.priceUsd !== null)
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0];
  const networks = [...new Map(
    liquidDeployments.map(({ network }) => [network.chainId, network]),
  ).values()];
  return {
    liquidityUsd: values.reduce((sum, value) => sum + value.liquidityUsd, 0),
    metricsAvailable: values.length > 0,
    networks,
    poolCount: values.reduce((sum, value) => sum + value.poolCount, 0),
    priceUsd: mostLiquidPriced?.priceUsd ?? null,
    topVenue: mostLiquid?.topVenue ?? null,
    volume24hUsd: values.reduce((sum, value) => sum + value.volume24hUsd, 0),
  };
}
