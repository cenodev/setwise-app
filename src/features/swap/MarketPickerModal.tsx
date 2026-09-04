import { useEffect, useMemo, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";

import { getRoutedSwapNetwork } from "../../config/chains";
import {
  routedMarketKey,
  type RoutedMarketOption,
} from "../../data/marketCatalog";
import type { Capabilities } from "../../data/swapRouter/schema";
import { truncateAddress } from "../../lib/format";
import { TokenIcon } from "../../components/TokenIdentity";
import { filterPickerMarkets, groupPickerMarkets, useIsNarrowViewport } from "./marketPickerModel";

function chainShortName(chainId: number): string {
  const name = getRoutedSwapNetwork(chainId)?.name ?? `Chain ${chainId}`;
  return name.replace(/ Chain$/, "");
}

function coveringProviders(
  capabilities: Capabilities | null,
  chainId: number,
): readonly { providerId: string; status: string }[] {
  if (!capabilities) return [];
  return capabilities.providers
    .filter((provider) => provider.enabled && provider.chains.includes(chainId))
    .map((provider) => ({ providerId: provider.providerId, status: provider.status }));
}

export function MarketPickerModal(input: {
  capabilities: Capabilities | null;
  eligibleMarkets: readonly RoutedMarketOption[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (market: RoutedMarketOption) => void;
  selectedMarket: RoutedMarketOption | null;
}) {
  const { capabilities, eligibleMarkets, isOpen, onOpenChange, onSelect, selectedMarket } = input;
  const [query, setQuery] = useState("");
  const [chainFilter, setChainFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  // Fixed footprint on desktop, fullscreen on phones; the results region below
  // keeps a constant height so filtering never resizes or recenters the dialog.
  const isFullscreen = useIsNarrowViewport();

  useEffect(() => {
    if (!isOpen) return;
    const reset = window.setTimeout(() => setQuery(""), 0);
    return () => window.clearTimeout(reset);
  }, [isOpen]);

  const chains = useMemo(() => {
    const ids = [...new Set(eligibleMarkets.map((market) => market.chainId))].sort((a, b) => a - b);
    return ids.map((chainId) => ({ chainId, name: chainShortName(chainId) }));
  }, [eligibleMarkets]);

  const providers = useMemo(() => {
    const byId = new Map<string, string>();
    for (const market of eligibleMarkets) {
      if (!byId.has(market.assetProvider.id)) byId.set(market.assetProvider.id, market.assetProvider.name);
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [eligibleMarkets]);

  const filtered = useMemo(
    () => filterPickerMarkets(eligibleMarkets, { chainId: chainFilter, providerId: providerFilter, query }),
    [chainFilter, eligibleMarkets, providerFilter, query],
  );

  const grouped = useMemo(() => groupPickerMarkets(filtered), [filtered]);

  const selectedKey = selectedMarket ? routedMarketKey(selectedMarket) : null;

  function clearFilters() {
    setQuery("");
    setChainFilter("all");
    setProviderFilter("all");
  }

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width={600}
      variant={isFullscreen ? "fullscreen" : "standard"}
    >
      <DialogHeader
        title="Choose a market"
        subtitle="Each issuer deployment is a distinct market; none are substituted."
        onOpenChange={onOpenChange}
      />
      <VStack gap={3}>
        <TextInput
          label="Search markets"
          value={query}
          onChange={setQuery}
          placeholder="Search by stock, token, issuer, or address…"
          hasClear
        />
        <VStack gap={1}>
          <Text type="label" weight="semibold">Network</Text>
          <HStack gap={1} wrap="wrap">
            <Button
              label="All networks"
              variant={chainFilter === "all" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setChainFilter("all")}
            />
            {chains.map((chain) => (
              <Button
                key={chain.chainId}
                label={chain.name}
                variant={chainFilter === String(chain.chainId) ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setChainFilter(String(chain.chainId))}
              />
            ))}
          </HStack>
        </VStack>
        <VStack gap={1}>
          <Text type="label" weight="semibold">Issuer</Text>
          <HStack gap={1} wrap="wrap">
            <Button
              label="All issuers"
              variant={providerFilter === "all" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setProviderFilter("all")}
            />
            {providers.map((provider) => (
              <Button
                key={provider.id}
                label={provider.name}
                variant={providerFilter === provider.id ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setProviderFilter(provider.id)}
              />
            ))}
          </HStack>
        </VStack>
        <HStack gap={2} vAlign="center">
          <Text type="supporting" color="secondary">
            {`${filtered.length} of ${eligibleMarkets.length} markets`}
          </Text>
          {capabilities === null && (
            <Text type="supporting" color="secondary">Route coverage loading…</Text>
          )}
        </HStack>
        <VStack gap={2} isScrollable height="46vh">
          {grouped.length === 0 ? (
          <VStack gap={2}>
            <EmptyState
              title="No markets match"
              description="Adjust the search or clear the network and issuer filters."
              headingLevel={3}
              isCompact
            />
            <Button label="Clear filters" variant="secondary" onClick={clearFilters} />
          </VStack>
        ) : (
          grouped.map((group) => (
            <VStack key={group.underlying} gap={1}>
              <HStack gap={2} vAlign="center">
                <TokenIcon
                  logoURI={group.markets[0]?.underlying.logoURI ?? group.markets[0]?.logoURI}
                  symbol={group.underlying}
                />
                <Text weight="bold">{group.underlying}</Text>
                <Text type="supporting" color="secondary">
                  {`${group.markets.length} market${group.markets.length === 1 ? "" : "s"}`}
                </Text>
              </HStack>
              <List density="compact" hasDividers>
                {group.markets.map((market) => {
                  const covering = coveringProviders(capabilities, market.chainId);
                  return (
                    <ListItem
                      key={routedMarketKey(market)}
                      label={`${market.symbol} · ${market.assetProvider.name}`}
                      description={`${chainShortName(market.chainId)} · ${truncateAddress(market.address)}${market.name !== market.symbol ? ` · ${market.name}` : ""}`}
                      startContent={(
                        <TokenIcon logoURI={market.logoURI ?? market.underlying.logoURI} symbol={market.symbol} />
                      )}
                      endContent={covering.length > 0 ? (
                        <HStack gap={1} wrap="wrap">
                          {covering.map((route) => (
                            <Badge
                              key={route.providerId}
                              label={route.status === "ready" ? route.providerId : `${route.providerId} · ${route.status}`}
                              variant={route.status === "ready" ? "neutral" : "warning"}
                            />
                          ))}
                        </HStack>
                      ) : undefined}
                      isSelected={selectedKey === routedMarketKey(market)}
                      onClick={() => {
                        onSelect(market);
                        onOpenChange(false);
                      }}
                    />
                  );
                })}
              </List>
            </VStack>
          ))
          )}
        </VStack>
      </VStack>
    </Dialog>
  );
}
