import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { isAddressEqual, type Address, type Hash } from "viem";
import {
  useAccount,
  useCapabilities,
  usePublicClient,
  useSendCalls,
  useSendTransaction,
  useWaitForCallsStatus,
  useWriteContract,
} from "wagmi";

import { setwiseTestnetChainId } from "../../config/chains";
import { bscTestnetDeployment } from "../../config/deployment";
import { TokenIdentity, tokenDisplay } from "../../components/TokenIdentity";
import { TokenSelector } from "../../components/TokenSelector";
import { runtimeConfig } from "../../config/env";
import { useTokenMetadata } from "../../data/tokens";
import { setQueryKeys } from "../../data/queryKeys";
import { erc20Abi } from "../../data/chain/abis";
import { readSwapChainState, type SwapChainState } from "../../data/chain/swapState";
import { getPool, getPoolState, RfqApiError } from "../../data/rfq/deposits";
import { getPools } from "../../data/rfq/pools";
import { resolveSet } from "../../data/sets";
import {
  createSwapIdempotencyKey,
  requestFirmSwapQuote,
  requestSwapQuote,
  type FirmSwapQuote,
  type SwapQuote,
} from "../../data/rfq/swaps";
import {
  createSwapActivity,
  markActivityFailed,
  markActivityPending,
  markActivitySuccessful,
  saveActivity,
} from "../activity/store";
import { atomicToDecimal, decimalInputError, decimalToAtomic, formatTokenAmount } from "../../lib/decimal";
import { truncateAddress } from "../../lib/format";
import {
  atomicBatchResult,
  atomicConnectionKey,
  classifyAtomicSendError,
  supportsAtomicBatch,
} from "../wallet/atomicBatch";
import {
  buildAtomicSwapCalls,
  isSupportedSwapPair,
  isWrappedNativeAsset,
  maximumSwapInput,
  relevantSwapWarnings,
  reverseSwapPair,
  validateFirmSwap,
  validateIndicativeSwap,
} from "./model";
import {
  assertSwapPreflightContext,
  atomicApprovalPreflightNotice,
  preflightRouterSwap,
  statefulAtomicBatchPreflightAvailable,
  type SwapPreflightContext,
} from "./preflight";

type SwapIntent = SwapQuote["intent"];

const routerAddress = bscTestnetDeployment.router.address;

type TransactionStage =
  | "editing"
  | "review"
  | "allowance-check"
  | "approval-wallet"
  | "approval-confirming"
  | "firm-quote"
  | "preflight"
  | "wallet"
  | "confirming"
  | "success"
  | "rejected"
  | "approval-failed"
  | "expired"
  | "reverted"
  | "status-error"
  | "error";

type TransactionView = { approvalHash?: Hash; error?: string; hash?: Hash; stage: TransactionStage };

function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const onlineRef = useRef(online);
  useEffect(() => {
    const update = () => {
      onlineRef.current = navigator.onLine;
      setOnline(onlineRef.current);
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return { online, onlineRef };
}

function errorMessage(error: unknown): string {
  if (error instanceof RfqApiError) {
    if (error.code === "TRADING_PAUSED") return "Trading is paused. Wait for swaps to resume.";
    if (error.code === "NETWORK_ERROR") return "The pricing service is unavailable. Check your connection and retry.";
    if (error.code === "MARKET_STALE" || error.code === "MARKET_UNAVAILABLE") return "Market data is stale or unavailable. Retry when pricing recovers.";
    return error.message;
  }
  if (error instanceof Error) {
    const text = error.message.toLowerCase();
    if (text.includes("user rejected") || text.includes("user denied") || text.includes("rejected the request")) {
      return "Rejected in wallet. Review the swap and try again.";
    }
    return error.message;
  }
  return "Something went wrong. Review the swap and try again.";
}

function stageForError(message: string, approving: boolean): TransactionStage {
  const normalized = message.toLowerCase();
  if (normalized.includes("expired")) return "expired";
  if (normalized.includes("rejected in wallet")) return approving ? "approval-failed" : "rejected";
  return approving ? "approval-failed" : "error";
}

function RouterTarget({ address }: { address: Address }) {
  const short = truncateAddress(address);
  return (
    <strong className="router-target">
      Set Router ·{" "}
      <a
        href={`${runtimeConfig.explorerUrl}/address/${address}`}
        target="_blank"
        rel="noreferrer"
        aria-label={`View verified Set Router ${address} in explorer`}
        title={address}
      >
        {short}
      </a>
    </strong>
  );
}

function executionStatusMessage(stage: TransactionStage, atomic: boolean): string | null {
  switch (stage) {
    case "allowance-check": return "Checking Router allowance before requesting an executable quote.";
    case "approval-wallet": return "Approve the exact input amount for the Set Router in your wallet.";
    case "approval-confirming": return "Waiting for Set Router approval confirmation on chain.";
    case "firm-quote": return "Requesting a firm quote bound to the selected Set and Set Router.";
    case "preflight": return "Simulating the swapSetwise call on the Set Router before opening your wallet.";
    case "wallet": return atomic
      ? "Confirm the atomic approval-and-swap batch in your wallet."
      : "Confirm the Set Router swap in your wallet.";
    case "confirming": return atomic
      ? "Confirming the atomic swap batch on chain."
      : "Confirming the Set Router swap on chain.";
    case "success": return "Swap confirmed on chain through the Set Router.";
    case "reverted": return "The Set Router swap reverted on chain. Review the explorer transaction before retrying.";
    case "expired": return "The executable quote expired. Refresh the estimate and review again.";
    case "rejected": return "Swap was rejected in the wallet before submission.";
    case "approval-failed": return "Token approval for the Set Router was rejected or failed.";
    case "status-error": return "Could not confirm the atomic swap batch status. Retry before submitting again.";
    case "error": return null;
    default: return null;
  }
}

function transactionLabel(stage: TransactionStage, needsApproval: boolean, atomic: boolean): string {
  switch (stage) {
    case "review": return needsApproval
      ? atomic ? "Approve & swap atomically" : "Approve exact amount & swap"
      : "Confirm swap";
    case "allowance-check": return "Checking allowance…";
    case "approval-wallet": return "Approve in wallet…";
    case "approval-confirming": return "Confirming approval…";
    case "firm-quote": return "Getting executable quote…";
    case "preflight": return "Simulating Set Router swap…";
    case "wallet": return atomic ? "Confirm atomic swap in wallet…" : "Confirm swap in wallet…";
    case "confirming": return atomic ? "Confirming atomic swap…" : "Confirming swap…";
    case "success": return "New swap";
    case "expired": return "Refresh quote";
    case "status-error": return "Retry batch status";
    case "rejected":
    case "approval-failed":
    case "reverted":
    case "error": return "Try swap again";
    default: return "Review swap";
  }
}

function currentTimestamp() {
  return Date.now();
}

// The current /swap route remains pinned to its deployed Setwise source chain.
const sourceChainId = setwiseTestnetChainId;

export function SwapPage() {
  const { address, chainId, connector } = useAccount();
  const publicClient = usePublicClient({ chainId: sourceChainId });
  const capabilityQuery = useCapabilities({
    account: address,
    chainId: sourceChainId,
    query: { enabled: Boolean(address), retry: false },
  });
  const { sendCallsAsync } = useSendCalls();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const { online, onlineRef } = useOnlineStatus();
  const tokenMetadataQuery = useTokenMetadata();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSetId = searchParams.get("set") ?? "";
  const selectedSetId = urlSetId || runtimeConfig.defaultPoolId;

  const registryQuery = useQuery({
    queryKey: setQueryKeys.list,
    queryFn: ({ signal }) => getPools(signal),
    staleTime: 60_000,
  });
  const setResolution = resolveSet(selectedSetId, registryQuery.data, sourceChainId);
  const resolvedPoolId = setResolution.status === "ready" ? setResolution.definition.id : selectedSetId;

  const [inputAssetId, setInputAssetId] = useState("");
  const [outputAssetId, setOutputAssetId] = useState("");
  const [inputNative, setInputNative] = useState(false);
  const [outputNative, setOutputNative] = useState(false);
  const [intent, setIntent] = useState<SwapIntent>("exact-input");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteRequestKey, setQuoteRequestKey] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const [firmQuote, setFirmQuote] = useState<FirmSwapQuote | null>(null);
  const [transaction, setTransaction] = useState<TransactionView>({ stage: "editing" });
  const [batchId, setBatchId] = useState<string>();
  const [atomicActivityId, setAtomicActivityId] = useState<string>();
  const [atomicFallbackConnection, setAtomicFallbackConnection] = useState<string | null>(null);
  const [now, setNow] = useState(currentTimestamp);
  const connectionKey = atomicConnectionKey(address, connector);
  const batchStatus = useWaitForCallsStatus({
    id: batchId,
    throwOnFailure: false,
    timeout: 120_000,
    query: { enabled: Boolean(batchId), retry: false },
  });
  const quoteSequence = useRef(0);
  const connectionRef = useRef({ address, chainId, online });
  useLayoutEffect(() => {
    connectionRef.current = { address, chainId, online };
  }, [address, chainId, online]);

  const previousSetId = useRef(selectedSetId);
  useEffect(() => {
    if (previousSetId.current === selectedSetId) return;
    previousSetId.current = selectedSetId;
    quoteSequence.current += 1;
    setInputAssetId("");
    setOutputAssetId("");
    setInputNative(false);
    setOutputNative(false);
    setIntent("exact-input");
    setAmount("");
    setQuote(null);
    setQuoteRequestKey("");
    setQuoteLoading(false);
    setQuoteError(null);
    setFirmQuote(null);
    setTransaction({ stage: "editing" });
    setBatchId(undefined);
    setAtomicActivityId(undefined);
  }, [selectedSetId]);

  function chooseSet(nextSetId: string) {
    if (nextSetId === selectedSetId) return;
    setSearchParams(nextSetId === runtimeConfig.defaultPoolId ? {} : { set: nextSetId }, { replace: true });
  }

  const poolQuery = useQuery({
    queryKey: setQueryKeys.detail(resolvedPoolId),
    queryFn: ({ signal }) => getPool(resolvedPoolId, signal),
    staleTime: 60_000,
  });
  const poolStateQuery = useQuery({
    queryKey: setQueryKeys.state(resolvedPoolId),
    queryFn: ({ signal }) => getPoolState(resolvedPoolId, signal),
    refetchInterval: online ? 15_000 : false,
  });
  const assets = useMemo(
    () => [...(poolQuery.data?.assets ?? [])].sort((left, right) => left.index - right.index),
    [poolQuery.data?.assets],
  );
  const tokenChainId = poolQuery.data?.chain.id ?? sourceChainId;

  const defaultPair = useMemo(() => {
    const enabled = poolQuery.data?.pairs?.find((pair) => pair.enabled
      && assets.some((asset) => asset.id === pair.assets[0])
      && assets.some((asset) => asset.id === pair.assets[1]));
    if (enabled) return enabled.assets;
    return [assets[0]?.id ?? "", assets[1]?.id ?? ""] as const;
  }, [assets, poolQuery.data?.pairs]);
  const effectiveInputAssetId = inputAssetId || defaultPair[0];
  const effectiveOutputAssetId = outputAssetId || defaultPair[1];
  const inputAsset = assets.find((asset) => asset.id === effectiveInputAssetId);
  const outputAsset = assets.find((asset) => asset.id === effectiveOutputAssetId);
  const inputDisplay = inputAsset ? tokenDisplay(inputAsset, tokenChainId, tokenMetadataQuery.data) : null;
  const outputDisplay = outputAsset ? tokenDisplay(outputAsset, tokenChainId, tokenMetadataQuery.data) : null;
  const wrappedNativeToken = poolStateQuery.data?.contract?.wrappedNativeToken;
  const inputNativeEligible = Boolean(poolQuery.data?.capabilities?.nativeAsset
    && isWrappedNativeAsset(inputAsset, wrappedNativeToken));
  const outputNativeEligible = Boolean(poolQuery.data?.capabilities?.nativeAsset
    && isWrappedNativeAsset(outputAsset, wrappedNativeToken));
  const effectiveInputNative = inputNativeEligible && inputNative;
  const effectiveOutputNative = outputNativeEligible && outputNative;
  const exactOutputSupported = Boolean(poolQuery.data?.capabilities?.swaps.exactOutput);

  const chainQuery = useQuery({
    queryKey: ["swap-chain", poolQuery.data?.id, address, poolQuery.data?.contract.address, routerAddress, ...assets.map((asset) => asset.address)],
    enabled: Boolean(address && publicClient && poolQuery.data),
    queryFn: async (): Promise<SwapChainState> => {
      if (!address || !publicClient || !poolQuery.data) throw new Error("Wallet and Set are required");
      if (poolQuery.data.id !== resolvedPoolId || poolQuery.data.chain.id !== sourceChainId) {
        throw new Error("Set discovery does not match the selected Set and chain");
      }
      return readSwapChainState({ account: address, assets, client: publicClient, routerAddress });
    },
  });

  const gasReserve = decimalToAtomic(runtimeConfig.nativeGasReserveBnb, 18);
  const inputBalance = effectiveInputNative
    ? (chainQuery.data?.nativeBalance ?? 0n)
    : (chainQuery.data?.assets[effectiveInputAssetId]?.balance ?? 0n);
  const allowance = effectiveInputNative
    ? 0n
    : (chainQuery.data?.assets[effectiveInputAssetId]?.allowance ?? 0n);
  const amountError = (() => {
    const specifiedAsset = intent === "exact-input" ? inputAsset : outputAsset;
    if (!specifiedAsset) return `Choose an ${intent === "exact-input" ? "input" : "output"} asset`;
    const error = decimalInputError(amount, specifiedAsset.decimals);
    if (error) return error;
    return decimalToAtomic(amount, specifiedAsset.decimals) > 0n ? null : "Amount must be greater than zero";
  })();
  const specifiedAsset = intent === "exact-input" ? inputAsset : outputAsset;
  const amountAtomic = amountError || !specifiedAsset ? 0n : decimalToAtomic(amount, specifiedAsset.decimals);
  const pairSupported = Boolean(inputAsset && outputAsset
    && isSupportedSwapPair(poolQuery.data?.pairs, inputAsset.id, outputAsset.id));
  const maximumInput = maximumSwapInput(inputBalance, effectiveInputNative, gasReserve);
  const insufficientGas = Boolean(chainQuery.data && chainQuery.data.nativeBalance < gasReserve);
  const tradingPaused = Boolean(poolStateQuery.data?.trading.paused);
  const currentRequestKey = `${intent}:${effectiveInputAssetId}:${effectiveOutputAssetId}:${amount}`;
  const quoteMatchesDraft = quoteRequestKey === currentRequestKey;
  const quoteFresh = Boolean(quote && Date.parse(quote.validUntil) > now);
  const requiredInputAtomic = quoteMatchesDraft && quote
    ? BigInt(quote.input.atomicAmount)
    : intent === "exact-input" ? amountAtomic : 0n;
  const insufficientBalance = requiredInputAtomic > maximumInput;
  const needsApproval = !effectiveInputNative && requiredInputAtomic > allowance;
  const atomicAvailable = atomicFallbackConnection !== connectionKey && supportsAtomicBatch(capabilityQuery.data);
  const atomicPreflightLimited = needsApproval && atomicAvailable && !statefulAtomicBatchPreflightAvailable;
  const atomicExperience = needsApproval && atomicAvailable && statefulAtomicBatchPreflightAvailable;
  const atomicTransaction = atomicExperience || Boolean(batchId);
  const busy = ["allowance-check", "approval-wallet", "approval-confirming", "firm-quote", "preflight", "wallet", "confirming"].includes(transaction.stage);

  const livePreflightContext: SwapPreflightContext = {
    account: address,
    chainId,
    online,
    poolAddress: poolQuery.data?.contract.address,
    poolId: resolvedPoolId,
    quoteId: quote?.indicativeQuoteId ?? "",
    routerAddress,
  };
  const preflightContextRef = useRef(livePreflightContext);
  useLayoutEffect(() => {
    preflightContextRef.current = {
      account: address,
      chainId,
      online,
      poolAddress: poolQuery.data?.contract.address,
      poolId: resolvedPoolId,
      quoteId: quote?.indicativeQuoteId ?? "",
      routerAddress,
    };
  }, [address, chainId, online, poolQuery.data?.contract.address, quote?.indicativeQuoteId,
    resolvedPoolId]);

  const clearExecutable = useCallback(() => {
    setFirmQuote(null);
    if (!busy) setTransaction({ stage: "editing" });
  }, [busy]);

  useEffect(() => {
    if (inputNativeEligible || !inputNative) return;
    const reset = window.setTimeout(() => setInputNative(false), 0);
    return () => window.clearTimeout(reset);
  }, [inputNative, inputNativeEligible]);
  useEffect(() => {
    if (outputNativeEligible || !outputNative) return;
    const reset = window.setTimeout(() => setOutputNative(false), 0);
    return () => window.clearTimeout(reset);
  }, [outputNative, outputNativeEligible]);

  useEffect(() => {
    const sequence = ++quoteSequence.current;
    if (busy || !online || !poolQuery.data || !inputAsset || !outputAsset || amountError || amountAtomic <= 0n
      || !pairSupported || tradingPaused) {
      const reset = window.setTimeout(() => {
        setQuoteLoading(false);
        if (amountError || !pairSupported || amountAtomic <= 0n) {
          setQuote(null);
          setQuoteRequestKey("");
        }
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
      const amountRequest = intent === "exact-input" ? { inputAmount: amount } : { outputAmount: amount };
      void requestSwapQuote({
        ...amountRequest,
        inputAsset: inputAsset.id,
        outputAsset: outputAsset.id,
        poolId: resolvedPoolId,
        signal: controller.signal,
      }).then((nextQuote) => {
        if (sequence !== quoteSequence.current || controller.signal.aborted) return;
        validateIndicativeSwap({
          specifiedAmountAtomic: amountAtomic,
          intent,
          chainId: sourceChainId,
          inputAsset,
          outputAsset,
          poolAddress: poolQuery.data.contract.address,
          poolId: poolQuery.data.id,
          quote: nextQuote,
        });
        setQuote(nextQuote);
        setQuoteRequestKey(requestedKey);
        const until = Date.parse(nextQuote.validUntil) - Date.now();
        window.setTimeout(() => setQuoteRefresh((value) => value + 1), Math.max(until, 0) + 20);
      }).catch((error: unknown) => {
        if (!controller.signal.aborted && sequence === quoteSequence.current) setQuoteError(errorMessage(error));
      }).finally(() => {
        if (!controller.signal.aborted && sequence === quoteSequence.current) setQuoteLoading(false);
      });
    }, 450);
    return () => {
      controller.abort();
      window.clearTimeout(loadingTimer);
      window.clearTimeout(requestTimer);
    };
  }, [amount, amountAtomic, amountError, busy, currentRequestKey, inputAsset, intent, online, outputAsset, pairSupported,
    poolQuery.data, quoteRefresh, resolvedPoolId, tradingPaused]);

  useEffect(() => {
    if (!quote && !firmQuote) return;
    const timer = window.setInterval(() => setNow(currentTimestamp()), 1_000);
    return () => window.clearInterval(timer);
  }, [firmQuote, quote]);

  useEffect(() => {
    if (!firmQuote || transaction.stage !== "wallet" || Date.parse(firmQuote.mustSubmitBy) > now) return;
    const discard = window.setTimeout(() => {
      setFirmQuote(null);
      setTransaction({
        stage: "wallet",
        error: "The quote expired in the open wallet prompt. Reject that stale prompt; any returned transaction hash will still be reconciled.",
      });
    }, 0);
    return () => window.clearTimeout(discard);
  }, [firmQuote, now, transaction.stage]);

  const previousContext = useRef("");
  const executionContext = `${address ?? ""}:${chainId ?? ""}:${online}:${tradingPaused}:${poolQuery.data?.contract.address ?? ""}`;
  useEffect(() => {
    if (!previousContext.current) {
      previousContext.current = executionContext;
      return;
    }
    if (previousContext.current === executionContext) return;
    previousContext.current = executionContext;
    const reset = window.setTimeout(() => {
      setFirmQuote(null);
      if (["review", "approval-wallet", "approval-confirming", "firm-quote", "preflight"].includes(transaction.stage)) {
        setTransaction({ stage: "error", error: "Wallet, network, connectivity, or Set state changed. Review again." });
      }
    }, 0);
    return () => window.clearTimeout(reset);
  }, [executionContext, transaction.stage]);

  const canReview = Boolean(
    address && chainId === sourceChainId && publicClient && quote && quoteFresh && quoteMatchesDraft
    && !quoteLoading && online && !busy && !amountError && pairSupported && !insufficientBalance
    && !insufficientGas && !tradingPaused,
  );
  const refetchChain = chainQuery.refetch;
  const refetchPoolState = poolStateQuery.refetch;
  const refreshAfterReceipt = useCallback(async () => {
    await Promise.all([refetchChain(), refetchPoolState()]);
  }, [refetchChain, refetchPoolState]);

  useEffect(() => {
    if (!batchId || !atomicActivityId || !["confirming", "status-error"].includes(transaction.stage)
      || batchStatus.isFetching) return;
    const timer = window.setTimeout(() => {
      const result = atomicBatchResult({
        error: batchStatus.error,
        expectedChainId: sourceChainId,
        status: batchStatus.data,
      });
      if (result.kind === "pending") return;
      if (result.kind === "query-error") {
        setTransaction({
          stage: "status-error",
          error: "Could not confirm the atomic swap batch. Retry its status; sequential fallback is disabled because the wallet returned a batch ID.",
        });
        return;
      }
      setBatchId(undefined);
      setFirmQuote(null);
      if (result.kind === "success") {
        setTransaction({ stage: "success", hash: result.hash });
        markActivitySuccessful(atomicActivityId, result.hash);
        setAtomicActivityId(undefined);
        void refreshAfterReceipt();
        return;
      }
      const message = result.kind === "failure"
        ? "Atomic approval-and-swap batch reverted. No approval or swap was applied."
        : result.kind === "non-atomic"
          ? "The wallet reported a non-atomic result for a swap that required atomic execution. Review the transaction before retrying."
          : "The completed atomic swap batch returned an invalid chain receipt. Review the wallet or explorer before retrying.";
      setTransaction({ stage: "error", hash: result.hash, error: message });
      markActivityFailed(atomicActivityId, message, result.hash);
      setAtomicActivityId(undefined);
      void refreshAfterReceipt();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [atomicActivityId, batchId, batchStatus.data, batchStatus.error, batchStatus.isFetching,
    refreshAfterReceipt, transaction.stage]);

  async function executeSwap() {
    if (!canReview || !quote || !address || !publicClient || !poolQuery.data || !inputAsset || !outputAsset) return;
    const reviewedContext = preflightContextRef.current;
    setTransaction({ stage: "allowance-check" });
    setFirmQuote(null);
    setBatchId(undefined);
    let activityId: string | undefined;
    let submittedHash: Hash | undefined;
    let approving = false;
    try {
      const [latestChain, latestPoolState] = await Promise.all([chainQuery.refetch(), poolStateQuery.refetch()]);
      if (!latestChain.data) throw new Error("Wallet balances are unavailable. Retry the chain read.");
      if (latestPoolState.data?.trading.paused) throw new Error("Trading is paused. Wait for swaps to resume.");
      const quoteSigner = latestPoolState.data?.contract?.quoteSigner;
      if (!quoteSigner) throw new Error("The Set quote signer is unavailable. Executable swaps are disabled.");
      const latestBalance = effectiveInputNative
        ? latestChain.data.nativeBalance
        : (latestChain.data.assets[inputAsset.id]?.balance ?? 0n);
      const quotedInputAtomic = BigInt(quote.input.atomicAmount);
      if (quotedInputAtomic > maximumSwapInput(latestBalance, effectiveInputNative, gasReserve)) {
        throw new Error(`Insufficient ${effectiveInputNative ? "BNB after gas reserve" : inputAsset.symbol} balance`);
      }
      if (latestChain.data.nativeBalance < gasReserve) throw new Error("Insufficient BNB for gas");

      let latestAllowance = effectiveInputNative ? 0n : (latestChain.data.assets[inputAsset.id]?.allowance ?? 0n);
      // The connected RPC cannot apply an approval while simulating the following Router call.
      // Approval-required swaps therefore use the sequential path and simulate after approval.
      const useAtomicBatch = statefulAtomicBatchPreflightAvailable
        && !effectiveInputNative
        && latestAllowance < quotedInputAtomic
        && atomicFallbackConnection !== connectionKey
        && supportsAtomicBatch(capabilityQuery.data);

      const requestFirm = async () => {
        const currentConnection = connectionRef.current;
        if (!onlineRef.current || !currentConnection.online || currentConnection.chainId !== sourceChainId
          || !currentConnection.address || !isAddressEqual(currentConnection.address, address)) {
          throw new Error("Wallet, network, or connectivity changed before the executable quote request");
        }
        setTransaction({ stage: "firm-quote" });
        const amountRequest = intent === "exact-input" ? { inputAmount: amount } : { outputAmount: amount };
        return requestFirmSwapQuote({
          ...amountRequest,
          idempotencyKey: createSwapIdempotencyKey(),
          inputAsset: inputAsset.id,
          inputNative: effectiveInputNative,
          outputAsset: outputAsset.id,
          outputNative: effectiveOutputNative,
          payer: address,
          poolId: resolvedPoolId,
          recipient: address,
        });
      };

      if (useAtomicBatch) {
        const firm = await requestFirm();
        const firmInputAtomic = BigInt(firm.input.atomicAmount);
        if (firmInputAtomic > maximumSwapInput(latestBalance, false, gasReserve)) {
          if (intent === "exact-output") {
            setQuote(null);
            setQuoteRequestKey("");
            setQuoteRefresh((value) => value + 1);
            throw new Error("The required input changed while preparing the exact-output swap. Review the refreshed estimate.");
          }
          throw new Error(`Insufficient ${inputAsset.symbol} balance`);
        }
        await validateFirmSwap({
          address,
          allowance: latestAllowance,
          balance: latestBalance,
          chainId: sourceChainId,
          firm,
          indicative: quote,
          inputAsset,
          inputNative: false,
          outputAsset,
          outputNative: effectiveOutputNative,
          plannedApprovalAmount: firmInputAtomic,
          poolAddress: poolQuery.data.contract.address,
          poolId: poolQuery.data.id,
          quoteSigner,
          routerAddress,
        });
        const calls = buildAtomicSwapCalls({
          firm,
          inputAsset,
          routerAddress,
        });
        setFirmQuote(firm);

        const beforeWallet = connectionRef.current;
        if (!beforeWallet.online || beforeWallet.chainId !== sourceChainId
          || !beforeWallet.address || !isAddressEqual(beforeWallet.address, address)) {
          throw new Error("Wallet, network, or connectivity changed before atomic wallet confirmation");
        }
        if (Date.parse(firm.mustSubmitBy) <= Date.now()) {
          throw new Error("Executable quote expired before the atomic wallet request could open");
        }
        const activity = createSwapActivity({
          chainId: sourceChainId,
          input: { amount: firm.input.amount, symbol: effectiveInputNative ? "BNB" : inputAsset.symbol },
          output: { amount: firm.output.amount, symbol: effectiveOutputNative ? "BNB" : outputAsset.symbol },
          setId: resolvedPoolId,
          status: "pending",
        });
        activityId = activity.id;
        saveActivity(activity);
        setAtomicActivityId(activity.id);
        setTransaction({ stage: "wallet" });
        try {
          const result = await sendCallsAsync({
            account: address,
            calls,
            chainId: sourceChainId,
            forceAtomic: true,
          });
          markActivityPending(activity.id);
          setBatchId(result.id);
          setTransaction({ stage: "confirming" });
        } catch (error) {
          const kind = classifyAtomicSendError(error);
          if (kind === "setup-rejected" || kind === "unsupported") {
            setAtomicFallbackConnection(connectionKey);
          }
          const message = kind === "setup-rejected"
            ? "Wallet setup for atomic execution was rejected. Review and retry to use a sequential approval and swap."
            : kind === "unsupported"
              ? "This wallet could not provide required atomic execution. Review and retry to use a sequential approval and swap."
              : kind === "wallet-rejected"
                ? "Atomic approval and swap was rejected in the wallet. No calls were submitted."
                : `Atomic wallet request failed without returning a batch ID. Check wallet activity before retrying. ${errorMessage(error)}`;
          setAtomicActivityId(undefined);
          setFirmQuote(null);
          setTransaction({ stage: kind === "wallet-rejected" ? "rejected" : "error", error: message });
          markActivityFailed(activity.id, message);
        }
        return;
      }

      const firm = await requestFirm();
      const firmInputAtomic = BigInt(firm.input.atomicAmount);
      if (firmInputAtomic > maximumSwapInput(latestBalance, effectiveInputNative, gasReserve)) {
        if (intent === "exact-output") {
          setQuote(null);
          setQuoteRequestKey("");
          setQuoteRefresh((value) => value + 1);
          throw new Error("The required input changed while preparing the exact-output swap. Review the refreshed estimate.");
        }
        throw new Error(`Insufficient ${effectiveInputNative ? "BNB after gas reserve" : inputAsset.symbol} balance`);
      }
      const needsFirmApproval = !effectiveInputNative && latestAllowance < firmInputAtomic;
      await validateFirmSwap({
        address,
        allowance: latestAllowance,
        balance: latestBalance,
        chainId: sourceChainId,
        firm,
        indicative: quote,
        inputAsset,
        inputNative: effectiveInputNative,
        outputAsset,
        outputNative: effectiveOutputNative,
        plannedApprovalAmount: needsFirmApproval ? firmInputAtomic : undefined,
        poolAddress: poolQuery.data.contract.address,
        poolId: poolQuery.data.id,
        quoteSigner,
        routerAddress,
      });

      if (needsFirmApproval) {
        approving = true;
        setTransaction({ stage: "approval-wallet" });
        const approvalHash = await writeContractAsync({
          account: address,
          address: inputAsset.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [routerAddress, firmInputAtomic],
        });
        setTransaction({ stage: "approval-confirming", approvalHash });
        const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        if (approvalReceipt.status !== "success") throw new Error("Token approval reverted on chain");
        approving = false;
      }

      setTransaction({ stage: "preflight" });
      assertSwapPreflightContext(reviewedContext, { ...preflightContextRef.current, online: onlineRef.current });
      const [preflightChain, preflightPoolState] = await Promise.all([chainQuery.refetch(), poolStateQuery.refetch()]);
      assertSwapPreflightContext(reviewedContext, { ...preflightContextRef.current, online: onlineRef.current });
      if (!preflightChain.data) throw new Error("Wallet balances are unavailable during Set Router preflight. Retry.");
      if (!preflightPoolState.data) throw new Error("Set state is unavailable during Router preflight. Retry.");
      if (preflightPoolState.data.chainId !== sourceChainId
        || preflightPoolState.data.poolId !== poolQuery.data.id
        || !isAddressEqual(preflightPoolState.data.poolAddress, poolQuery.data.contract.address)) {
        throw new Error("Selected Set state changed during Router preflight. Review again.");
      }

      const preflightBalance = effectiveInputNative
        ? preflightChain.data.nativeBalance
        : (preflightChain.data.assets[inputAsset.id]?.balance ?? 0n);
      latestAllowance = effectiveInputNative ? 0n : (preflightChain.data.assets[inputAsset.id]?.allowance ?? 0n);
      await validateFirmSwap({
        address,
        allowance: latestAllowance,
        balance: preflightBalance,
        chainId: sourceChainId,
        firm,
        indicative: quote,
        inputAsset,
        inputNative: effectiveInputNative,
        outputAsset,
        outputNative: effectiveOutputNative,
        poolAddress: poolQuery.data.contract.address,
        poolId: poolQuery.data.id,
        quoteSigner,
        routerAddress,
      });
      await preflightRouterSwap({
        account: address,
        allowance: latestAllowance,
        balance: preflightBalance,
        chainId: chainId ?? 0,
        client: publicClient,
        expectedChainId: sourceChainId,
        firmInput: firmInputAtomic,
        gasReserve,
        inputNative: effectiveInputNative,
        inputSymbol: inputAsset.symbol,
        mustSubmitBy: firm.mustSubmitBy,
        nativeBalance: preflightChain.data.nativeBalance,
        routerAddress,
        swapsPaused: preflightPoolState.data.trading.paused
          || preflightPoolState.data.trading.swaps === "paused",
        transaction: firm.transaction,
      });
      assertSwapPreflightContext(reviewedContext, { ...preflightContextRef.current, online: onlineRef.current });
      setFirmQuote(firm);

      const beforeWallet = connectionRef.current;
      if (!onlineRef.current || !beforeWallet.online || beforeWallet.chainId !== sourceChainId
        || !beforeWallet.address || !isAddressEqual(beforeWallet.address, address)) {
        throw new Error("Wallet, network, or connectivity changed before wallet confirmation");
      }
      if (Date.parse(firm.mustSubmitBy) <= Date.now()) {
        setFirmQuote(null);
        throw new Error("Executable quote expired before a wallet request could open");
      }
      const activity = createSwapActivity({
        chainId: sourceChainId,
        input: { amount: firm.input.amount, symbol: effectiveInputNative ? "BNB" : inputAsset.symbol },
        output: { amount: firm.output.amount, symbol: effectiveOutputNative ? "BNB" : outputAsset.symbol },
        setId: resolvedPoolId,
        status: "pending",
      });
      activityId = activity.id;
      saveActivity(activity);
      setTransaction({ stage: "wallet" });
      submittedHash = await sendTransactionAsync({
        account: address,
        data: firm.transaction.data,
        to: firm.transaction.to,
        value: BigInt(firm.transaction.value),
      });
      setFirmQuote(null);
      markActivityPending(activity.id, submittedHash);
      setTransaction({ stage: "confirming", hash: submittedHash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: submittedHash });
      if (receipt.status !== "success") {
        const message = "Swap reverted on chain. Review the explorer transaction before retrying.";
        setTransaction({ stage: "reverted", hash: submittedHash, error: message });
        markActivityFailed(activity.id, message, submittedHash);
        await refreshAfterReceipt();
        return;
      }
      setTransaction({ stage: "success", hash: submittedHash });
      markActivitySuccessful(activity.id, submittedHash);
      await refreshAfterReceipt();
    } catch (error) {
      const message = errorMessage(error);
      setFirmQuote(null);
      setTransaction({ stage: stageForError(message, approving), hash: submittedHash, error: message });
      if (activityId) markActivityFailed(activityId, message, submittedHash);
    }
  }

  function handleAction() {
    if (transaction.stage === "status-error") {
      void batchStatus.refetch();
      return;
    }
    if (transaction.stage === "editing") {
      if (canReview) setTransaction({ stage: "review" });
      return;
    }
    if (transaction.stage === "review") {
      void executeSwap();
      return;
    }
    if (transaction.stage === "success") {
      setAmount("");
      setQuote(null);
      setFirmQuote(null);
      setTransaction({ stage: "editing" });
      return;
    }
    if (transaction.stage === "expired" || !quoteFresh || !quoteMatchesDraft) {
      setFirmQuote(null);
      setTransaction({ stage: "editing" });
      setQuoteRefresh((value) => value + 1);
      return;
    }
    setTransaction({ stage: "review" });
  }

  function chooseInput(nextId: string) {
    setInputAssetId(nextId);
    if (!isSupportedSwapPair(poolQuery.data?.pairs, nextId, effectiveOutputAssetId)) {
      const replacement = assets.find((asset) => isSupportedSwapPair(poolQuery.data?.pairs, nextId, asset.id));
      setOutputAssetId(replacement?.id ?? "");
    }
    setInputNative(false);
    clearExecutable();
  }

  function chooseOutput(nextId: string) {
    setOutputAssetId(nextId);
    setOutputNative(false);
    clearExecutable();
  }

  function reversePair() {
    const reversed = reverseSwapPair(effectiveInputAssetId, effectiveOutputAssetId);
    setInputAssetId(reversed.inputAssetId);
    setOutputAssetId(reversed.outputAssetId);
    setInputNative(effectiveOutputNative);
    setOutputNative(effectiveInputNative);
    setAmount("");
    setQuote(null);
    clearExecutable();
  }

  function editAmount(nextIntent: SwapIntent, nextAmount: string) {
    if (!/^\d*\.?\d*$/.test(nextAmount) || (nextIntent === "exact-output" && !exactOutputSupported)) return;
    if (nextIntent !== intent) {
      setIntent(nextIntent);
      setQuote(null);
      setQuoteRequestKey("");
    }
    setAmount(nextAmount);
    clearExecutable();
  }

  if (registryQuery.isPending || poolQuery.isPending || poolStateQuery.isPending || chainQuery.isPending) {
    return <section className="swap-card" aria-live="polite">Loading supported assets and wallet balances…</section>;
  }

  const availableSets = (registryQuery.data ?? [])
    .map((pool) => resolveSet(pool.id, registryQuery.data, sourceChainId))
    .filter((r): r is Extract<typeof r, { status: "ready" }> => r.status === "ready")
    .map((r) => r.definition);

  if (setResolution.status === "not-found") {
    return (
      <section className="swap-card error-panel" role="alert">
        <h2>Unknown Set</h2>
        <p>No Set with id <code>{selectedSetId}</code> appears in the registry.</p>
        <button className="secondary-button" type="button" onClick={() => chooseSet(runtimeConfig.defaultPoolId)}>
          Use default Set
        </button>
      </section>
    );
  }
  if (setResolution.status === "unsupported-chain") {
    return (
      <section className="swap-card error-panel" role="alert">
        <h2>Unsupported chain</h2>
        <p>The Set <code>{selectedSetId}</code> is not on the supported chain.</p>
        <button className="secondary-button" type="button" onClick={() => chooseSet(runtimeConfig.defaultPoolId)}>
          Use default Set
        </button>
      </section>
    );
  }

  const stateConfigurationError = poolQuery.data && poolStateQuery.data
    && (poolStateQuery.data.poolId !== poolQuery.data.id
      || poolStateQuery.data.chainId !== sourceChainId
      || !isAddressEqual(poolStateQuery.data.poolAddress, poolQuery.data.contract.address))
    ? new Error("Set state does not match the selected Set and chain")
    : null;
  const loadError = poolQuery.error ?? poolStateQuery.error ?? chainQuery.error ?? stateConfigurationError;
  if (loadError) {
    return (
      <section className="swap-card error-panel" role="alert">
        <h2>Swap data is unavailable</h2>
        <p>{errorMessage(loadError)}</p>
        <button className="secondary-button" type="button" onClick={() => {
          void poolQuery.refetch(); void poolStateQuery.refetch(); void chainQuery.refetch();
        }}>Retry</button>
      </section>
    );
  }

  const quoteWarnings = quote ? relevantSwapWarnings(quote) : [];
  const indicativeSeconds = quote ? Math.max(0, Math.ceil((Date.parse(quote.validUntil) - now) / 1_000)) : null;
  const firmSeconds = firmQuote ? Math.max(0, Math.ceil((Date.parse(firmQuote.mustSubmitBy) - now) / 1_000)) : null;
  const terminal = ["success", "rejected", "approval-failed", "expired", "reverted", "status-error", "error"].includes(transaction.stage);
  const actionEnabled = transaction.stage === "success"
    || transaction.stage === "status-error"
    || (terminal ? (transaction.stage === "expired" || !quoteFresh ? online : canReview) : canReview);
  const actionReason = amountError
    ?? (!pairSupported ? "This pair is not supported" : null)
    ?? (insufficientGas ? "Insufficient BNB for gas" : null)
    ?? (insufficientBalance ? `Insufficient ${effectiveInputNative ? "BNB after gas reserve" : inputDisplay?.symbol ?? "input"} balance` : null)
    ?? (tradingPaused ? "Trading is paused" : null)
    ?? (!online ? "Offline — reconnect to continue" : null)
    ?? (quoteLoading || !quoteMatchesDraft ? "Refreshing the estimate" : null)
    ?? (!quoteFresh ? "The estimate is stale and refreshing" : null)
    ?? quoteError;
  const displayQuote = firmQuote ?? quote;
  const executionStatus = executionStatusMessage(transaction.stage, atomicTransaction);

  return (
    <div className="swap-layout">
      <section className="swap-card swap-form" aria-labelledby="swap-form-title">
        <div className="set-selector">
          <label className="field-label" htmlFor="swap-set-select">Set</label>
          <select id="swap-set-select" value={selectedSetId} disabled={busy || transaction.stage === "review"}
            onChange={(event) => chooseSet(event.target.value)}>
            {availableSets.map((set) => (
              <option key={set.id} value={set.id}>{set.id}</option>
            ))}
            {!availableSets.some((set) => set.id === selectedSetId) && (
              <option value={selectedSetId}>{selectedSetId}</option>
            )}
          </select>
        </div>
        <div className="swap-assets">
          <div className="asset-input-card">
            <div className="amount-heading">
              <span className="field-label">You pay</span>
              <span>Balance {formatTokenAmount(inputBalance, inputAsset?.decimals ?? 18)} {effectiveInputNative ? "BNB" : inputDisplay?.symbol}</span>
            </div>
            <TokenSelector ariaLabel="You pay asset" chainId={tokenChainId} options={assets} value={effectiveInputAssetId}
              disabled={busy || transaction.stage === "review"} onChange={chooseInput}
              isOptionDisabled={(asset) => !assets.some((output) => isSupportedSwapPair(poolQuery.data?.pairs, asset.id, output.id))} />
            {inputNativeEligible && (
              <label className="native-toggle">
                <input type="checkbox" checked={effectiveInputNative} disabled={busy || transaction.stage === "review"}
                  onChange={(event) => { setInputNative(event.target.checked); clearExecutable(); }} />
                <span>Pay with native BNB</span>
              </label>
            )}
            <div className="amount-control">
              <input aria-label="You pay amount" inputMode="decimal" placeholder="0.0" disabled={busy || transaction.stage === "review"}
                value={intent === "exact-input" ? amount : quoteMatchesDraft ? displayQuote?.input.amount ?? "" : ""}
                onChange={(event) => editAmount("exact-input", event.target.value)} />
              <button type="button" disabled={busy || transaction.stage === "review" || maximumInput === 0n}
                onClick={() => editAmount("exact-input", atomicToDecimal(maximumInput, inputAsset?.decimals ?? 18))}>Max</button>
            </div>
            {effectiveInputNative && <p className="quote-note">Gas reserved: {runtimeConfig.nativeGasReserveBnb} BNB.</p>}
            {intent === "exact-input" && amount && amountError && <p className="field-error">{amountError}</p>}
            {insufficientBalance && <p className="field-error">Insufficient {effectiveInputNative ? "BNB after gas reserve" : inputDisplay?.symbol} balance.</p>}
          </div>

          <button className="reverse-button" type="button" aria-label="Reverse pair"
            disabled={busy || transaction.stage === "review" || !pairSupported || quoteLoading} onClick={reversePair}>⇅</button>

          <div className="asset-input-card">
            <span className="field-label">You receive</span>
            <TokenSelector ariaLabel="You receive asset" chainId={tokenChainId} options={assets} value={effectiveOutputAssetId}
              disabled={busy || transaction.stage === "review"} onChange={chooseOutput}
              isOptionDisabled={(asset) => !isSupportedSwapPair(poolQuery.data?.pairs, effectiveInputAssetId, asset.id)} />
            {outputNativeEligible && (
              <label className="native-toggle">
                <input type="checkbox" checked={effectiveOutputNative} disabled={busy || transaction.stage === "review"}
                  onChange={(event) => { setOutputNative(event.target.checked); clearExecutable(); }} />
                <span>Receive native BNB</span>
              </label>
            )}
            <div className="amount-control">
              <input aria-label="You receive amount" inputMode="decimal" placeholder="0.0"
                disabled={busy || transaction.stage === "review" || !exactOutputSupported}
                value={intent === "exact-output" ? amount : quoteMatchesDraft ? displayQuote?.output.amount ?? "" : ""}
                onChange={(event) => editAmount("exact-output", event.target.value)} />
            </div>
            {intent === "exact-output" && amount && amountError && <p className="field-error">{amountError}</p>}
          </div>
        </div>

        {transaction.stage === "review" && quote && (
          <div className="review-panel" role="status" aria-label="Swap review">
            <div>
              <p className="eyebrow">Review swap</p>
              <strong>{quote.input.amount} {effectiveInputNative ? "BNB" : inputDisplay?.symbol} → {quote.output.amount} {effectiveOutputNative ? "BNB" : outputDisplay?.symbol}</strong>
            </div>
            <button className="secondary-button" type="button" onClick={() => setTransaction({ stage: "editing" })}>Edit</button>
            <div className="review-routing" aria-label="Router execution target">
              <span>Set</span><strong title={resolvedPoolId}>{resolvedPoolId}</strong>
              <span>Execution target</span><RouterTarget address={routerAddress} />
              {!effectiveInputNative && <><span>Exact approval spender</span><RouterTarget address={routerAddress} /></>}
            </div>
            <p>{atomicPreflightLimited
              ? atomicApprovalPreflightNotice
              : "A fresh executable quote is validated and simulated against the Set Router immediately before wallet submission."}</p>
          </div>
        )}
        {executionStatus && transaction.stage !== "review" && (
          <div className={transaction.stage === "success" ? "success-panel" : "notice"} role="status">
            {executionStatus}
          </div>
        )}
        {tradingPaused && <div className="warning-panel">Trading is paused. Swaps are unavailable until this Set resumes.</div>}
        {!online && <div className="warning-panel">Offline — reconnect to price or submit a swap.</div>}
        {insufficientGas && <div className="warning-panel">Insufficient BNB for the configured gas reserve.</div>}
        {quoteError && (
          <div className="error-panel" role="alert">
            <span>{quoteError}</span>
            <button className="inline-action" type="button" disabled={!online}
              onClick={() => setQuoteRefresh((value) => value + 1)}>Retry pricing</button>
          </div>
        )}
        {quoteWarnings.length > 0 && (
          <div className="notice quote-warnings" role="note">
            <strong>Market disclosures</strong>
            <ul>{quoteWarnings.map((warning) => <li key={`${warning.code}:${warning.message}`}>{warning.message}</li>)}</ul>
          </div>
        )}
        {!effectiveInputNative && requiredInputAtomic > 0n && (
          <div className="approval-list" aria-label="Approval requirement">
            <h3>Token approval</h3>
            <div className="approval-row">
              {inputAsset ? <TokenIdentity asset={inputAsset} chainId={tokenChainId} compact /> : <span>Input asset</span>}
              <span>{transaction.stage === "approval-wallet" ? "sequential wallet approval"
                : transaction.stage === "approval-confirming" ? "confirming"
                  : needsApproval ? atomicExperience ? "atomic exact approval" : "sequential exact approval needed" : "sufficient"}</span>
              {transaction.approvalHash && <a href={`${runtimeConfig.explorerUrl}/tx/${transaction.approvalHash}`} target="_blank" rel="noreferrer">View</a>}
            </div>
            <p>{atomicPreflightLimited
              ? atomicApprovalPreflightNotice
              : "Approval and swap use separate transactions. The exact allowance spender is the Set Router, never the Set contract; the swap is simulated after approval."}</p>
          </div>
        )}
        {firmSeconds !== null && (transaction.stage === "wallet" || transaction.stage === "confirming") && (
          <div
            className={firmSeconds <= 3 ? "firm-countdown is-warning" : "firm-countdown"}
            role="status"
            aria-label={`Executable quote expires in ${firmSeconds} seconds`}
          >
            Executable quote expires in <strong>{firmSeconds}s</strong>
          </div>
        )}
        <button className="primary-button swap-action" type="button" disabled={!actionEnabled} onClick={handleAction}>
          {quoteLoading ? "Refreshing estimate…" : transactionLabel(transaction.stage, needsApproval, atomicTransaction)}
        </button>
        {transaction.stage === "editing" && actionReason && <p className="action-reason">{actionReason}</p>}
        {transaction.error && (
          <div className="error-panel" role="alert">
            <span>{transaction.error}</span>
            <small>
              Set Router target:{" "}
              <a
                href={`${runtimeConfig.explorerUrl}/address/${routerAddress}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`View verified Set Router ${routerAddress} in explorer`}
                title={routerAddress}
              >
                {truncateAddress(routerAddress)}
              </a>
            </small>
          </div>
        )}
        {transaction.hash && (
          <p className="transaction-link">Transaction <a href={`${runtimeConfig.explorerUrl}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">{truncateAddress(transaction.hash)}</a></p>
        )}
        <p className="quote-note">Setwise uses server-side market and Set guards. There is no user-configurable slippage or minimum-received setting.</p>
        <p className="gate-help"><Link to="/faucet">Need mock ERC-20 assets?</Link></p>
      </section>

      <aside className={quoteLoading && quote ? "swap-card quote-card is-refreshing" : "swap-card quote-card"} aria-live="polite">
        <div className="quote-title"><h2 id="swap-form-title">Swap estimate</h2>{quoteLoading && <span>Refreshing</span>}</div>
        {displayQuote ? (
          <>
            <div className="quote-share">
              <span>{intent === "exact-output" ? "Exact receive" : firmQuote ? "Quoted receive" : "Estimated receive"}</span>
              <strong>{displayQuote.output.amount} {effectiveOutputNative ? "BNB" : outputDisplay?.symbol}</strong>
            </div>
            {quote && <dl className="quote-details">
              <div><dt>{intent === "exact-input" ? "Exact input" : "Required input"}</dt><dd>{displayQuote.input.amount} {effectiveInputNative ? "BNB" : inputDisplay?.symbol} · ${quote.economics.inputValueUsd}</dd></div>
              <div><dt>{intent === "exact-output" ? "Exact output" : "Estimated output"}</dt><dd>{displayQuote.output.amount} {effectiveOutputNative ? "BNB" : outputDisplay?.symbol} · ${quote.economics.outputValueUsd}</dd></div>
              <div><dt>Effective rate</dt><dd>1 {effectiveInputNative ? "BNB" : inputDisplay?.symbol} = {quote.economics.effectiveRate} {effectiveOutputNative ? "BNB" : outputDisplay?.symbol}</dd></div>
              <div><dt>Fair rate</dt><dd>{quote.economics.fairRate} {effectiveOutputNative ? "BNB" : outputDisplay?.symbol}</dd></div>
              <div className={quote.economics.priceImpactBps > 100 ? "is-warning" : ""}><dt>Price impact</dt><dd>{quote.economics.priceImpactBps / 100}%</dd></div>
              <div><dt>Set fee</dt><dd>{quote.economics.fee.bps / 100}% · {atomicToDecimal(BigInt(quote.economics.fee.indicativeAtomicAmount), inputAsset?.decimals ?? 18)} {inputDisplay?.symbol}</dd></div>
              <div><dt>Venue status</dt><dd>{quote.pricing.venues.length === 0 ? "Set only" : quote.pricing.venues.some((venue) => venue.eligible) ? "External guard eligible" : "External guard unavailable"}</dd></div>
              <div><dt>Indicative freshness</dt><dd>{quoteFresh && quoteMatchesDraft ? `${indicativeSeconds ?? 0}s` : "Refreshing…"}</dd></div>
              {firmSeconds !== null && <div className={firmSeconds <= 3 ? "is-warning" : ""}><dt>Firm quote</dt><dd>Confirm within {firmSeconds}s</dd></div>}
            </dl>}
            <p className="quote-note">Indicative estimates are never executable. A fresh signed transaction is validated and simulated immediately before swap submission.</p>
          </>
        ) : <p>{quoteLoading ? "Getting an indicative price…" : "Enter the amount you want to pay or receive to see an estimate."}</p>}
      </aside>
    </div>
  );
}
