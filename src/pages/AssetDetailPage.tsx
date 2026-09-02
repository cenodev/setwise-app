import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { proportional, Table, type TableColumn } from "@astryxdesign/core/Table";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { ArrowClockwise } from "@phosphor-icons/react";
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  assetDeploymentMetrics,
  compactUsd,
  NetworkIdentity,
  NetworkLogos,
  summarizeAssetMetrics,
  type AssetDeploymentMetric,
} from "../components/AssetMetricsView";
import { TokenIcon } from "../components/TokenIdentity";
import { assetsPath } from "../app/routes";
import {
  fetchAssetMetricsCatalog,
  mergeAssetMetricsRefresh,
  refreshAssetMetricsForAsset,
  type AssetMetricsCatalog,
} from "../data/assetMetrics";
import { groupUnderlyingStocks, providerLabel } from "../data/assets";
import { assetMetricsQueryKeys } from "../data/queryKeys";
import { useTokenCatalog } from "../data/tokens";

interface ProviderMarketRow extends AssetDeploymentMetric, Record<string, unknown> {
  bestLiquidity: boolean;
  bestPrice: boolean;
  id: string;
  provider: string;
}

const providerMarketColumns: TableColumn<ProviderMarketRow>[] = [
  {
    key: "provider",
    header: "Provider",
    width: proportional(2),
    renderCell: ({ provider, token }) => (
      <VStack gap={0}>
        <Text weight="bold">{provider}</Text>
        <Text type="supporting" color="secondary">{token.symbol}</Text>
      </VStack>
    ),
  },
  {
    key: "network",
    header: "Network",
    width: proportional(2),
    renderCell: ({ network }) => <NetworkIdentity network={network} />,
  },
  {
    key: "stockPriceUsd",
    header: "Stock price",
    width: proportional(1),
    align: "end",
    renderCell: ({ metrics }) => (
      <Text hasTabularNumbers>
        {metrics?.referencePrice === null || metrics?.referencePrice === undefined
          ? "—"
          : compactUsd(metrics.referencePrice.priceUsd)}
      </Text>
    ),
  },
  {
    key: "priceUsd",
    header: "DEX price",
    width: proportional(1),
    align: "end",
    renderCell: ({ bestPrice, metrics }) => (
      <VStack gap={0} hAlign="end">
        <Text hasTabularNumbers>
          {metrics?.priceUsd === null || metrics?.priceUsd === undefined
            ? "—"
            : compactUsd(metrics.priceUsd)}
        </Text>
        {bestPrice && <Text type="supporting" color="accent">Best price</Text>}
      </VStack>
    ),
  },
  {
    key: "liquidityUsd",
    header: "DEX liquidity",
    width: proportional(1),
    align: "end",
    renderCell: ({ bestLiquidity, metrics }) => (
      <VStack gap={0} hAlign="end">
        <Text hasTabularNumbers>{metrics ? compactUsd(metrics.liquidityUsd) : "—"}</Text>
        {bestLiquidity && <Text type="supporting" color="accent">Best liquidity</Text>}
      </VStack>
    ),
  },
  {
    key: "volume24hUsd",
    header: "24h volume",
    width: proportional(1),
    align: "end",
    renderCell: ({ metrics }) => metrics ? compactUsd(metrics.volume24hUsd) : "—",
  },
  {
    key: "topVenue",
    header: "Top venue",
    width: proportional(1),
    renderCell: ({ metrics }) => metrics?.topVenue ?? "—",
  },
];

function lowestLiquidPrice(rows: readonly ProviderMarketRow[]): number | null {
  const prices = rows.flatMap(({ metrics }) => (
    metrics?.priceUsd !== null && metrics?.priceUsd !== undefined && metrics.liquidityUsd > 0
      ? [metrics.priceUsd]
      : []
  ));
  return prices.length > 0 ? Math.min(...prices) : null;
}

export function AssetDetailPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const normalizedAssetId = assetId?.toLowerCase().split(":").at(-1);
  const stock = stocks.find(({ id }) => id === normalizedAssetId);
  const refresh = useMutation({
    mutationFn: () => refreshAssetMetricsForAsset(stock?.symbol ?? ""),
    onSuccess: (result) => {
      queryClient.setQueryData<AssetMetricsCatalog>(assetMetricsQueryKeys.all, (current) => (
        current ? mergeAssetMetricsRefresh(current, result) : current
      ));
    },
  });
  const refreshedAt = refresh.data && refresh.data.asset.toLowerCase() === stock?.symbol.toLowerCase()
    ? refresh.data.generatedAt
    : undefined;
  const summary = useMemo(
    () => stock ? summarizeAssetMetrics(stock, catalog.data?.metrics) : undefined,
    [stock, catalog.data?.metrics],
  );
  const markets = useMemo<ProviderMarketRow[]>(() => {
    if (!stock) return [];
    const deployments = assetDeploymentMetrics(stock, catalog.data?.metrics)
      .filter(({ metrics }) => metrics !== undefined && metrics.liquidityUsd > 0);
    const lowestPrice = Math.min(...deployments.flatMap(({ metrics }) => (
      metrics?.priceUsd !== null && metrics?.priceUsd !== undefined && metrics.liquidityUsd > 0
        ? [metrics.priceUsd]
        : []
    )));
    const deepestLiquidity = Math.max(...deployments.map(({ metrics }) => metrics?.liquidityUsd ?? 0));
    return deployments.map((deployment) => ({
      ...deployment,
      bestLiquidity: deepestLiquidity > 0 && deployment.metrics?.liquidityUsd === deepestLiquidity,
      bestPrice: Number.isFinite(lowestPrice) && deployment.metrics?.priceUsd === lowestPrice,
      id: `${deployment.token.chainId}:${deployment.token.address.toLowerCase()}`,
      provider: providerLabel(deployment.token.provider ?? "unknown"),
    })).sort((a, b) => (
      (b.metrics?.liquidityUsd ?? -1) - (a.metrics?.liquidityUsd ?? -1)
        || a.provider.localeCompare(b.provider)
    ));
  }, [stock, catalog.data?.metrics]);
  const bestPrice = lowestLiquidPrice(markets);
  const providerCount = new Set(markets.map(({ provider }) => provider)).size;

  return (
    <section className="screen assets-screen">
      <VStack gap={6}>
        <Breadcrumbs variant="supporting" label="Stock navigation">
          <BreadcrumbItem
            href={assetsPath()}
            onClick={(event) => {
              event.preventDefault();
              void navigate(assetsPath());
            }}
          >
            Stocks
          </BreadcrumbItem>
          <BreadcrumbItem isCurrent>
            {stock?.symbol ?? "Stock details"}
          </BreadcrumbItem>
        </Breadcrumbs>

        {catalog.isPending && <Card><Text>Loading stock markets…</Text></Card>}

        {catalog.error && (
          <Card>
            <VStack gap={2}>
              <Heading level={2}>Stock markets could not be loaded</Heading>
              <Text>{catalog.error.message}</Text>
            </VStack>
          </Card>
        )}

        {catalog.isSuccess && !stock && (
          <Card>
            <VStack gap={2}>
              <Heading level={2}>Stock not found</Heading>
              <Text>This stock is not present in the current Setwise token list.</Text>
            </VStack>
          </Card>
        )}

        {catalog.isSuccess && stock && summary && (
          <>
            <header className="screen-header">
              <HStack gap={4} vAlign="center" className="asset-detail-heading">
                <TokenIcon logoURI={stock.logoURI} shape="roundedSquare" symbol={stock.symbol} />
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">Stock</Text>
                  <Heading level={1}>{stock.symbol}</Heading>
                  <Text color="secondary">
                    {markets.length > 0
                      ? `Compare ${markets.length} tokenized ${markets.length === 1 ? "market" : "markets"} from ${providerCount} ${providerCount === 1 ? "provider" : "providers"}.`
                      : "No tokenized markets currently have observed DEX liquidity."}
                  </Text>
                </VStack>
                <NetworkLogos networks={summary.networks} />
              </HStack>
            </header>

            <Grid columns={{ minWidth: 160, max: 4, repeat: "fit" }} gap={3}>
              <Card>
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">Best DEX price</Text>
                  <Text weight="bold" hasTabularNumbers>
                    {bestPrice === null ? "—" : compactUsd(bestPrice)}
                  </Text>
                </VStack>
              </Card>
              <Card>
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">Total DEX liquidity</Text>
                  <Text weight="bold" hasTabularNumbers>
                    {summary.metricsAvailable ? compactUsd(summary.liquidityUsd) : "—"}
                  </Text>
                </VStack>
              </Card>
              <Card>
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">24h volume</Text>
                  <Text weight="bold" hasTabularNumbers>
                    {summary.metricsAvailable ? compactUsd(summary.volume24hUsd) : "—"}
                  </Text>
                </VStack>
              </Card>
              <Card>
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">Providers</Text>
                  <Text weight="bold" hasTabularNumbers>{providerCount}</Text>
                </VStack>
              </Card>
            </Grid>

            <section aria-labelledby="provider-markets-title">
              <VStack gap={4}>
                <VStack gap={1}>
                  <Heading level={2} id="provider-markets-title">Provider markets</Heading>
                  <Text type="supporting" color="secondary">
                    Markets with observed DEX liquidity, ranked by liquidity. Best price means the lowest observed price among these markets.
                  </Text>
                </VStack>

                <section className="asset-table">
                  <Toolbar
                    label="Provider market actions"
                    size="sm"
                    variant="section"
                    dividers={["bottom"]}
                    startContent={<Text className="sr-only">Provider markets</Text>}
                    endContent={(
                      <IconButton
                        label="Refresh market data"
                        icon={<Icon icon={ArrowClockwise} color="inherit" />}
                        variant="ghost"
                        isLoading={refresh.isPending}
                        tooltip="Refresh market data"
                        onClick={() => refresh.mutate()}
                      />
                    )}
                  />

                  {markets.length === 0 ? (
                    <EmptyState
                      title="No liquid provider markets"
                      description="No indexed provider currently has observed DEX liquidity for this stock."
                      headingLevel={3}
                      isCompact
                    />
                  ) : (
                    <>
                      <section
                        className="asset-desktop-table"
                        aria-label="Tokenized stock provider comparison"
                      >
                        <Table<ProviderMarketRow>
                          data={markets}
                          columns={providerMarketColumns}
                          idKey="id"
                          density="balanced"
                          dividers="rows"
                          hasHover
                          verticalAlign="top"
                          textOverflow="wrap"
                        />
                      </section>
                      <section
                        className="asset-mobile-list asset-mobile-list--embedded"
                        aria-label="Mobile tokenized stock provider comparison"
                      >
                        <List
                          header={<Text className="sr-only">Provider market results</Text>}
                          density="spacious"
                          hasDividers
                        >
                          {markets.map(({ bestLiquidity, bestPrice: rowBestPrice, id, metrics, network, provider, token }) => (
                            <ListItem
                              key={id}
                              label={provider}
                              startContent={<NetworkLogos networks={[network]} />}
                              endContent={<Text type="supporting" color="secondary">{token.symbol}</Text>}
                              description={(
                                <VStack gap={2}>
                                  <Text type="supporting" color="secondary">
                                    {network.name}{metrics?.topVenue ? ` · ${metrics.topVenue}` : ""}
                                  </Text>
                                  <Grid columns={{ minWidth: 96, max: 4, repeat: "fit" }} gap={2}>
                                    <VStack gap={0}>
                                      <Text type="supporting" color="secondary">Stock price</Text>
                                      <Text weight="semibold" hasTabularNumbers>
                                        {metrics?.referencePrice === null || metrics?.referencePrice === undefined
                                          ? "—"
                                          : compactUsd(metrics.referencePrice.priceUsd)}
                                      </Text>
                                    </VStack>
                                    <VStack gap={0}>
                                      <Text type="supporting" color="secondary">DEX price</Text>
                                      <Text weight="semibold" hasTabularNumbers>
                                        {metrics?.priceUsd === null || metrics?.priceUsd === undefined
                                          ? "—"
                                          : compactUsd(metrics.priceUsd)}
                                      </Text>
                                      {rowBestPrice && <Text type="supporting" color="accent">Best price</Text>}
                                    </VStack>
                                    <VStack gap={0}>
                                      <Text type="supporting" color="secondary">Liquidity</Text>
                                      <Text weight="semibold" hasTabularNumbers>
                                        {metrics ? compactUsd(metrics.liquidityUsd) : "—"}
                                      </Text>
                                      {bestLiquidity && <Text type="supporting" color="accent">Best liquidity</Text>}
                                    </VStack>
                                    <VStack gap={0}>
                                      <Text type="supporting" color="secondary">24h volume</Text>
                                      <Text weight="semibold" hasTabularNumbers>
                                        {metrics ? compactUsd(metrics.volume24hUsd) : "—"}
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
                </section>
              </VStack>
            </section>

            <Text type="supporting" color="secondary">
              {refreshedAt
                ? `${stock.symbol} provider metrics refreshed ${new Date(refreshedAt).toLocaleString()}. `
                : "Market data comes from the latest available snapshot and may have been observed at different times. "}
              Market data is informational and does not represent an executable quote.
            </Text>
            {refresh.error && (
              <Banner
                status="error"
                title="Refresh failed"
                description={`${refresh.error.message}. Existing market data has not changed.`}
              />
            )}
          </>
        )}
      </VStack>
    </section>
  );
}
