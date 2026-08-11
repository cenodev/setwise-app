import { useQuery } from "@tanstack/react-query";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Table, proportional } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Heading, Text } from "@astryxdesign/core/Text";
import { useMemo, useState } from "react";

import { TokenIcon } from "../components/TokenIdentity";
import {
  fetchAssetMetricsCatalog,
  type DeploymentDexMetrics,
  type DexMetricsIndex,
} from "../data/assetMetrics";
import { groupRwaAssets, type RwaAsset } from "../data/assets";
import { assetMetricsQueryKeys } from "../data/queryKeys";
import { tokenMetadataKey } from "../data/tokens";

interface AssetMetricRow extends Record<string, unknown> {
  asset: RwaAsset;
  id: string;
  liquidityUsd: number;
  metricsAvailable: boolean;
  networks: string;
  poolCount: number;
  priceUsd: number | null;
  topVenue: string | null;
  volume24hUsd: number;
}

function compactUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value < 1_000 ? 2 : 1,
    notation: value >= 1_000 ? "compact" : "standard",
    style: "currency",
  }).format(value);
}

function deploymentMetrics(asset: RwaAsset, metrics: DexMetricsIndex | undefined): DeploymentDexMetrics[] {
  if (!metrics) return [];
  return asset.tokens.flatMap((token) => {
    const value = metrics.get(tokenMetadataKey(token.chainId, token.address));
    return value ? [value] : [];
  });
}

function buildAssetMetricRows(assets: readonly RwaAsset[], metrics?: DexMetricsIndex): AssetMetricRow[] {
  return assets.map((asset) => {
    const values = deploymentMetrics(asset, metrics);
    const mostLiquid = [...values].sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0];
    return {
      asset,
      id: asset.id,
      liquidityUsd: values.reduce((sum, value) => sum + value.liquidityUsd, 0),
      metricsAvailable: values.length > 0,
      networks: [...new Set(asset.tokens.map((token) => token.chainName ?? `Chain ${token.chainId}`))].join(", "),
      poolCount: values.reduce((sum, value) => sum + value.poolCount, 0),
      priceUsd: mostLiquid?.priceUsd ?? null,
      topVenue: mostLiquid?.topVenue ?? null,
      volume24hUsd: values.reduce((sum, value) => sum + value.volume24hUsd, 0),
    };
  });
}

const columns: TableColumn<AssetMetricRow>[] = [
  {
    key: "asset",
    header: "Asset",
    width: proportional(3),
    renderCell: ({ asset }) => (
      <HStack gap={3} vAlign="center">
        <TokenIcon logoURI={asset.logoURI} symbol={asset.underlyingSymbol ?? asset.symbol} />
        <VStack gap={0}>
          <Text weight="bold">{asset.underlyingSymbol ?? asset.symbol}</Text>
          <Text type="supporting" color="secondary">{asset.name} · {asset.provider}</Text>
          <Text type="supporting" color="secondary">{asset.description}</Text>
        </VStack>
      </HStack>
    ),
  },
  { key: "networks", header: "Networks", width: proportional(2) },
  {
    key: "priceUsd",
    header: "DEX price",
    width: proportional(1),
    align: "end",
    renderCell: (row) => row.priceUsd === null ? "—" : compactUsd(row.priceUsd),
  },
  {
    key: "liquidityUsd",
    header: "Liquidity",
    width: proportional(1),
    align: "end",
    renderCell: (row) => row.metricsAvailable ? compactUsd(row.liquidityUsd) : "—",
  },
  {
    key: "volume24hUsd",
    header: "24h volume",
    width: proportional(1),
    align: "end",
    renderCell: (row) => row.metricsAvailable ? compactUsd(row.volume24hUsd) : "—",
  },
  {
    key: "poolCount",
    header: "Pools",
    width: proportional(1),
    align: "end",
    renderCell: (row) => row.metricsAvailable ? String(row.poolCount) : "—",
  },
  {
    key: "topVenue",
    header: "Top venue",
    width: proportional(1),
    renderCell: (row) => row.topVenue ?? "—",
  },
  {
    key: "depth",
    header: "Depth / impact",
    width: proportional(1),
    renderCell: () => <Badge label="Not sampled" variant="neutral" />,
  },
];

export function AssetsPage() {
  const [search, setSearch] = useState("");
  const catalog = useQuery({
    queryKey: assetMetricsQueryKeys.all,
    queryFn: ({ signal }) => fetchAssetMetricsCatalog(signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const assets = useMemo(() => groupRwaAssets(catalog.data?.tokens ?? []), [catalog.data?.tokens]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return buildAssetMetricRows(assets, catalog.data?.metrics).filter(({ asset, networks }) => (
      needle.length === 0 || [
        asset.name,
        asset.provider,
        asset.symbol,
        asset.underlyingSymbol,
        asset.assetType,
        networks,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle))
    ));
  }, [assets, catalog.data?.metrics, search]);

  return (
    <section className="screen assets-screen">
      <VStack gap={6}>
        <header className="screen-header">
          <p className="eyebrow">Market data</p>
          <h1>RWA assets</h1>
          <p>Compare tokenized real-world assets and their visible DEX liquidity across networks.</p>
        </header>

        <Grid columns={{ minWidth: 240, max: 2, repeat: "fit" }} gap={4} align="end">
          <TextInput
            label="Search assets"
            value={search}
            onChange={setSearch}
            placeholder="Symbol, asset, issuer or network"
            hasClear
            width="min(100%, 32rem)"
          />
          <VStack gap={0} hAlign="end">
            <Text weight="bold">{rows.length} assets</Text>
            <Text type="supporting" color="secondary">
              {catalog.isFetching
                ? "Refreshing cached metrics…"
                : catalog.data?.cache.status === "stale"
                  ? "Cached snapshot is stale"
                  : "Worker cache refreshes every five minutes"}
            </Text>
          </VStack>
        </Grid>

        {catalog.isPending && <Card><Text>Loading token metadata…</Text></Card>}
        {catalog.error && (
          <Card>
            <Heading level={3}>Assets could not be loaded</Heading>
            <Text>{catalog.error.message}</Text>
          </Card>
        )}
        {catalog.isSuccess && (
          <section aria-label="RWA asset metrics">
            <Table<AssetMetricRow>
              data={rows}
              columns={columns}
              idKey="id"
              density="balanced"
              dividers="rows"
              hasHover
              verticalAlign="top"
            />
          </section>
        )}

        <Text type="supporting" color="secondary">
          Liquidity and volume come from the last complete Setwise Worker snapshot and are informational, not executable quotes. Price impact and trade-size depth will require the next quote-sampling phase.
        </Text>
      </VStack>
    </section>
  );
}
