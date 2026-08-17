import { useQuery } from "@tanstack/react-query";
import { Badge } from "@astryxdesign/core/Badge";
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { proportional, Table, type TableColumn } from "@astryxdesign/core/Table";
import { Heading, Text } from "@astryxdesign/core/Text";
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
import { fetchAssetMetricsCatalog } from "../data/assetMetrics";
import { groupRwaAssets } from "../data/assets";
import { assetMetricsQueryKeys } from "../data/queryKeys";

interface DeploymentRow extends AssetDeploymentMetric, Record<string, unknown> {
  id: string;
}

const deploymentColumns: TableColumn<DeploymentRow>[] = [
  {
    key: "network",
    header: "Network",
    width: proportional(2),
    renderCell: ({ network }) => <NetworkIdentity network={network} />,
  },
  {
    key: "token",
    header: "Token",
    width: proportional(2),
    renderCell: ({ token }) => (
      <VStack gap={0}>
        <Text weight="bold">{token.symbol}</Text>
        <code className="asset-deployment-address">{token.address}</code>
      </VStack>
    ),
  },
  {
    key: "priceUsd",
    header: "DEX price",
    width: proportional(1),
    align: "end",
    renderCell: ({ metrics }) => metrics?.priceUsd === null || metrics?.priceUsd === undefined
      ? "—"
      : compactUsd(metrics.priceUsd),
  },
  {
    key: "liquidityUsd",
    header: "Liquidity",
    width: proportional(1),
    align: "end",
    renderCell: ({ metrics }) => metrics ? compactUsd(metrics.liquidityUsd) : "—",
  },
  {
    key: "volume24hUsd",
    header: "24h volume",
    width: proportional(1),
    align: "end",
    renderCell: ({ metrics }) => metrics ? compactUsd(metrics.volume24hUsd) : "—",
  },
  {
    key: "poolCount",
    header: "Pools",
    width: proportional(1),
    align: "end",
    renderCell: ({ metrics }) => metrics ? String(metrics.poolCount) : "—",
  },
  {
    key: "topVenue",
    header: "Top venue",
    width: proportional(1),
    renderCell: ({ metrics }) => metrics?.topVenue ?? "—",
  },
];

function metricValue(available: boolean, value: string): string {
  return available ? value : "—";
}

export function AssetDetailPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const catalog = useQuery({
    queryKey: assetMetricsQueryKeys.all,
    queryFn: ({ signal }) => fetchAssetMetricsCatalog(signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const assets = useMemo(() => groupRwaAssets(catalog.data?.tokens ?? []), [catalog.data?.tokens]);
  const asset = assets.find(({ id }) => id === assetId);
  const summary = useMemo(
    () => asset ? summarizeAssetMetrics(asset, catalog.data?.metrics) : undefined,
    [asset, catalog.data?.metrics],
  );
  const deployments = useMemo<DeploymentRow[]>(
    () => asset ? assetDeploymentMetrics(asset, catalog.data?.metrics)
      .filter(({ metrics }) => metrics !== undefined && metrics.liquidityUsd > 0)
      .map((deployment) => ({
        ...deployment,
        id: `${deployment.token.chainId}:${deployment.token.address.toLowerCase()}`,
      })) : [],
    [asset, catalog.data?.metrics],
  );

  return (
    <section className="screen assets-screen">
      <VStack gap={6}>
        <Breadcrumbs variant="supporting" label="Asset navigation">
          <BreadcrumbItem
            href={assetsPath()}
            onClick={(event) => {
              event.preventDefault();
              void navigate(assetsPath());
            }}
          >
            Assets
          </BreadcrumbItem>
          <BreadcrumbItem isCurrent>
            {asset ? asset.underlyingSymbol ?? asset.symbol : "Asset details"}
          </BreadcrumbItem>
        </Breadcrumbs>

        {catalog.isPending && <Card><Text>Loading asset metrics…</Text></Card>}

        {catalog.error && (
          <Card>
            <VStack gap={2}>
              <Heading level={2}>Asset metrics could not be loaded</Heading>
              <Text>{catalog.error.message}</Text>
            </VStack>
          </Card>
        )}

        {catalog.isSuccess && !asset && (
          <Card>
            <VStack gap={2}>
              <Heading level={2}>Asset not found</Heading>
              <Text>This asset is not present in the current Setwise token list.</Text>
            </VStack>
          </Card>
        )}

        {catalog.isSuccess && asset && summary && (
          <>
            <header className="screen-header">
              <HStack gap={4} vAlign="center" className="asset-detail-heading">
                <TokenIcon logoURI={asset.logoURI} symbol={asset.underlyingSymbol ?? asset.symbol} />
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">{asset.provider}</Text>
                  <Heading level={1}>{asset.underlyingSymbol ?? asset.symbol}</Heading>
                  <Text color="secondary">
                    {asset.name}{asset.assetType ? ` · ${asset.assetType}` : ""}
                  </Text>
                </VStack>
                <NetworkLogos networks={summary.networks} />
              </HStack>
            </header>

            <Grid columns={{ minWidth: 160, max: 5, repeat: "fit" }} gap={3}>
              <Card>
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">DEX price</Text>
                  <Text weight="bold">
                    {summary.priceUsd === null ? "—" : compactUsd(summary.priceUsd)}
                  </Text>
                </VStack>
              </Card>
              <Card>
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">Liquidity</Text>
                  <Text weight="bold">
                    {metricValue(summary.metricsAvailable, compactUsd(summary.liquidityUsd))}
                  </Text>
                </VStack>
              </Card>
              <Card>
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">24h volume</Text>
                  <Text weight="bold">
                    {metricValue(summary.metricsAvailable, compactUsd(summary.volume24hUsd))}
                  </Text>
                </VStack>
              </Card>
              <Card>
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">Pools</Text>
                  <Text weight="bold">
                    {metricValue(summary.metricsAvailable, String(summary.poolCount))}
                  </Text>
                </VStack>
              </Card>
              <Card>
                <VStack gap={2}>
                  <Text type="supporting" color="secondary">Top venue</Text>
                  <Badge label={summary.topVenue ?? "Unavailable"} variant="neutral" />
                </VStack>
              </Card>
            </Grid>

            <section aria-labelledby="deployment-metrics-title">
              <VStack gap={4}>
                <VStack gap={1}>
                  <Heading level={2} id="deployment-metrics-title">Network metrics</Heading>
                  <Text type="supporting" color="secondary">
                    DEX coverage for each token deployment in the Setwise token list.
                  </Text>
                </VStack>

                {deployments.length === 0 ? (
                  <Card>
                    <EmptyState
                      title="No liquid DEX markets"
                      description="Network metrics will appear when a trusted USD pool reports liquidity for this asset."
                      headingLevel={3}
                      isCompact
                    />
                  </Card>
                ) : (
                  <>
                    <section className="asset-table" aria-label="Asset network metrics table">
                      <Table<DeploymentRow>
                        data={deployments}
                        columns={deploymentColumns}
                        idKey="id"
                        density="balanced"
                        dividers="rows"
                        verticalAlign="top"
                        textOverflow="wrap"
                      />
                    </section>

                    <section className="asset-card-list" aria-label="Asset network metrics cards">
                      {deployments.map(({ id, metrics, network, token }) => (
                        <Card key={id}>
                          <VStack gap={4}>
                            <HStack gap={3} vAlign="center" className="asset-card-heading">
                              <NetworkIdentity network={network} />
                              <Badge label={metrics?.topVenue ?? "Unavailable"} variant="neutral" />
                            </HStack>
                            <VStack gap={0}>
                              <Text weight="bold">{token.symbol}</Text>
                              <code className="asset-deployment-address">{token.address}</code>
                            </VStack>
                            <Grid columns={{ minWidth: 120, max: 2, repeat: "fit" }} gap={3}>
                              <VStack gap={0}>
                                <Text type="supporting" color="secondary">Liquidity</Text>
                                <Text weight="bold">{metrics ? compactUsd(metrics.liquidityUsd) : "—"}</Text>
                              </VStack>
                              <VStack gap={0}>
                                <Text type="supporting" color="secondary">24h volume</Text>
                                <Text weight="bold">{metrics ? compactUsd(metrics.volume24hUsd) : "—"}</Text>
                              </VStack>
                              <VStack gap={0}>
                                <Text type="supporting" color="secondary">DEX price</Text>
                                <Text weight="bold">
                                  {metrics?.priceUsd === null || metrics?.priceUsd === undefined
                                    ? "—"
                                    : compactUsd(metrics.priceUsd)}
                                </Text>
                              </VStack>
                              <VStack gap={0}>
                                <Text type="supporting" color="secondary">Pools</Text>
                                <Text weight="bold">{metrics ? String(metrics.poolCount) : "—"}</Text>
                              </VStack>
                            </Grid>
                          </VStack>
                        </Card>
                      ))}
                    </section>
                  </>
                )}
              </VStack>
            </section>

            <Text type="supporting" color="secondary">
              Snapshot generated {new Date(catalog.data.generatedAt).toLocaleString()}. Metrics are informational and do not represent executable quotes.
            </Text>
          </>
        )}
      </VStack>
    </section>
  );
}
