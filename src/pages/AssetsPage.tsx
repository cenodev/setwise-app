import { useQuery } from "@tanstack/react-query";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, Layout, LayoutContent, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Pagination } from "@astryxdesign/core/Pagination";
import { Switch } from "@astryxdesign/core/Switch";
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
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

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
const SEARCH_RESULT_LIMIT = 50;
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
  const navigate = useNavigate();
  const [category, setCategory] = useState<AssetCategory>("all");
  const [hasLiquidityOnly, setHasLiquidityOnly] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const catalog = useQuery({
    queryKey: assetMetricsQueryKeys.all,
    queryFn: ({ signal }) => fetchAssetMetricsCatalog(signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const assets = useMemo(() => groupRwaAssets(catalog.data?.tokens ?? []), [catalog.data?.tokens]);
  const metricRows = useMemo(
    () => buildAssetMetricRows(assets, catalog.data?.metrics),
    [assets, catalog.data?.metrics],
  );
  const rows = useMemo(() => {
    return metricRows.filter((row) => (
      matchesAssetCategory(row.asset, category)
      && (!hasLiquidityOnly || row.liquidityUsd > 0)
    ));
  }, [category, hasLiquidityOnly, metricRows]);
  const searchResults = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return metricRows.filter((row) => (
      needle.length === 0 || [
        row.asset.name,
        row.asset.provider,
        row.asset.symbol,
        row.asset.underlyingSymbol,
        row.asset.assetType,
        row.networkSearch,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle))
    )).slice(0, SEARCH_RESULT_LIMIT);
  }, [metricRows, searchQuery]);
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
  const handleCategoryChange = (value: string) => {
    setCategory(value as AssetCategory);
    setPage(1);
  };
  const handleLiquidityFilterChange = (value: boolean) => {
    setHasLiquidityOnly(value);
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

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && catalog.isSuccess) {
        event.preventDefault();
        setIsSearchOpen(true);
      }
    };
    document.addEventListener("keydown", openSearch);
    return () => document.removeEventListener("keydown", openSearch);
  }, [catalog.isSuccess]);

  const handleSearchSelection = (assetId: string) => {
    if (!assetId) return;
    setIsSearchOpen(false);
    setSearchQuery("");
    void navigate(assetPath(assetId));
  };

  const handleSearchOpenChange = (isOpen: boolean) => {
    setIsSearchOpen(isOpen);
    if (!isOpen) setSearchQuery("");
  };

  return (
    <section className="screen assets-screen">
      <VStack gap={8}>
        <header className="asset-home-hero">
          <VStack gap={4} hAlign="center">
            <VStack gap={1} hAlign="center">
              <Text className="eyebrow">Setwise markets</Text>
              <Heading level={1}>Discover tokenized real-world assets</Heading>
              <Text color="secondary">
                Search equities, funds, fixed income, commodities, and currencies across supported networks.
              </Text>
            </VStack>
            <Button
              className="asset-search-trigger"
              label="Search assets, symbols, issuers, or networks"
              variant="secondary"
              size="lg"
              width="min(100%, 44rem)"
              endContent={<Badge label="⌘ K" variant="neutral" />}
              isDisabled={!catalog.isSuccess}
              onClick={() => setIsSearchOpen(true)}
            />
          </VStack>
        </header>

        <section aria-labelledby="asset-markets-title">
          <VStack gap={5}>
            <HStack className="asset-market-heading" hAlign="between" vAlign="end" gap={4}>
              <VStack gap={0}>
                <Heading id="asset-markets-title" level={2}>Markets</Heading>
                <Text type="supporting" color="secondary">Explore assets by market category and onchain liquidity.</Text>
              </VStack>
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
            </HStack>

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

            <Grid columns={{ minWidth: 220, max: 2, repeat: "fit" }} gap={4} align="center">
              <Switch
                label="Only assets with liquidity"
                value={hasLiquidityOnly}
                onChange={handleLiquidityFilterChange}
                size="sm"
              />
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
          </VStack>
        </section>

        <Text type="supporting" color="secondary">
          Liquidity and volume come from the rolling Setwise Worker snapshot and are informational, not executable quotes. A full metrics cycle currently completes in about 14 minutes. Price impact and trade-size depth will require the next quote-sampling phase.
        </Text>
      </VStack>

      <Dialog
        isOpen={isSearchOpen}
        onOpenChange={handleSearchOpenChange}
        purpose="info"
        width={640}
        maxHeight="75vh"
      >
        <Layout
          header={(
            <DialogHeader
              title="Search Setwise assets"
              subtitle="Find an asset by name, symbol, issuer, or network."
              onOpenChange={handleSearchOpenChange}
            />
          )}
          content={(
            <LayoutContent>
              <VStack gap={4}>
                <TextInput
                  label="Search Setwise assets"
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search asset, symbol, issuer, or network"
                  hasClear
                  hasAutoFocus
                />
                <Text type="supporting" color="secondary" aria-live="polite">
                  {searchResults.length} {searchResults.length === 1 ? "result" : "results"}
                </Text>
                {searchResults.length > 0 ? (
                  <List header="Assets" hasDividers density="compact">
                    {searchResults.map((row) => (
                      <ListItem
                        key={row.id}
                        label={row.asset.underlyingSymbol ?? row.asset.symbol}
                        description={`${row.asset.name} · ${row.asset.provider}`}
                        startContent={(
                          <TokenIcon
                            logoURI={row.asset.logoURI}
                            symbol={row.asset.underlyingSymbol ?? row.asset.symbol}
                          />
                        )}
                        endContent={<NetworkLogos networks={row.networks} />}
                        onClick={() => handleSearchSelection(row.asset.id)}
                      />
                    ))}
                  </List>
                ) : (
                  <Text color="secondary">No assets match that search.</Text>
                )}
              </VStack>
            </LayoutContent>
          )}
        />
      </Dialog>
    </section>
  );
}
