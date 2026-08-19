import { useQuery } from "@tanstack/react-query";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Pagination } from "@astryxdesign/core/Pagination";
import { Tab, TabList, TabMenu } from "@astryxdesign/core/TabList";
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
import { Link } from "react-router-dom";

import {
  compactUsd,
  NetworkLogos,
  summarizeAssetMetrics,
  type AssetNetwork,
} from "../components/AssetMetricsView";
import { TokenIcon } from "../components/TokenIdentity";
import { fetchAssetMetricsCatalog, type DexMetricsIndex } from "../data/assetMetrics";
import { groupRwaAssets, type RwaAsset } from "../data/assets";
import { assetMetricsQueryKeys } from "../data/queryKeys";
import { assetPath } from "../app/routes";

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
type AssetCategory = "all" | "commodities" | "currencies" | "equities" | "fixed-income" | "funds" | "real-estate";

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100];
const CATEGORY_ASSET_TYPES: Readonly<Record<Exclude<AssetCategory, "all">, readonly string[]>> = {
  commodities: ["commodity"],
  currencies: ["currency", "crypto"],
  equities: ["equity", "private-equity"],
  "fixed-income": ["bond", "credit", "treasury"],
  funds: ["etf", "fund"],
  "real-estate": ["real-estate"],
};

function matchesAssetCategory(asset: RwaAsset, category: AssetCategory): boolean {
  return category === "all" || CATEGORY_ASSET_TYPES[category].includes(asset.assetType?.toLowerCase() ?? "");
}

function buildAssetMetricRows(assets: readonly RwaAsset[], metrics?: DexMetricsIndex): AssetMetricRow[] {
  return assets.map((asset) => {
    const summary = summarizeAssetMetrics(asset, metrics);
    return {
      asset,
      id: asset.id,
      ...summary,
      networkSearch: summary.networks.map(({ name }) => name).join(", "),
    };
  });
}

const columns: TableColumn<AssetMetricRow>[] = [
  {
    key: "asset",
    header: "Asset",
    width: proportional(3),
    renderCell: ({ asset }) => (
      <Link className="asset-detail-link" to={assetPath(asset.id)}>
        <HStack gap={3} vAlign="center">
          <TokenIcon logoURI={asset.logoURI} symbol={asset.underlyingSymbol ?? asset.symbol} />
          <VStack gap={0}>
            <Text weight="bold">{asset.underlyingSymbol ?? asset.symbol}</Text>
            <Text type="supporting" color="secondary">{asset.name} · {asset.provider}</Text>
          </VStack>
        </HStack>
      </Link>
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
  const [category, setCategory] = useState<AssetCategory>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const catalog = useQuery({
    queryKey: assetMetricsQueryKeys.all,
    queryFn: ({ signal }) => fetchAssetMetricsCatalog(signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const assets = useMemo(() => groupRwaAssets(catalog.data?.tokens ?? []), [catalog.data?.tokens]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const categoryAssets = assets.filter((asset) => matchesAssetCategory(asset, category));
    return buildAssetMetricRows(categoryAssets, catalog.data?.metrics).filter(({ asset, networkSearch }) => (
      needle.length === 0 || [
        asset.name,
        asset.provider,
        asset.symbol,
        asset.underlyingSymbol,
        asset.assetType,
        networkSearch,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle))
    ));
  }, [assets, catalog.data?.metrics, category, search]);
  const { sortedData, sort, sortConfig } = useTableSortableState<AssetMetricRow, AssetMetricSortKey>({
    data: rows,
    defaultSort: [{ sortKey: "liquidityUsd", direction: "descending" }],
    allowUnsortedState: false,
  });
  const handleSortChange: typeof sortConfig.onSortChange = (nextSort) => {
    setPage(1);
    sortConfig.onSortChange(nextSort);
  };
  const sortPlugin = useTableSortable<AssetMetricRow, AssetMetricSortKey>({
    ...sortConfig,
    onSortChange: handleSortChange,
  });
  const displayedRows = useMemo(() => {
    if (sort.length === 0) return sortedData;
    return [
      ...sortedData.filter((row) => row.metricsAvailable),
      ...sortedData.filter((row) => !row.metricsAvailable),
    ];
  }, [sort, sortedData]);
  const totalPages = Math.max(1, Math.ceil(displayedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = displayedRows.slice(pageStart, pageStart + pageSize);
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const handleCategoryChange = (value: string) => {
    setCategory(value as AssetCategory);
    setPage(1);
  };
  const handlePageSizeChange = (nextPageSize: number) => {
    setPageSize(nextPageSize);
    setPage(1);
  };
  const setMobileSort = (sortKey: AssetMetricSortKey) => {
    const current = sort[0];
    const direction = current?.sortKey === sortKey && current.direction === "descending"
      ? "ascending"
      : "descending";
    handleSortChange([{ sortKey, direction }]);
  };

  return (
    <section className="screen assets-screen">
      <VStack gap={6}>
        <header className="screen-header">
          <p className="eyebrow">Market data</p>
          <h1>RWA assets</h1>
          <p>Compare tokenized real-world assets and their visible DEX liquidity across networks.</p>
        </header>

        <TabList
          value={category}
          onChange={handleCategoryChange}
          size="sm"
          hasDivider
          aria-label="Asset categories"
        >
          <Tab value="all" label="All" />
          <Tab value="equities" label="Equities" />
          <Tab value="funds" label="Funds" />
          <Tab value="fixed-income" label="Fixed income" />
          <TabMenu
            label="More"
            options={[
              { value: "commodities", label: "Commodities" },
              { value: "real-estate", label: "Real estate" },
              { value: "currencies", label: "Currencies" },
            ]}
          />
        </TabList>

        <Grid columns={{ minWidth: 240, max: 2, repeat: "fit" }} gap={4} align="end">
          <TextInput
            label="Search assets"
            value={search}
            onChange={handleSearchChange}
            placeholder="Symbol, asset, issuer or network"
            hasClear
            width="min(100%, 32rem)"
          />
          <VStack gap={0} hAlign="end">
            <Text weight="bold">{rows.length} {rows.length === 1 ? "asset" : "assets"}</Text>
            <Text type="supporting" color="secondary">
              {catalog.isFetching
                ? "Refreshing cached metrics…"
                : catalog.data?.cache.status === "stale"
                  ? "Cached snapshot is stale"
                  : "Worker refreshes a metrics slice every two minutes"}
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
                data={pageRows}
                columns={columns}
                idKey="id"
                density="balanced"
                dividers="rows"
                hasHover
                plugins={{ sort: sortPlugin }}
                rowCount={displayedRows.length}
                rowIndexStart={pageStart + 1}
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
              {pageRows.map((row) => (
                <Card key={row.id}>
                  <VStack gap={4}>
                    <HStack gap={3} vAlign="center" className="asset-card-heading">
                      <HStack gap={3} vAlign="center">
                        <TokenIcon logoURI={row.asset.logoURI} symbol={row.asset.underlyingSymbol ?? row.asset.symbol} />
                        <Link className="asset-detail-link" to={assetPath(row.asset.id)}>
                          <VStack gap={0}>
                            <Text weight="bold">{row.asset.underlyingSymbol ?? row.asset.symbol}</Text>
                            <Text type="supporting" color="secondary">{row.asset.name} · {row.asset.provider}</Text>
                          </VStack>
                        </Link>
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

            {displayedRows.length > pageSize && (
              <HStack hAlign="center">
                <Pagination
                  page={currentPage}
                  onChange={setPage}
                  totalItems={displayedRows.length}
                  pageSize={pageSize}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  onPageSizeChange={handlePageSizeChange}
                  variant="input"
                  size="sm"
                  label="Asset pages"
                />
              </HStack>
            )}
          </section>
        )}

        <Text type="supporting" color="secondary">
          Liquidity and volume come from the rolling Setwise Worker snapshot and are informational, not executable quotes. A full metrics cycle currently completes in about 14 minutes. Price impact and trade-size depth will require the next quote-sampling phase.
        </Text>
      </VStack>
    </section>
  );
}
