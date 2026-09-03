import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAppKit } from "@reown/appkit/react";
import { isAddress } from "viem";
import { useAccount, usePublicClient, useSwitchChain } from "wagmi";

import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Text } from "@astryxdesign/core/Text";

import {
  readRoutedSwapMarketParam,
} from "../../app/routes";
import {
  getRoutedSwapNetwork,
  isRoutedSwapChainId,
  routedSwapNetworks,
  type RoutedSwapChainId,
} from "../../config/chains";
import { runtimeConfig } from "../../config/env";
import { erc20Abi } from "../../data/chain/abis";
import {
  createRoutedMarketCatalog,
  resolveRoutedMarket,
  UnavailableRoutedMarketError,
  type RoutedMarketCatalog,
  type RoutedMarketOption,
} from "../../data/marketCatalog";
import { getSourceAssets, type SourceAssetDeployment, type SourceAssetSymbol } from "../../config/sourceAssets";
import {
  getSwapRouterCapabilities,
  requestSwapQuotes,
  type SwapIntentInput,
} from "../../data/swapRouter/client";
import { swapRouterQueryKeys } from "../../data/queryKeys";
import type { SwapQuote } from "../../data/swapRouter/schema";
import { useTokenCatalog } from "../../data/tokens";
import { useOnlineStatus } from "../../lib/useOnlineStatus";
import { atomicToDecimal, decimalToAtomic, formatTokenAmount } from "../../lib/decimal";
import { truncateAddress } from "../../lib/format";
import {
  buildRoutedSwapIntent,
  describeRouteSteps,
  formatRoutedDuration,
  formatRoutedGasEstimate,
  formatRoutedOutput,
  isNoRouteError,
  isSameChainQuote,
  quoteFresh,
  quoteSecondsRemaining,
  routedAmountError,
  routedQuoteRequestKey,
  routedSwapErrorMessage,
  summarizeRoutedFees,
  type RoutedAssetResolver,
  type RoutedChainResolver,
} from "./routedModel";

type RoutedStage = "editing" | "review";

const QUOTE_DEBOUNCE_MS = 450;

function currentTimestamp() {
  return Date.now();
}

function chainName(chainId: number): string {
  return getRoutedSwapNetwork(chainId)?.name ?? `Chain ${chainId}`;
}

function marketLabel(market: RoutedMarketOption): string {
  return `${market.assetProvider.name} · ${chainName(market.chainId)}`;
}

function marketOptionId(market: RoutedMarketOption): string {
  return `${market.chainId}:${market.address.toLowerCase()}`;
}

function WalletConnectCard() {
  const { open } = useAppKit();
  return (
    <section className="gate-card" aria-labelledby="routed-wallet-connect-title">
      <p className="eyebrow">External wallet</p>
      <h2 id="routed-wallet-connect-title">Connect your wallet to route a swap</h2>
      <p>Route quotes are requested for your wallet address. Setwise will never ask for your seed phrase or private key.</p>
      <button className="primary-button" type="button" onClick={() => void open({ view: "Connect" })}>
        Connect wallet
      </button>
    </section>
  );
}

function WalletConfigCard() {
  return (
    <section className="gate-card" aria-labelledby="routed-wallet-config-title">
      <p className="eyebrow">Configuration required</p>
      <h2 id="routed-wallet-config-title">Add a Reown project ID</h2>
      <p>
        Copy <code>.env.example</code> to <code>.env.local</code>, set
        <code> VITE_REOWN_PROJECT_ID</code>, and restart the development server.
      </p>
      <p className="gate-help">After wallet setup, use the <Link to="/faucet">testnet asset faucet</Link> to fund a new wallet.</p>
    </section>
  );
}

export function RoutedSwapPage() {
  const { address, chainId: walletChainId } = useAccount();
  const { switchChain, isPending: switchPending } = useSwitchChain();
  const online = useOnlineStatus();
  const tokenCatalogQuery = useTokenCatalog();
  const [searchParams, setSearchParams] = useSearchParams();

  const marketCatalog = useMemo<RoutedMarketCatalog>(
    () => createRoutedMarketCatalog(tokenCatalogQuery.data ?? []),
    [tokenCatalogQuery.data],
  );

  const capabilitiesQuery = useQuery({
    queryKey: swapRouterQueryKeys.capabilities(),
    queryFn: ({ signal }) => getSwapRouterCapabilities(signal),
    staleTime: 60_000,
    retry: 1,
  });
  const capabilities = capabilitiesQuery.data ?? null;

  // ——— Draft state ———————————————————————————————————————————————
  // The source chain follows the connected wallet until the user picks one.
  const [chosenSourceChainId, setChosenSourceChainId] = useState<RoutedSwapChainId | null>(null);
  const [sourceSymbolChoice, setSourceSymbolChoice] = useState<SourceAssetSymbol>("USDC");
  const [amount, setAmount] = useState("");
  // The destination market is chain-qualified in the URL; without a link the
  // first eligible market of the chosen (or first) underlying is selected.
  const [underlyingChoice, setUnderlyingChoice] = useState<string | null>(null);

  const [quotes, setQuotes] = useState<SwapQuote[] | null>(null);
  const [quotesRequestKey, setQuotesRequestKey] = useState("");
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const [stage, setStage] = useState<RoutedStage>("editing");
  const [now, setNow] = useState(currentTimestamp);
  const quoteSequence = useRef(0);

  // ——— Capability gates ——————————————————————————————————————————
  const chainEnabledByRouter = useCallback((candidate: number) => {
    if (!capabilities) return true;
    return capabilities.chains.find((chain) => chain.chainId === candidate)?.enabled !== false;
  }, [capabilities]);
  const crossChainAllowed = capabilities?.features.crossChainSwaps !== false;

  const sourceChainOptions = useMemo(() => (
    routedSwapNetworks.map((network) => ({
      network,
      hasSourceAssets: getSourceAssets(network.id).length > 0,
      enabled: chainEnabledByRouter(network.id),
    }))
  ), [chainEnabledByRouter]);

  const sourceChainId = useMemo<RoutedSwapChainId>(() => {
    if (chosenSourceChainId !== null) return chosenSourceChainId;
    if (walletChainId !== undefined && isRoutedSwapChainId(walletChainId) && getSourceAssets(walletChainId).length > 0) {
      return walletChainId;
    }
    return 1;
  }, [chosenSourceChainId, walletChainId]);

  const sourceAsset = useMemo<SourceAssetDeployment | null>(() => {
    const assets = getSourceAssets(sourceChainId);
    return assets.find((asset) => asset.symbol === sourceSymbolChoice) ?? assets[0] ?? null;
  }, [sourceChainId, sourceSymbolChoice]);

  // ——— Destination preselection and defaulting (derived, never guessed) ——
  const marketParam = useMemo(() => readRoutedSwapMarketParam(searchParams), [searchParams]);
  const eligibleMarkets = useMemo(() => (
    marketCatalog.markets.filter((market) => (
      chainEnabledByRouter(market.chainId)
      && (crossChainAllowed || market.chainId === sourceChainId)
    ))
  ), [chainEnabledByRouter, crossChainAllowed, marketCatalog, sourceChainId]);

  /**
   * undefined while the token catalog loads, null when a deep-linked market is
   * unavailable (an explicit error state, never a substitution), and the
   * resolved market when the preselection exists.
   */
  const preselectedMarket = useMemo<RoutedMarketOption | null | undefined>(() => {
    if (!marketParam) return undefined;
    if (tokenCatalogQuery.isPending) return undefined;
    try {
      return resolveRoutedMarket(marketCatalog, marketParam.chainId, marketParam.address);
    } catch (error) {
      if (error instanceof UnavailableRoutedMarketError) return null;
      return undefined;
    }
  }, [marketCatalog, marketParam, tokenCatalogQuery.isPending]);

  const defaultMarket = useMemo(() => (
    eligibleMarkets.find((market) => (
      underlyingChoice === null || market.underlying.symbol === underlyingChoice
    )) ?? null
  ), [eligibleMarkets, underlyingChoice]);

  const selectedMarket = preselectedMarket === undefined ? defaultMarket : preselectedMarket;
  const underlying = selectedMarket?.underlying.symbol ?? underlyingChoice ?? "";

  // ——— Chain reads ——————————————————————————————————————————————
  const sourceClient = usePublicClient({ chainId: sourceChainId });
  const balanceQuery = useQuery({
    queryKey: ["routed-swap-source-balance", sourceChainId, address?.toLowerCase(), sourceAsset?.address.toLowerCase()],
    enabled: Boolean(address && sourceClient && sourceAsset && isAddress(address)),
    queryFn: async () => {
      if (!sourceClient || !address || !sourceAsset) throw new Error("Wallet, chain client, and source asset are required");
      return await sourceClient.readContract({
        address: sourceAsset.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });
    },
    refetchInterval: 15_000,
  });

  const destinationClient = usePublicClient({ chainId: selectedMarket?.chainId });
  const marketDecimalsQuery = useQuery({
    queryKey: ["routed-swap-market-decimals", selectedMarket?.chainId, selectedMarket?.address.toLowerCase()],
    enabled: Boolean(destinationClient && selectedMarket),
    queryFn: async () => {
      if (!destinationClient || !selectedMarket) throw new Error("Destination market is required");
      return await destinationClient.readContract({
        address: selectedMarket.address,
        abi: erc20Abi,
        functionName: "decimals",
      });
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60_000,
  });

  // ——— Quote request discipline ——————————————————————————————————
  const amountError = sourceAsset ? routedAmountError(amount, sourceAsset) : "Choose a source stablecoin";
  const amountAtomic = amountError || !sourceAsset ? 0n : decimalToAtomic(amount, sourceAsset.decimals);
  const recipientValid = Boolean(address && isAddress(address));
  const routeAllowed = selectedMarket
    ? selectedMarket.chainId === sourceChainId || crossChainAllowed
    : false;
  const draft = useMemo(() => (
    sourceAsset && selectedMarket && recipientValid && amountAtomic > 0n && !amountError && routeAllowed
      ? {
          amountAtomic,
          destinationMarket: selectedMarket,
          recipient: address as `0x${string}`,
          sourceAsset,
        }
      : null
  ), [address, amountAtomic, amountError, recipientValid, routeAllowed, selectedMarket, sourceAsset]);
  const currentRequestKey = draft ? routedQuoteRequestKey(draft) : "";
  const quotesMatchDraft = quotes !== null && currentRequestKey !== "" && quotesRequestKey === currentRequestKey;
  const selectedQuote = useMemo(() => (
    quotes?.find((quote) => quote.quoteId === selectedQuoteId) ?? null
  ), [quotes, selectedQuoteId]);

  useEffect(() => {
    const sequence = ++quoteSequence.current;
    if (!online || !draft) {
      const reset = window.setTimeout(() => {
        setQuoteLoading(false);
        setQuotes(null);
        setQuotesRequestKey("");
        setSelectedQuoteId(null);
      }, 0);
      return () => window.clearTimeout(reset);
    }
    const controller = new AbortController();
    const requestedKey = currentRequestKey;
    const loadingTimer = window.setTimeout(() => {
      setQuoteLoading(true);
      setQuoteError(null);
    }, 0);
    const requestTimer = window.setTimeout(() => {
      const intent: SwapIntentInput = buildRoutedSwapIntent(draft);
      void requestSwapQuotes({ intent, signal: controller.signal }).then((nextQuotes) => {
        if (sequence !== quoteSequence.current || controller.signal.aborted) return;
        setQuotes(nextQuotes);
        setQuotesRequestKey(requestedKey);
        setSelectedQuoteId(nextQuotes[0]?.quoteId ?? null);
        if (nextQuotes.length > 0) {
          const earliest = Math.min(...nextQuotes.map((quote) => Date.parse(quote.expiresAt)));
          window.setTimeout(() => setQuoteRefresh((value) => value + 1), Math.max(earliest - Date.now(), 0) + 20);
        }
      }).catch((error: unknown) => {
        if (controller.signal.aborted || sequence !== quoteSequence.current) return;
        if (isNoRouteError(error)) {
          setQuotes([]);
          setQuotesRequestKey(requestedKey);
          return;
        }
        setQuoteError(routedSwapErrorMessage(error));
      }).finally(() => {
        if (!controller.signal.aborted && sequence === quoteSequence.current) setQuoteLoading(false);
      });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(loadingTimer);
      window.clearTimeout(requestTimer);
    };
  }, [currentRequestKey, draft, online, quoteRefresh]);

  useEffect(() => {
    if (!quotes || quotes.length === 0) return;
    const timer = window.setInterval(() => setNow(currentTimestamp()), 1_000);
    return () => window.clearInterval(timer);
  }, [quotes]);

  const clearExecutable = useCallback(() => {
    if (stage !== "review") return;
    setStage("editing");
  }, [stage]);

  // ——— Draft editing ————————————————————————————————————————————
  function chooseSourceChain(next: string) {
    const nextChainId = Number(next);
    if (!isRoutedSwapChainId(nextChainId)) return;
    setChosenSourceChainId(nextChainId);
    clearExecutable();
  }

  function chooseSourceSymbol(next: string) {
    if (next !== "USDC" && next !== "USDT") return;
    setSourceSymbolChoice(next);
    clearExecutable();
  }

  function chooseUnderlying(next: string) {
    const firstMarket = eligibleMarkets.find((market) => market.underlying.symbol === next) ?? null;
    setUnderlyingChoice(next);
    if (firstMarket) {
      setSearchParams({ chain: String(firstMarket.chainId), token: firstMarket.address }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
    clearExecutable();
  }

  function chooseMarket(market: RoutedMarketOption) {
    setUnderlyingChoice(market.underlying.symbol);
    setSearchParams({ chain: String(market.chainId), token: market.address }, { replace: true });
    clearExecutable();
  }

  function chooseQuote(quoteId: string) {
    setSelectedQuoteId(quoteId);
    clearExecutable();
  }

  function editAmount(next: string) {
    if (!/^\d*\.?\d*$/.test(next)) return;
    setAmount(next);
    clearExecutable();
  }

  // ——— Review gating ————————————————————————————————————————————
  const walletOnSourceChain = walletChainId === sourceChainId;
  const balance = balanceQuery.data;
  const balanceKnown = balance !== undefined;
  const insufficientBalance = balanceKnown && balance < amountAtomic;
  const selectedQuoteIsFresh = Boolean(selectedQuote && quoteFresh(selectedQuote, now));
  const canReview = Boolean(
    address
    && walletOnSourceChain
    && online
    && selectedQuote
    && quotesMatchDraft
    && selectedQuoteIsFresh
    && !quoteLoading
    && !amountError
    && amountAtomic > 0n
    && !insufficientBalance
    && balanceKnown,
  );
  const reviewBlockedReason = !address
    ? null
    : !walletOnSourceChain
      ? `Switch your wallet to ${chainName(sourceChainId)} to review this route`
      : !balanceKnown
        ? "Checking your stablecoin balance"
        : insufficientBalance
          ? "Insufficient stablecoin balance for this route"
          : !quotesMatchDraft || quoteLoading
            ? "Refreshing route estimates"
            : selectedQuote && !selectedQuoteIsFresh
              ? "The selected estimate expired and is refreshing"
              : amountError ?? null;

  // ——— Quote display resolvers ——————————————————————————————————
  const resolveAsset = useCallback<RoutedAssetResolver>((asset) => {
    if (sourceAsset && asset.chainId === sourceAsset.chainId
      && asset.address.toLowerCase() === sourceAsset.address.toLowerCase()) {
      return { decimals: sourceAsset.decimals, symbol: sourceAsset.symbol };
    }
    if (selectedMarket && asset.chainId === selectedMarket.chainId
      && asset.address.toLowerCase() === selectedMarket.address.toLowerCase()) {
      const decimals = marketDecimalsQuery.data;
      if (decimals !== undefined) return { decimals, symbol: selectedMarket.symbol };
    }
    const native = capabilities?.chains.find((chain) => chain.chainId === asset.chainId)?.nativeAsset;
    if (native && native.address.toLowerCase() === asset.address.toLowerCase()) {
      return { decimals: native.decimals, symbol: native.symbol };
    }
    return undefined;
  }, [capabilities, marketDecimalsQuery.data, selectedMarket, sourceAsset]);

  const resolveChain = useCallback<RoutedChainResolver>((candidate) => {
    const capabilityName = capabilities?.chains.find((chain) => chain.chainId === candidate)?.name;
    return capabilityName ?? chainName(candidate);
  }, [capabilities]);

  // ——— Derived display data —————————————————————————————————————
  const sameChainAsDestination = selectedMarket?.chainId === sourceChainId;
  const degradedProviders = (capabilities?.providers ?? []).filter(
    (provider) => provider.enabled && provider.status !== "ready",
  );
  const destinationDecimals = marketDecimalsQuery.data;
  const secondsRemaining = selectedQuote ? quoteSecondsRemaining(selectedQuote, now) : null;

  if (!runtimeConfig.walletConfigured) {
    return <WalletConfigCard />;
  }
  if (!address) {
    return <WalletConnectCard />;
  }

  if (preselectedMarket === null && marketParam) {
    return (
      <section className="swap-card" role="alert">
        <VStack gap={3}>
          <Text weight="bold">This market is not available for routed swaps</Text>
          <Text type="supporting" color="secondary">
            {`The linked deployment ${truncateAddress(marketParam.address)} on ${chainName(marketParam.chainId)} is not in
            the current Setwise market catalog. No other issuer market was selected in its place.`}
          </Text>
          <HStack gap={2}>
            <Button
              label="Choose another market"
              variant="secondary"
              onClick={() => setSearchParams({}, { replace: true })}
            />
          </HStack>
        </VStack>
      </section>
    );
  }

  return (
    <div className="swap-layout routed-swap-layout">
      <section className="swap-card swap-form" aria-labelledby="routed-swap-title">
        <h2 id="routed-swap-title" className="sr-only">Route a stablecoin swap</h2>

        <div className="field-group">
          <span className="field-label" id="routed-source-chain-label">Pay from</span>
          <SegmentedControl
            label="Source chain"
            value={String(sourceChainId)}
            onChange={chooseSourceChain}
            layout="fill"
          >
            {sourceChainOptions.map(({ enabled, hasSourceAssets, network }) => (
              <SegmentedControlItem
                key={network.id}
                value={String(network.id)}
                label={network.name}
                isDisabled={!hasSourceAssets || !enabled}
              />
            ))}
          </SegmentedControl>
          <Text type="supporting" color="secondary">
            Canonical stablecoins only. Wallet execution always happens on the source chain.
          </Text>
        </div>

        {sourceAsset && (
          <div className="field-group">
            <span className="field-label" id="routed-stablecoin-label">Stablecoin</span>
            <SegmentedControl
              label="Source stablecoin"
              value={sourceAsset.symbol}
              onChange={chooseSourceSymbol}
              layout="fill"
            >
              {getSourceAssets(sourceChainId).map((asset) => (
                <SegmentedControlItem key={asset.symbol} value={asset.symbol} label={asset.symbol} />
              ))}
            </SegmentedControl>
          </div>
        )}

        {sourceAsset && (
          <div className="asset-input-card">
            <div className="amount-heading">
              <span>You pay</span>
              <span>
                Balance{" "}
                {balanceKnown
                  ? `${formatTokenAmount(balance, sourceAsset.decimals)} ${sourceAsset.symbol}`
                  : sourceAsset.symbol}
              </span>
            </div>
            <div className="amount-control">
              <input
                aria-label="You pay amount"
                inputMode="decimal"
                placeholder="0.0"
                value={amount}
                onChange={(event) => editAmount(event.target.value)}
              />
              <button
                type="button"
                disabled={!balanceKnown || balance === 0n}
                onClick={() => editAmount(atomicToDecimal(balance ?? 0n, sourceAsset.decimals))}
              >
                Max
              </button>
            </div>
            {amount && amountError && <p className="field-error">{amountError}</p>}
            {insufficientBalance && (
              <p className="field-error">Insufficient {sourceAsset.symbol} balance for this route.</p>
            )}
          </div>
        )}

        <div className="field-group">
          <span className="field-label">Receive</span>
          <Selector
            label="Stock"
            options={marketCatalog.underlyings
              .filter((symbol) => marketCatalog.marketsForUnderlying(symbol).length > 0)
              .map((symbol) => ({ value: symbol, label: symbol }))}
            value={underlying}
            onChange={chooseUnderlying}
            placeholder="Choose a stock"
          />
          <Selector
            label="Issuer market"
            description="Each issuer deployment is a distinct market; none are substituted."
            options={eligibleMarkets.map((market) => ({
              value: marketOptionId(market),
              label: marketLabel(market),
            }))}
            value={selectedMarket ? marketOptionId(selectedMarket) : ""}
            onChange={(value) => {
              const market = eligibleMarkets.find((candidate) => marketOptionId(candidate) === value);
              if (market) chooseMarket(market);
            }}
            placeholder="Choose an issuer market"
          />
          {selectedMarket && (
            <Text type="supporting" color="secondary" className="routed-market-address">
              {`${selectedMarket.assetProvider.name} · ${selectedMarket.symbol} · ${truncateAddress(selectedMarket.address)} on ${chainName(selectedMarket.chainId)}`}
            </Text>
          )}
        </div>

        {selectedMarket && !sameChainAsDestination && (
          <div className="notice" role="note">
            Cross-chain route: your wallet signs only on {chainName(sourceChainId)}; the route delivers{" "}
            {selectedMarket.underlying.symbol} on {chainName(selectedMarket.chainId)}.
          </div>
        )}
        {selectedMarket && sameChainAsDestination && (
          <div className="notice" role="note">
            Same-chain route: your wallet transacts only on {chainName(sourceChainId)}.
          </div>
        )}
        {!online && <div className="warning-panel">Offline — reconnect to request route quotes.</div>}
      </section>

      <aside className="swap-card quote-card" aria-live="polite">
        <div className="quote-title">
          <h2>Route comparison</h2>
          {quoteLoading && <span>Refreshing</span>}
        </div>

        {capabilitiesQuery.error && (
          <Banner
            status="warning"
            title="Router capabilities unavailable"
            description={`${routedSwapErrorMessage(capabilitiesQuery.error)} Chain and provider gating is relaxed until capabilities load.`}
          />
        )}
        {capabilitiesQuery.isSuccess && degradedProviders.length > 0 && (
          <Banner
            status="warning"
            title="Partial provider coverage"
            description={`${degradedProviders.map((provider) => provider.providerId).join(", ")} ${degradedProviders.length === 1 ? "is" : "are"} ${degradedProviders.map((provider) => provider.status).join("/")}. Quotes may be incomplete.`}
          />
        )}

        {quoteError && (
          <div className="error-panel" role="alert">
            <span>{quoteError}</span>
            <button className="inline-action" type="button" disabled={!online}
              onClick={() => setQuoteRefresh((value) => value + 1)}>Retry pricing</button>
          </div>
        )}

        {!draft && !quoteLoading && !quoteError && (
          <Text type="supporting" color="secondary">
            Choose a source chain, stablecoin, amount, and destination market to compare executable routes.
          </Text>
        )}

        {quoteLoading && (quotes === null || !quotesMatchDraft) && (
          <>
            <Text type="supporting" color="secondary">Requesting route quotes…</Text>
            <VStack gap={2}>
              <Skeleton height={44} index={0} />
              <Skeleton height={44} index={1} />
              <Skeleton height={44} index={2} />
            </VStack>
          </>
        )}

        {quotesMatchDraft && quotes !== null && quotes.length === 0 && !quoteLoading && (
          <>
            <EmptyState
              title="No route available"
              description="No provider currently supports this source, stablecoin, and destination market combination. Try another chain or market."
              headingLevel={3}
              isCompact
            />
            <Button
              label="Retry pricing"
              variant="secondary"
              isDisabled={!online}
              onClick={() => setQuoteRefresh((value) => value + 1)}
            />
          </>
        )}

        {quotesMatchDraft && quotes !== null && quotes.length > 0 && selectedQuote && (
          <>
            <List
              header={<Text className="sr-only">Ranked route alternatives, best guaranteed output first</Text>}
              density="spacious"
              hasDividers
            >
              {quotes.map((quote, index) => {
                const outputDecimals = destinationDecimals;
                return (
                  <ListItem
                    key={quote.quoteId}
                    label={`${quote.providerId}`}
                    isSelected={quote.quoteId === selectedQuoteId}
                    onClick={() => chooseQuote(quote.quoteId)}
                    startContent={index === 0 ? <Badge label="Best" variant="info" /> : undefined}
                    endContent={(
                      <VStack gap={0} hAlign="end">
                        <Text weight="bold" hasTabularNumbers>
                          {outputDecimals === undefined
                            ? "—"
                            : `${formatRoutedOutput(quote.amountOut, outputDecimals)} ${selectedMarket?.symbol ?? ""}`}
                        </Text>
                        <Text type="supporting" color="secondary">
                          {isSameChainQuote(quote) ? "Same chain" : "Cross-chain"}
                        </Text>
                      </VStack>
                    )}
                    description={(
                      <Grid columns={{ minWidth: 104, max: 4, repeat: "fit" }} gap={2}>
                        <VStack gap={0}>
                          <Text type="supporting" color="secondary">Guaranteed minimum</Text>
                          <Text weight="semibold" hasTabularNumbers>
                            {outputDecimals === undefined
                              ? `${quote.minAmountOut} base units`
                              : formatRoutedOutput(quote.minAmountOut, outputDecimals)}
                          </Text>
                        </VStack>
                        <VStack gap={0}>
                          <Text type="supporting" color="secondary">Fees</Text>
                          <Text weight="semibold">{summarizeRoutedFees(quote.fees, resolveAsset).join(" + ") || "None shown"}</Text>
                        </VStack>
                        <VStack gap={0}>
                          <Text type="supporting" color="secondary">Origin gas</Text>
                          <Text weight="semibold">{formatRoutedGasEstimate(quote.estimatedGas)}</Text>
                        </VStack>
                        <VStack gap={0}>
                          <Text type="supporting" color="secondary">Duration</Text>
                          <Text weight="semibold">{formatRoutedDuration(quote.estimatedDurationSeconds)}</Text>
                        </VStack>
                      </Grid>
                    )}
                  />
                );
              })}
            </List>

            {stage === "review" && selectedQuote && (
              <div className="review-panel routed-review" role="status" aria-label="Routed swap review">
                <VStack gap={3}>
                  <HStack gap={2} vAlign="center" className="routed-review-heading">
                    <Text weight="bold">Review route via {selectedQuote.providerId}</Text>
                    <Button label="Edit" variant="ghost" size="sm" onClick={() => setStage("editing")} />
                  </HStack>
                  <MetadataList columns="multi" label={{ position: "top" }}>
                    <MetadataListItem label="You pay">
                      {amountAtomic > 0n && sourceAsset
                        ? `${atomicToDecimal(amountAtomic, sourceAsset.decimals)} ${sourceAsset.symbol}`
                        : "—"}
                      {" on "}
                      {chainName(sourceChainId)}
                      {" · "}
                      {sourceAsset ? truncateAddress(sourceAsset.address) : ""}
                    </MetadataListItem>
                    <MetadataListItem label="Guaranteed minimum received">
                      {destinationDecimals === undefined
                        ? `${selectedQuote.minAmountOut} base units`
                        : `${formatRoutedOutput(selectedQuote.minAmountOut, destinationDecimals)} ${selectedMarket?.symbol ?? ""}`}
                      {" on "}
                      {chainName(selectedQuote.intent.destinationAsset.chainId)}
                    </MetadataListItem>
                    <MetadataListItem label="Expected received">
                      {destinationDecimals === undefined
                        ? `${selectedQuote.amountOut} base units`
                        : `${formatRoutedOutput(selectedQuote.amountOut, destinationDecimals)} ${selectedMarket?.symbol ?? ""}`}
                    </MetadataListItem>
                    <MetadataListItem label="Destination token contract">
                      {truncateAddress(selectedQuote.intent.destinationAsset.address)} on{" "}
                      {chainName(selectedQuote.intent.destinationAsset.chainId)}
                    </MetadataListItem>
                    <MetadataListItem label="Route steps">
                      {describeRouteSteps(selectedQuote.steps, resolveAsset, resolveChain).join("; ")}
                    </MetadataListItem>
                    <MetadataListItem label="Fees">
                      {summarizeRoutedFees(selectedQuote.fees, resolveAsset).join(" + ") || "None shown"}
                    </MetadataListItem>
                    <MetadataListItem label="Estimated origin gas">
                      {formatRoutedGasEstimate(selectedQuote.estimatedGas)}
                    </MetadataListItem>
                    <MetadataListItem label="Estimated duration">
                      {formatRoutedDuration(selectedQuote.estimatedDurationSeconds)}
                    </MetadataListItem>
                    <MetadataListItem label="Quote freshness">
                      {selectedQuoteIsFresh
                        ? `Fresh for ${secondsRemaining ?? 0}s · expires ${new Date(selectedQuote.expiresAt).toLocaleTimeString()}`
                        : "Expired — refresh the estimates"}
                    </MetadataListItem>
                    <MetadataListItem label="Slippage bound">
                      {selectedQuote.intent.slippageBps} bps guaranteed minimum
                    </MetadataListItem>
                  </MetadataList>
                  {isSameChainQuote(selectedQuote) ? (
                    <Text type="supporting" color="secondary">
                      Same-chain route: your wallet transacts only on {chainName(sourceChainId)}.
                    </Text>
                  ) : (
                    <Text type="supporting" color="secondary">
                      Cross-chain route: your wallet transacts only on {chainName(sourceChainId)}; delivery on{" "}
                      {chainName(selectedQuote.intent.destinationAsset.chainId)} is handled by the route.
                    </Text>
                  )}
                  <Text type="supporting" color="secondary">
                    Approving the route spender and submitting the swap arrive in a follow-up release. This review is
                    not executable yet.
                  </Text>
                </VStack>
              </div>
            )}

            {stage === "review" && selectedQuote && !selectedQuoteIsFresh && (
              <div className="warning-panel" role="alert">
                <span>The reviewed quote expired. Refresh the estimates and review again.</span>
                <button className="inline-action" type="button" disabled={!online}
                  onClick={() => setQuoteRefresh((value) => value + 1)}>Refresh</button>
              </div>
            )}

            {stage === "editing" && (
              <Button
                label="Review route"
                variant="primary"
                isDisabled={!canReview}
                onClick={() => setStage("review")}
              />
            )}
            {stage === "editing" && reviewBlockedReason && (
              <p className="action-reason">{reviewBlockedReason}</p>
            )}
            {!walletOnSourceChain && (
              <div className="warning-panel">
                <span>Your wallet is on {walletChainId ? chainName(walletChainId) : "an unknown network"}; review
                  requires {chainName(sourceChainId)}.</span>
                <button
                  className="inline-action"
                  type="button"
                  disabled={switchPending}
                  onClick={() => switchChain({ chainId: sourceChainId })}
                >
                  {switchPending ? "Switching…" : `Switch to ${chainName(sourceChainId)}`}
                </button>
              </div>
            )}
          </>
        )}

        <p className="quote-note">
          Quotes are point-in-time estimates bound to the exact chains and contracts shown. Ranked by guaranteed minimum
          output first.
        </p>
      </aside>
    </div>
  );
}
