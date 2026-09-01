import { useQuery } from "@tanstack/react-query";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Switch } from "@astryxdesign/core/Switch";
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
  assetDeploymentMetrics,
  compactUsd,
  NetworkLogos,
  summarizeAssetMetrics,
  type AssetNetwork,
} from "../components/AssetMetricsView";
import { TokenIcon } from "../components/TokenIdentity";
import { assetPath } from "../app/routes";
import { fetchAssetMetricsCatalog, type DexMetricsIndex } from "../data/assetMetrics";
import { groupUnderlyingStocks, type UnderlyingStock } from "../data/assets";
import { assetMetricsQueryKeys } from "../data/queryKeys";
import { useTokenCatalog } from "../data/tokens";

interface StockMetricRow extends Record<string, unknown> {
  id: string;
  liquidityUsd: number;
  lowestPriceUsd: number | null;
  metricsAvailable: boolean;
  networks: AssetNetwork[];
  poolCount: number;
  stock: UnderlyingStock;
  volume24hUsd: number;
}

type StockMetricSortKey = "liquidityUsd" | "volume24hUsd";

function buildStockMetricRows(
  stocks: readonly UnderlyingStock[],
  metrics?: DexMetricsIndex,
): StockMetricRow[] {
  return stocks.map((stock) => {
    const summary = summarizeAssetMetrics(stock, metrics);
    const prices = assetDeploymentMetrics(stock, metrics)
      .flatMap(({ metrics: value }) => (
        value?.priceUsd !== null && value?.priceUsd !== undefined && value.liquidityUsd > 0
          ? [value.priceUsd]
          : []
      ));
    return {
      id: stock.id,
      liquidityUsd: summary.liquidityUsd,
      lowestPriceUsd: prices.length > 0 ? Math.min(...prices) : null,
      metricsAvailable: summary.metricsAvailable,
      networks: summary.networks,
      poolCount: summary.poolCount,
      stock,
      volume24hUsd: summary.volume24hUsd,
    };
  });
}

const columns: TableColumn<StockMetricRow>[] = [
  {
    key: "stock",
    header: "Stock",
    width: proportional(3),
    renderCell: ({ stock }) => (
      <Link className="asset-detail-link" to={assetPath(stock.id)}>
        <HStack gap={3} vAlign="center">
          <TokenIcon logoURI={stock.logoURI} shape="roundedSquare" symbol={stock.symbol} />
          <Text weight="bold">{stock.symbol}</Text>
        </HStack>
      </Link>
    ),
  },
  {
    key: "lowestPriceUsd",
    header: "Best DEX price",
    width: proportional(1),
    align: "end",
    renderCell: ({ lowestPriceUsd }) => lowestPriceUsd === null ? "—" : compactUsd(lowestPriceUsd),
  },
  {
    key: "liquidityUsd",
    header: "DEX liquidity",
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
    key: "providers",
    header: "Providers",
    width: proportional(1),
    renderCell: ({ stock }) => stock.providers.length,
  },
  {
    key: "networks",
    header: "Networks",
    width: proportional(1),
    renderCell: ({ networks }) => <NetworkLogos networks={networks} />,
  },
];

export function AssetsPage() {
  const [hasLiquidityOnly, setHasLiquidityOnly] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const catalog = useQuery({
    queryKey: assetMetricsQueryKeys.all,
    queryFn: ({ signal }) => fetchAssetMetricsCatalog(signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const tokenCatalog = useTokenCatalog();
  const stocks = useMemo(
    () => groupUnderlyingStocks(tokenCatalog.data ?? catalog.data?.tokens ?? []),
    [catalog.data?.tokens, tokenCatalog.data],
  );
  const metricRows = useMemo(
    () => buildStockMetricRows(stocks, catalog.data?.metrics),
    [stocks, catalog.data?.metrics],
  );
  const rows = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return metricRows.filter((row) => {
      const searchable = [
        row.stock.symbol,
        ...row.stock.providers,
        ...row.stock.tokens.flatMap((token) => [token.name, token.symbol, token.underlyingSymbol]),
      ];
      const matchesSearch = needle.length === 0 || searchable
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
      return matchesSearch && (!hasLiquidityOnly || row.liquidityUsd > 0);
    });
  }, [hasLiquidityOnly, metricRows, searchQuery]);
  const { sortedData, sortConfig } = useTableSortableState<StockMetricRow, StockMetricSortKey>({
    data: rows,
    defaultSort: [{ sortKey: "liquidityUsd", direction: "descending" }],
    allowUnsortedState: false,
  });
  const sortPlugin = useTableSortable<StockMetricRow, StockMetricSortKey>(sortConfig);
  const displayedRows = useMemo(() => [
    ...sortedData.filter((row) => row.metricsAvailable),
    ...sortedData.filter((row) => !row.metricsAvailable),
  ], [sortedData]);

  return (
    <section className="screen assets-screen">
      <VStack gap={8}>
        <header className="asset-home-hero">
          <VStack gap={2} hAlign="center">
            <Text className="eyebrow">Tokenized stocks</Text>
            <Heading level={1}>Compare tokenized stock markets</Heading>
            <Text color="secondary">
              Search a stock, then compare its providers by observed DEX price and liquidity.
            </Text>
          </VStack>
        </header>

        <section aria-labelledby="stock-markets-title">
          <VStack gap={5}>
            <HStack className="asset-market-heading" hAlign="between" vAlign="end" gap={4}>
              <VStack gap={0}>
                <Heading id="stock-markets-title" level={2}>Stocks</Heading>
                <Text type="supporting" color="secondary">
                  One row per stock across every indexed token provider.
                </Text>
              </VStack>
              <VStack gap={0} hAlign="end">
                <Text weight="bold">{rows.length} {rows.length === 1 ? "stock" : "stocks"}</Text>
                <Text type="supporting" color="secondary">
                  {catalog.isFetching
                    ? "Refreshing market data…"
                    : catalog.data?.cache.status === "stale"
                      ? "Cached market snapshot is stale"
                      : "Market data refreshes automatically"}
                </Text>
              </VStack>
            </HStack>

            <Grid columns={{ minWidth: 240, max: 2, repeat: "fit" }} gap={4} align="end">
              <TextInput
                label="Search stocks"
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search by company, ticker, or provider"
                hasClear
                width="100%"
              />
              <Switch
                label="Only stocks with liquidity"
                value={hasLiquidityOnly}
                onChange={setHasLiquidityOnly}
                size="sm"
              />
            </Grid>

            {catalog.isPending && <Card><Text>Loading tokenized stocks…</Text></Card>}
            {catalog.error && (
              <Card>
                <VStack gap={2}>
                  <Heading level={3}>Stocks could not be loaded</Heading>
                  <Text>{catalog.error.message}</Text>
                </VStack>
              </Card>
            )}
            {catalog.isSuccess && displayedRows.length === 0 && (
              <Card>
                <EmptyState
                  title="No matching stocks"
                  description="Try another company name or ticker, or include markets without liquidity."
                  headingLevel={3}
                  isCompact
                />
              </Card>
            )}
            {catalog.isSuccess && displayedRows.length > 0 && (
              <>
                <section
                  aria-label="Stock market comparison"
                  className="asset-table asset-desktop-table"
                >
                  <Table<StockMetricRow>
                    data={displayedRows}
                    columns={columns}
                    idKey="id"
                    density="balanced"
                    dividers="rows"
                    hasHover
                    plugins={{ sort: sortPlugin }}
                    verticalAlign="top"
                  />
                </section>
                <section
                  aria-label="Mobile stock comparison"
                  className="asset-mobile-list"
                >
                  <List
                    header={<Text className="sr-only">Stock results</Text>}
                    density="spacious"
                    hasDividers
                  >
                    {displayedRows.map((row) => (
                      <ListItem
                        key={row.id}
                        label={row.stock.symbol}
                        href={assetPath(row.stock.id)}
                        startContent={(
                          <TokenIcon logoURI={row.stock.logoURI} shape="roundedSquare" symbol={row.stock.symbol} />
                        )}
                        endContent={<NetworkLogos networks={row.networks} />}
                        description={(
                          <VStack gap={2}>
                            <Text type="supporting" color="secondary">
                              {row.stock.providers.length} {row.stock.providers.length === 1 ? "provider" : "providers"}
                            </Text>
                            <Grid columns={{ minWidth: 96, max: 3, repeat: "fit" }} gap={2}>
                              <VStack gap={0}>
                                <Text type="supporting" color="secondary">Best price</Text>
                                <Text weight="semibold" hasTabularNumbers>
                                  {row.lowestPriceUsd === null ? "—" : compactUsd(row.lowestPriceUsd)}
                                </Text>
                              </VStack>
                              <VStack gap={0}>
                                <Text type="supporting" color="secondary">Liquidity</Text>
                                <Text weight="semibold" hasTabularNumbers>
                                  {row.metricsAvailable ? compactUsd(row.liquidityUsd) : "—"}
                                </Text>
                              </VStack>
                              <VStack gap={0}>
                                <Text type="supporting" color="secondary">24h volume</Text>
                                <Text weight="semibold" hasTabularNumbers>
                                  {row.metricsAvailable ? compactUsd(row.volume24hUsd) : "—"}
                                </Text>
                              </VStack>
                            </Grid>
                          </VStack>
                        )}
                      />
                    ))}
                  </List>
                </section>
              </>
            )}
          </VStack>
        </section>

        <Text type="supporting" color="secondary">
          “Best DEX price” is the lowest observed price among indexed markets with liquidity. Prices and liquidity come from the Setwise Worker snapshot and are informational, not executable quotes.
        </Text>
      </VStack>
    </section>
  );
}
