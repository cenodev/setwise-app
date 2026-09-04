import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAppKit } from "@reown/appkit/react";
import { isAddress, type Address, type Hash } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain, useWriteContract } from "wagmi";

import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Section } from "@astryxdesign/core/Section";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TokenIcon } from "../../components/TokenIdentity";
import { MarketPickerModal } from "./MarketPickerModal";

import {
  readRoutedSwapMarketParam,
} from "../../app/routes";
import {
  getRoutedSwapNetwork,
  isRoutedSwapChainId,
  routedSwapNetworks,
  type RoutedSwapChainId,
} from "../../config/chains";
import { explorerTxUrl } from "../../config/explorers";
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
  createSwapActivity,
  markRoutedSwapLifecycle,
  saveActivity,
} from "../activity/store";
import {
  getSwapRouterCapabilities,
  prepareRoutedSwap,
  requestSwapExecutionStatus,
  requestSwapQuotesWithDiagnostics,
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
  providerFailureNotes,
  quoteErrorProviderNotes,
  quoteFresh,
  quoteSecondsRemaining,
  routedAmountError,
  routedQuoteRequestKey,
  routedSwapErrorMessage,
  summarizeRoutedFees,
  type ProviderFailureNote,
  type RoutedAssetResolver,
  type RoutedChainResolver,
} from "./routedModel";
import {
  assertRoutedExecutionWindow,
  buildRoutedSubmission,
  isWalletRejection,
  lifecycleForExecutionStage,
  mapExecutionStatus,
  revalidateReviewedQuote,
  routedExecutionBusy,
  routedExecutionErrorMessage,
  routedRecoveryGuidance,
  routedSimulationErrorMessage,
  type RoutedExecutionStage,
} from "./routedExecution";

type RoutedStage = "editing" | "review";

type RoutedExecutionView = {
  approvalHash?: Hash;
  destinationHash?: Hash;
  error?: string;
  sourceHash?: Hash;
  stage: RoutedExecutionStage;
};

const QUOTE_DEBOUNCE_MS = 450;
const SETTLEMENT_POLL_INTERVAL_MS = 12_000;
const CHAIN_SWITCH_TIMEOUT_MS = 15_000;

function currentTimestamp() {
  return Date.now();
}

function chainName(chainId: number): string {
  return getRoutedSwapNetwork(chainId)?.name ?? `Chain ${chainId}`;
}

function executionStageTitle(stage: RoutedExecutionStage): string {
  switch (stage) {
    case "revalidating": return "Revalidating the reviewed route";
    case "switching": return "Switching your wallet to the source chain";
    case "checking": return "Rechecking balances and route state";
    case "approval-wallet": return "Approve the exact input amount in your wallet";
    case "approval-confirming": return "Confirming the exact approval on chain";
    case "simulating": return "Simulating the route before wallet submission";
    case "wallet": return "Confirm the source transaction in your wallet";
    case "confirming": return "Confirming the source transaction on chain";
    case "tracking": return "Tracking destination settlement";
    case "delivered": return "Route delivered";
    case "partially-delivered": return "Route partially delivered";
    case "refunded": return "Route refunded";
    case "failed": return "Route failed";
    case "unknown": return "Settlement status unknown";
    case "rejected": return "Rejected in wallet";
    case "approval-failed": return "Approval failed";
    case "expired": return "The reviewed quote expired";
    case "stale": return "The reviewed route changed";
    case "error": return "Execution failed";
  }
}

function executionStageMessage(stage: RoutedExecutionStage): string | null {
  switch (stage) {
    case "revalidating": return "Re-requesting the reviewed route and verifying the exact quote before any wallet request opens.";
    case "switching": return "Aligning your wallet with the route source chain. Approve the network switch in your wallet.";
    case "checking": return "Rechecking balances, gas, and route state before any approval is requested.";
    case "approval-wallet": return "The exact input amount is approved to the verified route spender. Nothing else is approved.";
    case "approval-confirming": return "Waiting for the exact approval to confirm on chain.";
    case "simulating": return "Simulating the prepared transaction against the source chain before your wallet opens.";
    case "wallet": return "One transaction on the source chain, signed only by your wallet. Setwise never custodies keys or broadcasts for you.";
    case "confirming": return "Waiting for the source transaction to confirm before settlement tracking starts.";
    case "tracking": return "The source transaction confirmed. Polling the route provider for destination settlement.";
    case "delivered": return "Both legs are complete. Verify the evidence below in the chain explorers.";
    case "partially-delivered": return "The route delivered only part of the expected output. Review the provider detail before retrying.";
    case "refunded": return "The route failed after submission and the input was refunded. Verify the refund before retrying.";
    case "failed": return "The route failed on chain and no destination tokens were delivered. Review the source transaction before retrying.";
    case "unknown": return "The provider could not confirm settlement. Verify the source transaction; tracking continues automatically.";
    case "rejected": return "Rejected in your wallet. Nothing was submitted; review the route and try again.";
    case "approval-failed": return "Token approval was rejected or failed. No swap was submitted.";
    case "expired": return "The reviewed quote expired before the wallet opened. Refresh the estimates and review again.";
    case "stale": return "The reviewed route changed while revalidating. Review the refreshed quotes again.";
    case "error": return "Execution failed before submission. Review the message and try again.";
    default: return null;
  }
}

const EXECUTION_ORDER: readonly RoutedExecutionStage[] = [
  "revalidating",
  "switching",
  "checking",
  "approval-wallet",
  "approval-confirming",
  "simulating",
  "wallet",
  "confirming",
  "tracking",
];

function executionProgress(stage: RoutedExecutionStage): number {
  const index = EXECUTION_ORDER.indexOf(stage);
  if (index >= 0) return Math.round(((index + 1) / (EXECUTION_ORDER.length + 1)) * 100);
  if (stage === "delivered") return 100;
  if (stage === "partially-delivered" || stage === "refunded" || stage === "failed" || stage === "unknown") return 100;
  return 0;
}

function executionStatusVariant(stage: RoutedExecutionStage): "success" | "warning" | "error" | "accent" | "neutral" {
  switch (stage) {
    case "delivered": return "success";
    case "partially-delivered":
    case "refunded":
    case "unknown":
    case "expired":
    case "stale": return "warning";
    case "failed":
    case "approval-failed":
    case "error": return "error";
    case "rejected": return "neutral";
    default: return "accent";
  }
}

function WalletConnectCard() {
  const { open } = useAppKit();
  return (
    <Card>
      <VStack gap={3}>
        <Text type="label" color="accent">External wallet</Text>
        <Heading level={2}>Connect your wallet to route a swap</Heading>
        <Text color="secondary">
          Route quotes are requested for your wallet address. Setwise will never ask for your seed phrase or private key.
        </Text>
        <Button label="Connect wallet" variant="primary" onClick={() => void open({ view: "Connect" })} />
      </VStack>
    </Card>
  );
}

function WalletConfigCard() {
  return (
    <Card>
      <VStack gap={3}>
        <Text type="label" color="accent">Configuration required</Text>
        <Heading level={2}>Add a Reown project ID</Heading>
        <Text color="secondary">
          Copy <code>.env.example</code> to <code>.env.local</code>, set <code>VITE_REOWN_PROJECT_ID</code>, and restart the development server.
        </Text>
        <Text type="supporting" color="secondary">
          After wallet setup, use the <Link to="/faucet">testnet asset faucet</Link> to fund a new wallet.
        </Text>
      </VStack>
    </Card>
  );
}

export function RoutedSwapPage() {
  const { address, chainId: walletChainId } = useAccount();
  const { switchChain, switchChainAsync, isPending: switchPending } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const tokenCatalogQuery = useTokenCatalog();
  const [searchParams, setSearchParams] = useSearchParams();

  const connectionRef = useRef({ address, chainId: walletChainId, online });
  useLayoutEffect(() => {
    connectionRef.current = { address, chainId: walletChainId, online };
  }, [address, online, walletChainId]);

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
  const [quoteProviderNotes, setQuoteProviderNotes] = useState<readonly ProviderFailureNote[]>([]);
  const [routeProviderFilter, setRouteProviderFilter] = useState("all");
  const [marketPickerOpen, setMarketPickerOpen] = useState(false);
  const [stage, setStage] = useState<RoutedStage>("editing");
  const [execution, setExecution] = useState<RoutedExecutionView | null>(null);
  const [now, setNow] = useState(currentTimestamp);
  const quoteSequence = useRef(0);
  const quotesRef = useRef<SwapQuote[]>([]);
  const selectedQuoteIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    quotesRef.current = quotes ?? [];
  }, [quotes]);
  useLayoutEffect(() => {
    selectedQuoteIdRef.current = selectedQuoteId;
  }, [selectedQuoteId]);
  const tracking = useRef<{ activityId: string | null; quote: SwapQuote | null; sourceHash: Hash | null }>({
    activityId: null,
    quote: null,
    sourceHash: null,
  });
  const executing = execution !== null && routedExecutionBusy(execution.stage);

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
          sender: address as `0x${string}`,
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
    // Review and execution own the route identity; freeze quote refresh while
    // the user reviews or executes so the reviewed amounts never shift under
    // them and a rotated quoteId can never orphan the selection.
    if (executing || stage === "review") return;
    if (!online || !draft) {
      const reset = window.setTimeout(() => {
        setQuoteLoading(false);
        setQuotes(null);
        setQuotesRequestKey("");
        setSelectedQuoteId(null);
        setQuoteProviderNotes([]);
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
      const previousSelectedId = selectedQuoteIdRef.current;
      const previousProvider = previousSelectedId
        ? quotesRef.current.find((quote) => quote.quoteId === previousSelectedId)?.providerId
        : undefined;
      void requestSwapQuotesWithDiagnostics({ intent, signal: controller.signal }).then(({ diagnostics, quotes: nextQuotes }) => {
        if (sequence !== quoteSequence.current || controller.signal.aborted) return;
        setQuotes(nextQuotes);
        setQuotesRequestKey(requestedKey);
        setQuoteProviderNotes(providerFailureNotes(diagnostics));
        // Preserve the user's provider selection across router id rotations
        // and market moves; fall back to the ranked best quote.
        const stillOffered = previousSelectedId
          ? nextQuotes.find((quote) => quote.quoteId === previousSelectedId)?.quoteId
          : undefined;
        const sameProvider = previousProvider
          ? nextQuotes.find((quote) => quote.providerId === previousProvider)?.quoteId
          : undefined;
        setSelectedQuoteId(stillOffered ?? sameProvider ?? nextQuotes[0]?.quoteId ?? null);
        if (nextQuotes.length > 0) {
          const earliest = Math.min(...nextQuotes.map((quote) => Date.parse(quote.expiresAt)));
          window.setTimeout(() => setQuoteRefresh((value) => value + 1), Math.max(earliest - Date.now(), 0) + 20);
        }
      }).catch((error: unknown) => {
        if (controller.signal.aborted || sequence !== quoteSequence.current) return;
        if (isNoRouteError(error)) {
          setQuotes([]);
          setQuotesRequestKey(requestedKey);
          setQuoteProviderNotes(quoteErrorProviderNotes(error));
          return;
        }
        setQuoteProviderNotes([]);
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
  }, [currentRequestKey, draft, executing, online, quoteRefresh, stage]);

  useEffect(() => {
    if (!quotes || quotes.length === 0) return;
    const timer = window.setInterval(() => setNow(currentTimestamp()), 1_000);
    return () => window.clearInterval(timer);
  }, [quotes]);

  const clearExecutable = useCallback(() => {
    if (stage !== "review") return;
    setStage("editing");
    if (!executing) {
      tracking.current = { activityId: null, quote: null, sourceHash: null };
      setExecution(null);
    }
  }, [executing, stage]);

  // ——— Draft editing (frozen while an execution is in flight) ——————————
  function chooseSourceChain(next: string) {
    if (executing) return;
    const nextChainId = Number(next);
    if (!isRoutedSwapChainId(nextChainId)) return;
    setChosenSourceChainId(nextChainId);
    clearExecutable();
  }

  function chooseSourceSymbol(next: string) {
    if (executing) return;
    if (next !== "USDC" && next !== "USDT") return;
    setSourceSymbolChoice(next);
    clearExecutable();
  }

  function chooseMarket(market: RoutedMarketOption) {
    if (executing) return;
    setUnderlyingChoice(market.underlying.symbol);
    setSearchParams({ chain: String(market.chainId), token: market.address }, { replace: true });
    clearExecutable();
  }

  function chooseQuote(quoteId: string) {
    if (executing) return;
    setSelectedQuoteId(quoteId);
    clearExecutable();
  }

  function editAmount(next: string) {
    if (executing) return;
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

  // ——— Execution ———————————————————————————————————————————————————
  const refreshAfterSettlement = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["routed-swap-source-balance", sourceChainId] });
  }, [queryClient, sourceChainId]);

  function waitForWalletChain(target: number): Promise<boolean> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tick = () => {
        if (connectionRef.current.chainId === target) {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt > CHAIN_SWITCH_TIMEOUT_MS) {
          resolve(false);
          return;
        }
        window.setTimeout(tick, 250);
      };
      tick();
    });
  }

  function executionWindowGuard(account: Address, quote: SwapQuote) {
    assertRoutedExecutionWindow({
      expectedAccount: account,
      expectedChainId: sourceChainId,
      now: Date.now(),
      quote,
      snapshot: {
        account: connectionRef.current.address,
        chainId: connectionRef.current.chainId,
        online: online && connectionRef.current.online,
      },
    });
  }

  function stageForExecutionError(error: unknown, approving: boolean, submitted: boolean): RoutedExecutionStage {
    if (approving && !submitted) return "approval-failed";
    if (isWalletRejection(error)) return "rejected";
    const message = routedExecutionErrorMessage(error);
    if (/expired/i.test(message)) return "expired";
    if (/no longer offered|changed while revalidating|does not preserve|does not match|mismatch/i.test(message)) {
      return "stale";
    }
    return "error";
  }

  async function executeRoutedSwap() {
    if (!canReview || !selectedQuote || !address || !sourceAsset || !selectedMarket || !sourceClient) return;
    const reviewed = selectedQuote;
    let activityId: string | undefined;
    let approving = false;
    let submitted = false;
    try {
      setExecution({ stage: "revalidating" });

      // 1. Revalidate the exact reviewed route immediately before any wallet
      // request opens; expired or mismatched quotes are blocked here.
      const { quotes: freshQuotes } = await requestSwapQuotesWithDiagnostics({ intent: reviewed.intent });
      const freshQuote = revalidateReviewedQuote({ freshQuotes, now: Date.now(), reviewed });

      // 2. Prepare through the router; the client already validates that the
      // response preserves the exact quote identity.
      const prepared = await prepareRoutedSwap({ quote: freshQuote });
      const submission = buildRoutedSubmission({ account: address, prepared });
      const intent = freshQuote.intent;
      const requiredAmount = BigInt(intent.amountIn);

      // 3. Align the wallet with the route source chain, then recheck the
      // execution window, balances, and allowance.
      if (connectionRef.current.chainId !== sourceChainId) {
        setExecution({ stage: "switching" });
        await switchChainAsync({ chainId: sourceChainId });
        // Re-render so the connection ref observes the wallet's new chain.
        setExecution({ stage: "switching" });
        const switched = await waitForWalletChain(sourceChainId);
        if (!switched) {
          throw new Error(`The wallet did not switch to ${chainName(sourceChainId)}. Review the route and try again.`);
        }
      }
      executionWindowGuard(address, freshQuote);

      setExecution({ stage: "checking" });
      const [latestBalance, latestNativeBalance] = await Promise.all([
        sourceClient.readContract({
          address: sourceAsset.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        sourceClient.getBalance({ address }),
      ]);
      if (latestBalance < requiredAmount) {
        throw new Error(`Insufficient ${sourceAsset.symbol} balance at execution time.`);
      }
      if (latestNativeBalance <= 0n) {
        throw new Error("Insufficient native gas balance to submit the route transaction.");
      }

      // 4. Exact approval only, to the verified route spender, only when the
      // current allowance is short.
      let approvalHash: Hash | undefined;
      if (submission.approval) {
        const allowance = await sourceClient.readContract({
          address: submission.approval.token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, submission.approval.spender],
        });
        if (allowance < requiredAmount) {
          approving = true;
          executionWindowGuard(address, freshQuote);
          setExecution({ stage: "approval-wallet" });
          approvalHash = await writeContractAsync({
            account: address,
            address: submission.approval.token,
            abi: erc20Abi,
            functionName: "approve",
            args: [submission.approval.spender, submission.approval.amount],
          });
          setExecution({ stage: "approval-confirming", approvalHash });
          const approvalReceipt = await sourceClient.waitForTransactionReceipt({ hash: approvalHash });
          if (approvalReceipt.status !== "success") {
            throw new Error("The exact approval reverted on chain. No funds moved; retry the route to approve again.");
          }
          approving = false;
        }
      }

      // 5. Simulate the prepared transaction before opening the wallet.
      setExecution({ stage: "simulating", approvalHash });
      try {
        await sourceClient.call({
          account: address,
          data: submission.data,
          to: submission.to,
          value: submission.value,
        });
      } catch (simulationError) {
        throw new Error(routedSimulationErrorMessage(simulationError), { cause: simulationError });
      }
      executionWindowGuard(address, freshQuote);
      if (!quoteFresh(freshQuote, Date.now())) {
        throw new Error("The reviewed quote expired while preparing execution. Refresh the estimates.");
      }

      // 6. Record the route, then submit only from the user wallet.
      const activity = createSwapActivity({
        chainId: intent.sourceAsset.chainId,
        input: { amount: atomicToDecimal(requiredAmount, sourceAsset.decimals), symbol: sourceAsset.symbol },
        output: {
          amount: marketDecimalsQuery.data !== undefined
            ? formatRoutedOutput(freshQuote.amountOut, marketDecimalsQuery.data)
            : freshQuote.amountOut,
          symbol: selectedMarket.symbol,
        },
        routed: {
          ...(approvalHash !== undefined ? { approvalHash } : {}),
          destinationChainId: intent.destinationAsset.chainId,
          lifecycle: "prepared",
          quote: freshQuote,
          quoteId: freshQuote.quoteId,
          routeProvider: freshQuote.providerId,
          sourceChainId: intent.sourceAsset.chainId,
        },
        status: "pending",
      });
      activityId = activity.id;
      saveActivity(activity);
      tracking.current = { activityId: activity.id, quote: freshQuote, sourceHash: null };

      executionWindowGuard(address, freshQuote);
      setExecution({ stage: "wallet", approvalHash });
      const sourceHash = await sendTransactionAsync({
        account: address,
        chainId: submission.chainId,
        data: submission.data,
        to: submission.to,
        value: submission.value,
        ...(submission.gas !== undefined ? { gas: submission.gas } : {}),
      });
      submitted = true;
      tracking.current.sourceHash = sourceHash;
      markRoutedSwapLifecycle(activity.id, "source-submitted", { sourceHash });
      setExecution({ stage: "confirming", approvalHash, sourceHash });

      const receipt = await sourceClient.waitForTransactionReceipt({ hash: sourceHash });
      if (receipt.status !== "success") {
        const message = "The source transaction reverted on chain. The route cannot deliver; review the explorer before retrying.";
        markRoutedSwapLifecycle(activity.id, "failed", { error: message, sourceHash });
        tracking.current.activityId = null;
        setExecution({ stage: "failed", error: message, sourceHash });
        refreshAfterSettlement();
        return;
      }
      markRoutedSwapLifecycle(activity.id, "destination-pending", { sourceHash });
      setExecution({ stage: "tracking", approvalHash, sourceHash });
    } catch (error) {
      const message = routedExecutionErrorMessage(error);
      tracking.current.activityId = null;
      if (activityId !== undefined) {
        if (!submitted) {
          markRoutedSwapLifecycle(activityId, "failed", { error: message });
        }
        // Already-submitted routes stay resumable; background tracking owns them.
      }
      setExecution({
        error: message,
        sourceHash: tracking.current.sourceHash ?? undefined,
        stage: stageForExecutionError(error, approving, submitted),
      });
    }
  }

  // ——— Destination settlement tracking ————————————————————————————
  useEffect(() => {
    if (execution?.stage !== "tracking") return;
    const activityId = tracking.current.activityId;
    const quote = tracking.current.quote;
    const sourceHash = tracking.current.sourceHash ?? undefined;
    if (!activityId || !quote) return;
    let cancelled = false;
    let inFlight = false;
    const settle = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const status = await requestSwapExecutionStatus({ quote, transactionHash: sourceHash ?? undefined });
        if (cancelled) return;
        const settlement = mapExecutionStatus(status);
        const detail = settlement.detail ?? undefined;
        if (settlement.kind === "pending") {
          markRoutedSwapLifecycle(activityId, settlement.lifecycle, {
            destinationHash: settlement.destinationHash,
            providerDetail: detail,
          });
          if (settlement.destinationHash !== undefined) {
            setExecution({ destinationHash: settlement.destinationHash, sourceHash, stage: "tracking" });
          }
          return;
        }
        markRoutedSwapLifecycle(activityId, settlement.lifecycle, {
          destinationHash: settlement.destinationHash,
          error: settlement.lifecycle === "delivered" ? undefined : detail,
          providerDetail: detail,
        });
        tracking.current.activityId = null;
        cancelled = true;
        setExecution({ destinationHash: settlement.destinationHash, sourceHash, stage: settlement.lifecycle });
        refreshAfterSettlement();
      } catch (trackingError) {
        if (cancelled) return;
        // Provider outage: surface the unknown state but keep polling; the
        // record stays resumable across reloads.
        markRoutedSwapLifecycle(activityId, "unknown", {
          providerDetail: routedSwapErrorMessage(trackingError),
        });
        setExecution({
          error: `The route provider could not report settlement yet. Tracking continues. ${routedSwapErrorMessage(trackingError)}`,
          sourceHash,
          stage: "tracking",
        });
      } finally {
        inFlight = false;
      }
    };
    void settle();
    const timer = window.setInterval(() => void settle(), SETTLEMENT_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [execution?.stage, refreshAfterSettlement]);

  function resetExecution() {
    tracking.current = { activityId: null, quote: null, sourceHash: null };
    setExecution(null);
  }

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

  const routeProviders = useMemo(
    () => [...new Set((quotes ?? []).map((quote) => quote.providerId))].sort(),
    [quotes],
  );
  const effectiveRouteProviderFilter = routeProviders.includes(routeProviderFilter)
    ? routeProviderFilter
    : "all";
  const visibleQuotes = useMemo(() => {
    if (!quotesMatchDraft || !quotes) return quotes;
    if (effectiveRouteProviderFilter === "all") return quotes;
    return quotes.filter((quote) => quote.providerId === effectiveRouteProviderFilter);
  }, [effectiveRouteProviderFilter, quotes, quotesMatchDraft]);

  if (!runtimeConfig.walletConfigured) {
    return <WalletConfigCard />;
  }
  if (!address) {
    return <WalletConnectCard />;
  }

  if (preselectedMarket === null && marketParam) {
    return (
      <div role="alert">
        <Card>
          <VStack gap={3}>
            <HStack gap={2} vAlign="center">
              <StatusDot variant="error" label="Market unavailable" />
              <Heading level={2}>This market is not available for routed swaps</Heading>
            </HStack>
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
        </Card>
      </div>
    );
  }

  return (
    <VStack gap={4}>
      <Section>
        <VStack gap={4}>
          <VStack gap={2}>
            <Heading level={2}>Route a stablecoin swap</Heading>
            <Text type="supporting" color="secondary">
              Spend a canonical stablecoin on the source chain and receive one explicitly selected issuer market.
              Quotes are point-in-time estimates bound to the exact chains and contracts shown.
            </Text>
          </VStack>

          <VStack gap={2}>
            <Text type="label" weight="semibold">Pay from</Text>
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
                  isDisabled={!hasSourceAssets || !enabled || executing}
                />
              ))}
            </SegmentedControl>
            <Text type="supporting" color="secondary">
              Canonical stablecoins only. Wallet execution always happens on the source chain.
              Robinhood Chain has no approved stablecoins yet.
            </Text>
          </VStack>

          {sourceAsset && (
            <VStack gap={2}>
              <Text type="label" weight="semibold">Stablecoin</Text>
              <SegmentedControl
                label="Source stablecoin"
                value={sourceAsset.symbol}
                onChange={chooseSourceSymbol}
                layout="fill"
              >
                {getSourceAssets(sourceChainId).map((asset) => (
                  <SegmentedControlItem key={asset.symbol} value={asset.symbol} label={asset.symbol} isDisabled={executing} />
                ))}
              </SegmentedControl>
            </VStack>
          )}

          {sourceAsset && (
            <Card variant="muted">
              <VStack gap={2}>
                <HStack gap={2} vAlign="center">
                  <VStack gap={0}>
                    <Text type="label" weight="semibold">You pay</Text>
                    <Text type="supporting" color="secondary">
                      Balance{" "}
                      {balanceKnown
                        ? `${formatTokenAmount(balance, sourceAsset.decimals)} ${sourceAsset.symbol}`
                        : balanceQuery.isPending ? "Checking…" : sourceAsset.symbol}
                    </Text>
                  </VStack>
                  <HStack gap={2}>
                    <Button
                      label="Max"
                      variant="secondary"
                      size="sm"
                      isDisabled={executing || !balanceKnown || balance === 0n}
                      onClick={() => editAmount(atomicToDecimal(balance ?? 0n, sourceAsset.decimals))}
                    />
                  </HStack>
                </HStack>
                <TextInput
                  label="You pay amount"
                  value={amount}
                  onChange={(value) => editAmount(value)}
                  placeholder="0.0"
                  isDisabled={executing}
                  status={amount && amountError
                    ? { type: "error", message: amountError }
                    : insufficientBalance
                      ? { type: "error", message: `Insufficient ${sourceAsset.symbol} balance for this route.` }
                      : undefined}
                />
              </VStack>
            </Card>
          )}

          <VStack gap={2}>
            <Text type="label" weight="semibold">Receive</Text>
            <Button
              label={selectedMarket
                ? `${selectedMarket.underlying.symbol} · ${selectedMarket.assetProvider.name} on ${chainName(selectedMarket.chainId)}`
                : eligibleMarkets.length === 0 ? "No markets available" : "Choose a market"}
              variant="secondary"
              isDisabled={executing || eligibleMarkets.length === 0}
              onClick={() => setMarketPickerOpen(true)}
            />
            <Text type="supporting" color="secondary">
              Each issuer deployment is a distinct market; none are substituted. Browse by stock, network, and issuer.
            </Text>
            {selectedMarket && (
              <HStack gap={2} vAlign="center">
                <TokenIcon logoURI={selectedMarket.underlying.logoURI ?? selectedMarket.logoURI} symbol={selectedMarket.underlying.symbol} />
                <Text type="supporting" color="secondary">
                  {`${selectedMarket.assetProvider.name} · ${selectedMarket.symbol} · ${truncateAddress(selectedMarket.address)} on ${chainName(selectedMarket.chainId)}`}
                </Text>
              </HStack>
            )}
          </VStack>
          <MarketPickerModal
            capabilities={capabilities}
            eligibleMarkets={eligibleMarkets}
            isOpen={marketPickerOpen}
            onOpenChange={setMarketPickerOpen}
            onSelect={chooseMarket}
            selectedMarket={selectedMarket}
          />

          {selectedMarket && !sameChainAsDestination && (
            <Banner
              status="info"
              title={`Cross-chain route to ${chainName(selectedMarket.chainId)}`}
              description={`Your wallet signs only on ${chainName(sourceChainId)}; the route delivers ${selectedMarket.underlying.symbol} on ${chainName(selectedMarket.chainId)}.`}
            />
          )}
          {selectedMarket && sameChainAsDestination && (
            <Banner
              status="info"
              title="Same-chain route"
              description={`Your wallet transacts only on ${chainName(sourceChainId)}.`}
            />
          )}
          {!online && (
            <Banner status="warning" title="Offline" description="Reconnect to request route quotes." />
          )}
          {balanceQuery.error && address && (
            <Banner
              status="warning"
              title="Balance check unavailable"
              description="The stablecoin balance could not be read. Review is blocked until the balance loads."
            />
          )}
          {marketDecimalsQuery.error && selectedMarket && (
            <Banner
              status="warning"
              title="Output display estimated"
              description="The destination token decimals could not be read on chain. Amounts below show base units until the read succeeds."
            />
          )}
        </VStack>
      </Section>

      <aside className="swap-card quote-card" aria-live="polite">
        <VStack gap={3}>
          <HStack gap={2} vAlign="center">
            <Heading level={2}>Route comparison</Heading>
            {quoteLoading && <Badge label="Refreshing" variant="info" />}
            {selectedQuote && selectedQuoteIsFresh && secondsRemaining !== null && (
              <Text type="supporting" color="secondary">Fresh for {secondsRemaining}s</Text>
            )}
            {selectedQuote && !selectedQuoteIsFresh && (
              <Badge label="Expired" variant="warning" />
            )}
          </HStack>

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
          <Banner
            status="error"
            title="Pricing failed"
            description={quoteError}
            endContent={(
              <Button
                label="Retry pricing"
                variant="secondary"
                size="sm"
                isDisabled={!online}
                onClick={() => setQuoteRefresh((value) => value + 1)}
              />
            )}
          />
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
            {quoteProviderNotes.length > 0 && (
              <VStack gap={1}>
                {quoteProviderNotes.map((note) => (
                  <HStack key={note.providerId} gap={2} vAlign="center">
                    <StatusDot variant="warning" label={`${note.providerId} failed`} />
                    <Text type="supporting" color="secondary">
                      {`${note.providerId}: ${note.reason}`}
                    </Text>
                  </HStack>
                ))}
              </VStack>
            )}
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
            {quoteProviderNotes.length > 0 && (
              <Banner
                status="warning"
                title="Limited provider coverage"
                description={`${quoteProviderNotes.map((note) => `${note.providerId} ${note.reason}`).join("; ")}. Quotes below are from the remaining providers.`}
              />
            )}
            {routeProviders.length > 1 && (
              <VStack gap={1}>
                <Text type="label" weight="semibold">Route provider</Text>
                <HStack gap={1} wrap="wrap">
                  <Button
                    label="All providers"
                    variant={effectiveRouteProviderFilter === "all" ? "secondary" : "ghost"}
                    size="sm"
                    isDisabled={executing}
                    onClick={() => setRouteProviderFilter("all")}
                  />
                  {routeProviders.map((providerId) => (
                    <Button
                      key={providerId}
                      label={providerId}
                      variant={effectiveRouteProviderFilter === providerId ? "secondary" : "ghost"}
                      size="sm"
                      isDisabled={executing}
                      onClick={() => setRouteProviderFilter(providerId)}
                    />
                  ))}
                </HStack>
              </VStack>
            )}
            <List
              header={<Text className="sr-only">Ranked route alternatives, best guaranteed output first</Text>}
              density="spacious"
              hasDividers
            >
              {(visibleQuotes ?? []).map((quote) => {
                const outputDecimals = destinationDecimals;
                const isBest = quotes[0]?.quoteId === quote.quoteId;
                return (
                  <ListItem
                    key={quote.quoteId}
                    label={`${quote.providerId}`}
                    isSelected={quote.quoteId === selectedQuoteId}
                    isDisabled={executing}
                    onClick={() => chooseQuote(quote.quoteId)}
                    startContent={isBest ? <Badge label="Best" variant="info" /> : undefined}
                    endContent={(
                      <VStack gap={0} hAlign="end">
                        <Text weight="bold" hasTabularNumbers>
                          {outputDecimals === undefined
                            ? "—"
                            : `${formatRoutedOutput(quote.amountOut, outputDecimals)} ${selectedMarket?.symbol ?? ""}`}
                        </Text>
                        <Text type="supporting" color="secondary">
                          {isSameChainQuote(quote)
                            ? "Same chain"
                            : `Cross-chain → ${resolveChain(quote.intent.destinationAsset.chainId)}`}
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
                  <HStack gap={2} vAlign="center">
                    <StatusDot variant="accent" label="In review" />
                    <Heading level={3}>Review route via {selectedQuote.providerId}</Heading>
                    <Button label="Edit" variant="ghost" size="sm" isDisabled={executing} onClick={() => { resetExecution(); setStage("editing"); }} />
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
                  {execution === null && (
                    <>
                      <Text type="supporting" color="secondary">
                        Executing revalidates this exact route, switches your wallet to the source chain if needed,
                        approves at most the exact input amount to the verified route spender, and asks your wallet for
                        one source-chain transaction. Setwise never custodies keys and never broadcasts for you.
                      </Text>
                      <Button
                        label="Confirm and execute route"
                        variant="primary"
                        isDisabled={!canReview}
                        onClick={() => void executeRoutedSwap()}
                      />
                      {reviewBlockedReason && (
                        <Text type="supporting" color="secondary">{reviewBlockedReason}</Text>
                      )}
                    </>
                  )}
                </VStack>
              </div>
            )}

            {execution !== null && (
              <div
                className={`review-panel routed-execution${executing ? " is-busy" : ""}`}
                role={executing ? "status" : "alert"}
                aria-label="Routed swap execution"
              >
                <VStack gap={3}>
                  <HStack gap={2} vAlign="center">
                    <StatusDot variant={executionStatusVariant(execution.stage)} label={executionStageTitle(execution.stage)} isPulsing={executing} />
                    <Heading level={3}>{executionStageTitle(execution.stage)}</Heading>
                  </HStack>
                  {executing && (
                    <ProgressBar label={`Executing routed swap: ${executionStageTitle(execution.stage)}`} isIndeterminate />
                  )}
                  {!executing && (execution.stage === "delivered" || execution.stage === "partially-delivered"
                    || execution.stage === "refunded" || execution.stage === "failed" || execution.stage === "unknown") && (
                    <ProgressBar
                      label={`Routed swap ${executionStageTitle(execution.stage)}`}
                      value={executionProgress(execution.stage)}
                      max={100}
                      variant={execution.stage === "delivered" ? "success" : execution.stage === "failed" ? "error" : "warning"}
                      hasValueLabel
                    />
                  )}
                  {executionStageMessage(execution.stage) && (
                    <Text type="supporting" color="secondary">{executionStageMessage(execution.stage)}</Text>
                  )}
                  {(execution.stage === "tracking" || executing) && (
                    <VStack gap={1}>
                      <Skeleton height={12} index={0} />
                      <Skeleton height={12} index={1} />
                    </VStack>
                  )}
                  {execution.error && (
                    <Banner status="error" title="Execution issue" description={execution.error} />
                  )}
                  {!executing && (() => {
                    const lifecycle = lifecycleForExecutionStage(execution.stage);
                    return lifecycle ? (
                      <Text type="supporting" color="secondary">{routedRecoveryGuidance(lifecycle)}</Text>
                    ) : null;
                  })()}
                  <HStack gap={3} wrap="wrap">
                    {execution.approvalHash && (() => {
                      const url = explorerTxUrl(sourceChainId, execution.approvalHash);
                      return url
                        ? <a href={url} target="_blank" rel="noreferrer">Approval {truncateAddress(execution.approvalHash)}</a>
                        : <Text type="supporting" color="secondary">Approval {truncateAddress(execution.approvalHash)}</Text>;
                    })()}
                    {execution.sourceHash && (() => {
                      const url = explorerTxUrl(sourceChainId, execution.sourceHash);
                      return url
                        ? <a href={url} target="_blank" rel="noreferrer">Source {truncateAddress(execution.sourceHash)}</a>
                        : <Text type="supporting" color="secondary">Source {truncateAddress(execution.sourceHash)}</Text>;
                    })()}
                    {execution.destinationHash && (() => {
                      const destinationChainId = selectedQuote?.intent.destinationAsset.chainId;
                      const url = destinationChainId !== undefined
                        ? explorerTxUrl(destinationChainId, execution.destinationHash)
                        : undefined;
                      return url
                        ? <a href={url} target="_blank" rel="noreferrer">Destination {truncateAddress(execution.destinationHash)}</a>
                        : <Text type="supporting" color="secondary">Destination {truncateAddress(execution.destinationHash)}</Text>;
                    })()}
                  </HStack>
                  {execution.stage === "tracking" && (
                    <Text type="supporting" color="secondary">
                      Settlement usually completes within the estimated duration. You can leave this page; the history
                      keeps tracking this route.
                    </Text>
                  )}
                  {!executing && (
                    <HStack gap={2}>
                      {(execution.stage === "expired" || execution.stage === "stale") && (
                        <Button
                          label="Refresh estimates"
                          variant="secondary"
                          onClick={() => {
                            resetExecution();
                            setStage("editing");
                            setQuoteRefresh((value) => value + 1);
                          }}
                        />
                      )}
                      {execution.stage !== "expired" && execution.stage !== "stale" && (
                        <Button
                          label="Start a new route"
                          variant="secondary"
                          onClick={() => {
                            resetExecution();
                            setStage("editing");
                            setAmount("");
                            setQuoteRefresh((value) => value + 1);
                          }}
                        />
                      )}
                    </HStack>
                  )}
                </VStack>
              </div>
            )}

            {stage === "review" && selectedQuote && !selectedQuoteIsFresh && execution === null && (
              <Banner
                status="warning"
                title="The reviewed quote expired"
                description="Refresh the estimates and review again."
                endContent={(
                  <Button
                    label="Refresh"
                    variant="secondary"
                    size="sm"
                    isDisabled={!online}
                    onClick={() => {
                      setStage("editing");
                      setQuoteRefresh((value) => value + 1);
                    }}
                  />
                )}
              />
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
              <Text type="supporting" color="secondary">{reviewBlockedReason}</Text>
            )}
            {!walletOnSourceChain && (
              <Banner
                status="warning"
                title={`Wallet on ${walletChainId ? chainName(walletChainId) : "an unknown network"}`}
                description={`Review requires ${chainName(sourceChainId)}. Switch your wallet to continue.`}
                endContent={(
                  <Button
                    label={switchPending ? "Switching…" : `Switch to ${chainName(sourceChainId)}`}
                    variant="secondary"
                    size="sm"
                    isDisabled={switchPending}
                    onClick={() => switchChain({ chainId: sourceChainId })}
                  />
                )}
              />
            )}
          </>
        )}

        <Text type="supporting" color="secondary">
          Quotes are point-in-time estimates bound to the exact chains and contracts shown. Ranked by guaranteed minimum
          output first.
        </Text>
        </VStack>
      </aside>
    </VStack>
  );
}
