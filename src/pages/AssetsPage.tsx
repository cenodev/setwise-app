import { useQuery } from "@tanstack/react-query";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import {
  Table,
  proportional,
  useTableSortable,
  useTableSortableState,
} from "@astryxdesign/core/Table";
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
  networkSearch: string;
  networks: AssetNetwork[];
  poolCount: number;
  priceUsd: number | null;
  topVenue: string | null;
  volume24hUsd: number;
}

type AssetMetricSortKey = "liquidityUsd" | "volume24hUsd";

type AssetNetwork = {
  chainId: number;
  name: string;
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

function NetworkLogo({ network }: { network: AssetNetwork }) {
  const [failed, setFailed] = useState(false);
  const logo = networkIconUrl(network.chainId);
  if (!logo || failed) {
    return <span className="asset-network-logo asset-network-logo--fallback" title={network.name}>{network.name.slice(0, 2).toUpperCase()}</span>;
  }
  return <img className="asset-network-logo" src={logo} alt="" title={network.name} loading="lazy" onError={() => setFailed(true)} />;
}

function NetworkLogos({ networks }: { networks: AssetNetwork[] }) {
  const visible = networks.slice(0, 5);
  return (
    <span className="asset-network-logos" role="img" aria-label={`Networks: ${networks.map(({ name }) => name).join(", ")}`}>
      {visible.map((network) => <NetworkLogo key={network.chainId} network={network} />)}
      {networks.length > visible.length && <span className="asset-network-overflow">+{networks.length - visible.length}</span>}
    </span>
  );
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
    const networks = [...new Map(asset.tokens.map((token) => [
      token.chainId,
      { chainId: token.chainId, name: token.chainName ?? `Chain ${token.chainId}` },
    ])).values()];
    return {
      asset,
      id: asset.id,
      liquidityUsd: values.reduce((sum, value) => sum + value.liquidityUsd, 0),
      metricsAvailable: values.length > 0,
      networkSearch: networks.map(({ name }) => name).join(", "),
      networks,
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
        </VStack>
      </HStack>
    ),
  },
  {
    key: "networks",
    header: "Networks",
    width: proportional(1),
    renderCell: ({ networks }) => <NetworkLogos networks={networks} />,
  },
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
    sortable: true,
    renderCell: (row) => row.metricsAvailable ? compactUsd(row.liquidityUsd) : "—",
  },
  {
    key: "volume24hUsd",
    header: "24h volume",
    width: proportional(1),
    align: "end",
    sortable: true,
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
    return buildAssetMetricRows(assets, catalog.data?.metrics).filter(({ asset, networkSearch }) => (
      needle.length === 0 || [
        asset.name,
        asset.provider,
        asset.symbol,
        asset.underlyingSymbol,
        asset.assetType,
        networkSearch,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle))
    ));
  }, [assets, catalog.data?.metrics, search]);
  const { sortedData, sort, sortConfig } = useTableSortableState<AssetMetricRow, AssetMetricSortKey>({
    data: rows,
    defaultSort: [{ sortKey: "liquidityUsd", direction: "descending" }],
    allowUnsortedState: false,
  });
  const sortPlugin = useTableSortable<AssetMetricRow, AssetMetricSortKey>(sortConfig);
  const displayedRows = useMemo(() => {
    if (sort.length === 0) return sortedData;
    return [
      ...sortedData.filter((row) => row.metricsAvailable),
      ...sortedData.filter((row) => !row.metricsAvailable),
    ];
  }, [sort, sortedData]);
  const setMobileSort = (sortKey: AssetMetricSortKey) => {
    const current = sort[0];
    const direction = current?.sortKey === sortKey && current.direction === "descending"
      ? "ascending"
      : "descending";
    sortConfig.onSortChange([{ sortKey, direction }]);
  };

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
          <section aria-label="RWA asset metrics" className="asset-results">
            <div className="asset-table">
              <Table<AssetMetricRow>
                data={displayedRows}
                columns={columns}
                idKey="id"
                density="balanced"
                dividers="rows"
                hasHover
                plugins={{ sort: sortPlugin }}
                verticalAlign="top"
              />
            </div>

            <div className="asset-mobile-sort" role="group" aria-label="Sort assets">
              <Text type="supporting" color="secondary">Sort by</Text>
              <Button
                label={`Liquidity ${sort[0]?.sortKey === "liquidityUsd" && sort[0].direction === "ascending" ? "↑" : "↓"}`}
                variant={sort[0]?.sortKey === "liquidityUsd" ? "primary" : "secondary"}
                size="sm"
                onClick={() => setMobileSort("liquidityUsd")}
              />
              <Button
                label={`Volume ${sort[0]?.sortKey === "volume24hUsd" && sort[0].direction === "ascending" ? "↑" : "↓"}`}
                variant={sort[0]?.sortKey === "volume24hUsd" ? "primary" : "secondary"}
                size="sm"
                onClick={() => setMobileSort("volume24hUsd")}
              />
            </div>

            <div className="asset-card-list">
              {displayedRows.map((row) => (
                <Card key={row.id}>
                  <VStack gap={4}>
                    <HStack gap={3} vAlign="center" className="asset-card-heading">
                      <HStack gap={3} vAlign="center">
                        <TokenIcon logoURI={row.asset.logoURI} symbol={row.asset.underlyingSymbol ?? row.asset.symbol} />
                        <VStack gap={0}>
                          <Text weight="bold">{row.asset.underlyingSymbol ?? row.asset.symbol}</Text>
                          <Text type="supporting" color="secondary">{row.asset.name} · {row.asset.provider}</Text>
                        </VStack>
                      </HStack>
                      <NetworkLogos networks={row.networks} />
                    </HStack>
                    <div className="asset-card-metrics">
                      <div><Text type="supporting" color="secondary">Liquidity</Text><Text weight="bold">{row.metricsAvailable ? compactUsd(row.liquidityUsd) : "—"}</Text></div>
                      <div><Text type="supporting" color="secondary">24h volume</Text><Text weight="bold">{row.metricsAvailable ? compactUsd(row.volume24hUsd) : "—"}</Text></div>
                      <div><Text type="supporting" color="secondary">DEX price</Text><Text weight="bold">{row.priceUsd === null ? "—" : compactUsd(row.priceUsd)}</Text></div>
                      <div><Text type="supporting" color="secondary">Pools</Text><Text weight="bold">{row.metricsAvailable ? String(row.poolCount) : "—"}</Text></div>
                    </div>
                    <HStack gap={2} vAlign="center">
                      <Text type="supporting" color="secondary">Top venue</Text>
                      <Badge label={row.topVenue ?? "Unavailable"} variant="neutral" />
                    </HStack>
                  </VStack>
                </Card>
              ))}
            </div>
          </section>
        )}

        <Text type="supporting" color="secondary">
          Liquidity and volume come from the last complete Setwise Worker snapshot and are informational, not executable quotes. Price impact and trade-size depth will require the next quote-sampling phase.
        </Text>
      </VStack>
    </section>
  );
}
