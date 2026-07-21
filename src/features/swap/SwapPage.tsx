import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { isAddressEqual, type Hash } from "viem";
import {
  useAccount,
  useCapabilities,
  usePublicClient,
  useSendCalls,
  useSendTransaction,
  useWaitForCallsStatus,
  useWriteContract,
} from "wagmi";

import { requiredChainId } from "../../config/chains";
import { TokenIdentity, tokenDisplay } from "../../components/TokenIdentity";
import { TokenSelector } from "../../components/TokenSelector";
import { runtimeConfig } from "../../config/env";
import { useTokenMetadata } from "../../data/tokens";
import { poolQueryKeys } from "../../data/queryKeys";
import { erc20Abi } from "../../data/chain/abis";
import { getPool, getPoolState, RfqApiError } from "../../data/rfq/deposits";
import {
  createSwapIdempotencyKey,
  requestFirmSwapQuote,
  requestSwapQuote,
  type FirmSwapQuote,
  type SwapQuote,
} from "../../data/rfq/swaps";
import { createSwapActivity, saveActivity, updateActivity } from "../activity/store";
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

type AssetChainState = { allowance: bigint; balance: bigint };
type ChainSwapState = { assets: Record<string, AssetChainState>; nativeBalance: bigint };
type SwapIntent = SwapQuote["intent"];

type TransactionStage =
  | "editing"
  | "review"
  | "allowance-check"
  | "approval-wallet"
  | "approval-confirming"
  | "firm-quote"
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
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
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

function transactionLabel(stage: TransactionStage, needsApproval: boolean, atomic: boolean): string {
  switch (stage) {
    case "review": return needsApproval
      ? atomic ? "Approve & swap atomically" : "Approve exact amount & swap"
      : "Confirm swap";
    case "allowance-check": return "Checking allowance…";
    case "approval-wallet": return "Approve in wallet…";
    case "approval-confirming": return "Confirming approval…";
    case "firm-quote": return "Getting executable quote…";
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

export function SwapPage() {
  const { address, chainId, connector } = useAccount();
  const publicClient = usePublicClient({ chainId: requiredChainId });
  const capabilityQuery = useCapabilities({
    account: address,
    chainId: requiredChainId,
    query: { enabled: Boolean(address), retry: false },
  });
  const { sendCallsAsync } = useSendCalls();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const online = useOnlineStatus();
  const tokenMetadataQuery = useTokenMetadata();
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
  useEffect(() => {
    connectionRef.current = { address, chainId, online };
  }, [address, chainId, online]);

  const poolQuery = useQuery({
    queryKey: poolQueryKeys.discovery(runtimeConfig.defaultPoolId),
    queryFn: ({ signal }) => getPool(runtimeConfig.defaultPoolId, signal),
    staleTime: 60_000,
  });
  const poolStateQuery = useQuery({
    queryKey: poolQueryKeys.state(runtimeConfig.defaultPoolId),
    queryFn: ({ signal }) => getPoolState(runtimeConfig.defaultPoolId, signal),
    refetchInterval: online ? 15_000 : false,
  });
  const assets = useMemo(
    () => [...(poolQuery.data?.assets ?? [])].sort((left, right) => left.index - right.index),
    [poolQuery.data?.assets],
  );
  const tokenChainId = poolQuery.data?.chain.id ?? requiredChainId;

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
    queryKey: ["swap-chain", poolQuery.data?.id, address, poolQuery.data?.contract.address, ...assets.map((asset) => asset.address)],
    enabled: Boolean(address && publicClient && poolQuery.data),
    queryFn: async (): Promise<ChainSwapState> => {
      if (!address || !publicClient || !poolQuery.data) throw new Error("Wallet and pool are required");
      if (poolQuery.data.id !== runtimeConfig.defaultPoolId || poolQuery.data.chain.id !== requiredChainId) {
        throw new Error("Pool discovery does not match the configured pool and chain");
      }
      const poolAddress = poolQuery.data.contract.address;
      const [nativeBalance, tokenStates] = await Promise.all([
        publicClient.getBalance({ address }),
        Promise.all(assets.map(async (asset) => {
          const [balance, allowance] = await Promise.all([
            publicClient.readContract({ address: asset.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
            publicClient.readContract({ address: asset.address, abi: erc20Abi, functionName: "allowance", args: [address, poolAddress] }),
          ]);
          return [asset.id, { allowance, balance }] as const;
        })),
      ]);
      return { assets: Object.fromEntries(tokenStates), nativeBalance };
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
  const atomicExperience = needsApproval && atomicAvailable;
  const atomicTransaction = atomicExperience || Boolean(batchId);
  const busy = ["allowance-check", "approval-wallet", "approval-confirming", "firm-quote", "wallet", "confirming"].includes(transaction.stage);

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
        poolId: runtimeConfig.defaultPoolId,
        signal: controller.signal,
      }).then((nextQuote) => {
        if (sequence !== quoteSequence.current || controller.signal.aborted) return;
        validateIndicativeSwap({
          specifiedAmountAtomic: amountAtomic,
          intent,
          chainId: requiredChainId,
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
    poolQuery.data, quoteRefresh, tradingPaused]);

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
      if (["review", "approval-wallet", "approval-confirming", "firm-quote"].includes(transaction.stage)) {
        setTransaction({ stage: "error", error: "Wallet, network, connectivity, or pool state changed. Review again." });
      }
    }, 0);
    return () => window.clearTimeout(reset);
  }, [executionContext, transaction.stage]);

  const canReview = Boolean(
    address && chainId === requiredChainId && publicClient && quote && quoteFresh && quoteMatchesDraft
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
        expectedChainId: requiredChainId,
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
        updateActivity(atomicActivityId, { hash: result.hash, status: "success" });
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
      updateActivity(atomicActivityId, { error: message, hash: result.hash, status: "failed" });
      setAtomicActivityId(undefined);
      void refreshAfterReceipt();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [atomicActivityId, batchId, batchStatus.data, batchStatus.error, batchStatus.isFetching,
    refreshAfterReceipt, transaction.stage]);

  async function executeSwap() {
    if (!canReview || !quote || !address || !publicClient || !poolQuery.data || !inputAsset || !outputAsset) return;
    setTransaction({ stage: "allowance-check" });
    setFirmQuote(null);
    setBatchId(undefined);
    let activityId: string | undefined;
    let submittedHash: Hash | undefined;
    let approving = false;
    try {
      const activity = createSwapActivity({
        chainId: requiredChainId,
        input: { amount: quote.input.amount, symbol: effectiveInputNative ? "BNB" : inputAsset.symbol },
        output: { amount: quote.output.amount, symbol: effectiveOutputNative ? "BNB" : outputAsset.symbol },
        status: "pending",
      });
      activityId = activity.id;
      saveActivity(activity);

      const [latestChain, latestPoolState] = await Promise.all([chainQuery.refetch(), poolStateQuery.refetch()]);
      if (!latestChain.data) throw new Error("Wallet balances are unavailable. Retry the chain read.");
      if (latestPoolState.data?.trading.paused) throw new Error("Trading is paused. Wait for swaps to resume.");
      const latestBalance = effectiveInputNative
        ? latestChain.data.nativeBalance
        : (latestChain.data.assets[inputAsset.id]?.balance ?? 0n);
      const quotedInputAtomic = BigInt(quote.input.atomicAmount);
      if (quotedInputAtomic > maximumSwapInput(latestBalance, effectiveInputNative, gasReserve)) {
        throw new Error(`Insufficient ${effectiveInputNative ? "BNB after gas reserve" : inputAsset.symbol} balance`);
      }
      if (latestChain.data.nativeBalance < gasReserve) throw new Error("Insufficient BNB for gas");

      let latestAllowance = effectiveInputNative ? 0n : (latestChain.data.assets[inputAsset.id]?.allowance ?? 0n);
      let useAtomicBatch = false;
      if (!effectiveInputNative && latestAllowance < quotedInputAtomic
        && atomicFallbackConnection !== connectionKey) {
        const latestCapabilities = await capabilityQuery.refetch();
        useAtomicBatch = supportsAtomicBatch(latestCapabilities.data);
      }

      const requestFirm = async () => {
        const currentConnection = connectionRef.current;
        if (!currentConnection.online || currentConnection.chainId !== requiredChainId
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
          poolId: runtimeConfig.defaultPoolId,
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
        validateFirmSwap({
          address,
          allowance: latestAllowance,
          balance: latestBalance,
          chainId: requiredChainId,
          firm,
          indicative: quote,
          inputAsset,
          inputNative: false,
          outputAsset,
          outputNative: effectiveOutputNative,
          plannedApprovalAmount: firmInputAtomic,
          poolAddress: poolQuery.data.contract.address,
          poolId: poolQuery.data.id,
        });
        const calls = buildAtomicSwapCalls({
          firm,
          inputAsset,
          poolAddress: poolQuery.data.contract.address,
        });
        setFirmQuote(firm);

        const beforeWallet = connectionRef.current;
        if (!beforeWallet.online || beforeWallet.chainId !== requiredChainId
          || !beforeWallet.address || !isAddressEqual(beforeWallet.address, address)) {
          throw new Error("Wallet, network, or connectivity changed before atomic wallet confirmation");
        }
        if (Date.parse(firm.mustSubmitBy) <= Date.now()) {
          throw new Error("Executable quote expired before the atomic wallet request could open");
        }
        setAtomicActivityId(activity.id);
        setTransaction({ stage: "wallet" });
        try {
          const result = await sendCallsAsync({
            account: address,
            calls,
            chainId: requiredChainId,
            forceAtomic: true,
          });
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
          updateActivity(activity.id, { error: message, status: "failed" });
        }
        return;
      }

      if (!effectiveInputNative && latestAllowance < quotedInputAtomic) {
        approving = true;
        setTransaction({ stage: "approval-wallet" });
        const approvalHash = await writeContractAsync({
          account: address,
          address: inputAsset.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [poolQuery.data.contract.address, quotedInputAtomic],
        });
        setTransaction({ stage: "approval-confirming", approvalHash });
        const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        if (approvalReceipt.status !== "success") throw new Error("Token approval reverted on chain");
        const approvedChain = await chainQuery.refetch();
        latestAllowance = approvedChain.data?.assets[inputAsset.id]?.allowance ?? 0n;
        if (latestAllowance < quotedInputAtomic) throw new Error("Approval confirmed, but the required allowance is not available yet. Retry the chain read.");
        approving = false;
      }

      const firm = await requestFirm();
      const firmInputAtomic = BigInt(firm.input.atomicAmount);
      if (intent === "exact-output"
        && (firmInputAtomic > maximumSwapInput(latestBalance, effectiveInputNative, gasReserve)
          || (!effectiveInputNative && firmInputAtomic > latestAllowance))) {
        setQuote(null);
        setQuoteRequestKey("");
        setQuoteRefresh((value) => value + 1);
        throw new Error("The required input changed while preparing the exact-output swap. Review the refreshed estimate.");
      }
      validateFirmSwap({
        address,
        allowance: latestAllowance,
        balance: latestBalance,
        chainId: requiredChainId,
        firm,
        indicative: quote,
        inputAsset,
        inputNative: effectiveInputNative,
        outputAsset,
        outputNative: effectiveOutputNative,
        poolAddress: poolQuery.data.contract.address,
        poolId: poolQuery.data.id,
      });
      setFirmQuote(firm);

      const beforeWallet = connectionRef.current;
      if (!beforeWallet.online || beforeWallet.chainId !== requiredChainId
        || !beforeWallet.address || !isAddressEqual(beforeWallet.address, address)) {
        throw new Error("Wallet, network, or connectivity changed before wallet confirmation");
      }
      if (Date.parse(firm.mustSubmitBy) <= Date.now()) {
        setFirmQuote(null);
        throw new Error("Executable quote expired before a wallet request could open");
      }
      setTransaction({ stage: "wallet" });
      submittedHash = await sendTransactionAsync({
        account: address,
        data: firm.transaction.data,
        to: firm.transaction.to,
        value: BigInt(firm.transaction.value),
      });
      setFirmQuote(null);
      updateActivity(activity.id, { hash: submittedHash, status: "pending" });
      setTransaction({ stage: "confirming", hash: submittedHash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: submittedHash });
      if (receipt.status !== "success") {
        const message = "Swap reverted on chain. Review the explorer transaction before retrying.";
        setTransaction({ stage: "reverted", hash: submittedHash, error: message });
        updateActivity(activity.id, { error: message, hash: submittedHash, status: "failed" });
        await refreshAfterReceipt();
        return;
      }
      setTransaction({ stage: "success", hash: submittedHash });
      updateActivity(activity.id, { hash: submittedHash, status: "success" });
      await refreshAfterReceipt();
    } catch (error) {
      const message = errorMessage(error);
      setFirmQuote(null);
      setTransaction({ stage: stageForError(message, approving), hash: submittedHash, error: message });
      if (activityId) updateActivity(activityId, { error: message, hash: submittedHash, status: "failed" });
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

  function chooseIntent(nextIntent: SwapIntent) {
    if (nextIntent === intent) return;
    setIntent(nextIntent);
    setAmount("");
    setQuote(null);
    setQuoteRequestKey("");
    clearExecutable();
  }

  if (poolQuery.isPending || poolStateQuery.isPending || chainQuery.isPending) {
    return <section className="swap-card" aria-live="polite">Loading supported assets and wallet balances…</section>;
  }
  const stateConfigurationError = poolQuery.data && poolStateQuery.data
    && (poolStateQuery.data.poolId !== poolQuery.data.id
      || poolStateQuery.data.chainId !== requiredChainId
      || !isAddressEqual(poolStateQuery.data.poolAddress, poolQuery.data.contract.address))
    ? new Error("Pool state does not match the configured pool and chain")
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

  return (
    <div className="swap-layout">
      <section className="swap-card swap-form" aria-labelledby="swap-form-title">
        <div className="mode-tabs" aria-label="Swap amount mode">
          <button type="button" className={intent === "exact-input" ? "is-active" : ""}
            disabled={busy || transaction.stage === "review"} onClick={() => chooseIntent("exact-input")}>Exact input</button>
          <button type="button" className={intent === "exact-output" ? "is-active" : ""}
            disabled={busy || transaction.stage === "review" || !exactOutputSupported}
            onClick={() => chooseIntent("exact-output")}>Exact output</button>
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
            {intent === "exact-input" ? (
              <div className="amount-control">
                <input aria-label="You pay amount" inputMode="decimal" placeholder="0.0" disabled={busy || transaction.stage === "review"}
                  value={amount} onChange={(event) => {
                    if (/^\d*\.?\d*$/.test(event.target.value)) {
                      setAmount(event.target.value);
                      clearExecutable();
                    }
                  }} />
                <button type="button" disabled={busy || transaction.stage === "review" || maximumInput === 0n}
                  onClick={() => { setAmount(atomicToDecimal(maximumInput, inputAsset?.decimals ?? 18)); clearExecutable(); }}>Max</button>
              </div>
            ) : (
              <div className="swap-output-amount" aria-label="You pay amount">
                {displayQuote?.input.amount ?? "—"} <span>{effectiveInputNative ? "BNB" : inputDisplay?.symbol}</span>
              </div>
            )}
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
            {intent === "exact-output" ? (
              <div className="amount-control">
                <input aria-label="You receive amount" inputMode="decimal" placeholder="0.0" disabled={busy || transaction.stage === "review"}
                  value={amount} onChange={(event) => {
                    if (/^\d*\.?\d*$/.test(event.target.value)) {
                      setAmount(event.target.value);
                      clearExecutable();
                    }
                  }} />
              </div>
            ) : (
              <div className="swap-output-amount" aria-label="You receive amount">
                {displayQuote?.output.amount ?? "—"} <span>{effectiveOutputNative ? "BNB" : outputDisplay?.symbol}</span>
              </div>
            )}
            {intent === "exact-output" && amount && amountError && <p className="field-error">{amountError}</p>}
          </div>
        </div>

        {transaction.stage === "review" && quote && (
          <div className="review-panel" role="status">
            <div><p className="eyebrow">Review swap</p><strong>{quote.input.amount} {effectiveInputNative ? "BNB" : inputDisplay?.symbol} → {quote.output.amount} {effectiveOutputNative ? "BNB" : outputDisplay?.symbol}</strong></div>
            <button className="secondary-button" type="button" onClick={() => setTransaction({ stage: "editing" })}>Edit</button>
            <p>{atomicExperience
              ? "A fresh executable quote determines the exact approval, then approval and swap execute atomically in one wallet request."
              : "The executable quote is requested only after any required sequential token approval confirms."}</p>
          </div>
        )}
        {tradingPaused && <div className="warning-panel">Trading is paused. Swaps are unavailable until the pool resumes.</div>}
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
            <p>{atomicExperience
              ? "The final firm input is approved exactly and executes with the swap. If the swap reverts, the approval reverts too."
              : "Approval and swap use separate transactions. If exact-output pricing moves above the approved amount, refresh and review again."}</p>
          </div>
        )}
        {firmSeconds !== null && (transaction.stage === "wallet" || transaction.stage === "confirming") && (
          <div className={firmSeconds <= 3 ? "firm-countdown is-warning" : "firm-countdown"} role="status">
            Executable quote expires in <strong>{firmSeconds}s</strong>
          </div>
        )}
        <button className="primary-button swap-action" type="button" disabled={!actionEnabled} onClick={handleAction}>
          {quoteLoading ? "Refreshing estimate…" : transactionLabel(transaction.stage, needsApproval, atomicTransaction)}
        </button>
        {transaction.stage === "editing" && actionReason && <p className="action-reason">{actionReason}</p>}
        {transaction.error && <div className="error-panel" role="alert">{transaction.error}</div>}
        {transaction.hash && (
          <p className="transaction-link">Transaction <a href={`${runtimeConfig.explorerUrl}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">{truncateAddress(transaction.hash)}</a></p>
        )}
        <p className="quote-note">Setwise uses server-side market and pool guards. There is no user-configurable slippage or minimum-received setting.</p>
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
              <div><dt>Pool fee</dt><dd>{quote.economics.fee.bps / 100}% · {atomicToDecimal(BigInt(quote.economics.fee.indicativeAtomicAmount), inputAsset?.decimals ?? 18)} {inputDisplay?.symbol}</dd></div>
              <div><dt>Venue status</dt><dd>{quote.pricing.venues.length === 0 ? "Pool only" : quote.pricing.venues.some((venue) => venue.eligible) ? "External guard eligible" : "External guard unavailable"}</dd></div>
              <div><dt>Indicative freshness</dt><dd>{quoteFresh && quoteMatchesDraft ? `${indicativeSeconds ?? 0}s` : "Refreshing…"}</dd></div>
              {firmSeconds !== null && <div className={firmSeconds <= 3 ? "is-warning" : ""}><dt>Firm quote</dt><dd>Confirm within {firmSeconds}s</dd></div>}
            </dl>}
            <p className="quote-note">Indicative estimates are never executable. A fresh signed transaction is validated immediately before {atomicExperience ? "the atomic approval-and-swap request" : "swap submission"}.</p>
          </>
        ) : <p>{quoteLoading ? "Getting an indicative price…" : `Enter an exact ${intent === "exact-input" ? "input" : "output"} amount to see an estimate.`}</p>}
      </aside>
    </div>
  );
}
