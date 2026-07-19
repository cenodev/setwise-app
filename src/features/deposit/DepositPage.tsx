import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Address, Hash } from "viem";
import { isAddressEqual } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useWriteContract } from "wagmi";

import { requiredChainId } from "../../config/chains";
import { runtimeConfig } from "../../config/env";
import { erc20Abi, setwisePoolAbi } from "../../data/chain/abis";
import {
  getPool,
  getPoolState,
  requestDepositQuote,
  requestFirmDepositQuote,
  RfqApiError,
  type DepositAmount,
  type DepositMode,
  type DepositQuote,
  type FirmDepositQuote,
  type PoolAsset,
} from "../../data/rfq/deposits";
import {
  atomicToDecimal,
  decimalInputError,
  decimalToAtomic,
  fillByTargetWeights,
  formatTokenAmount,
} from "../../lib/decimal";
import { truncateAddress } from "../../lib/format";
import { allowedLockSelection, orderAssetsByContract, planApprovals } from "./model";

type ChainAssetState = { allowance: bigint; balance: bigint };
type ChainDepositState = {
  assets: Record<string, ChainAssetState>;
  canClaim: boolean;
  lockedShares: bigint;
  lockedUntil: bigint;
  shareBalance: bigint;
};

type ApprovalStage = "needed" | "wallet" | "confirming" | "confirmed" | "failed";
type ApprovalView = { stage: ApprovalStage; hash?: Hash };
type TransactionStage =
  | "editing"
  | "allowance-check"
  | "firm-quote"
  | "wallet"
  | "confirming"
  | "success"
  | "expired"
  | "error";

type TransactionView = {
  error?: string;
  hash?: Hash;
  stage: TransactionStage;
};

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

function addressesMatch(left: Address, right: Address): boolean {
  return isAddressEqual(left, right);
}

function errorMessage(error: unknown): string {
  if (error instanceof RfqApiError) {
    if (error.code === "TRADING_PAUSED") return "Trading is paused. Try again when deposits resume.";
    if (error.code === "BELOW_MINIMUM" || error.code === "ABOVE_MAXIMUM") return error.message;
    if (error.code === "NETWORK_ERROR") return "The pricing service is unavailable. Check your connection and retry.";
    return error.message;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("user rejected") || message.includes("user denied") || message.includes("rejected the request")) {
      return "Rejected in wallet. You can try again when ready.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
}

function midpointUsd(bid: string, ask: string): string {
  return atomicToDecimal((decimalToAtomic(bid, 18) + decimalToAtomic(ask, 18)) / 2n, 18);
}

function depositValueUsd(quote: DepositQuote, assets: readonly PoolAsset[]): string {
  const cents = quote.deposits.reduce((total, deposit) => {
    const asset = assets.find((candidate) => candidate.id === deposit.asset);
    const market = quote.marketSnapshot.find((candidate) => candidate.asset === deposit.asset);
    if (!asset || !market) return total;
    return total + BigInt(deposit.atomicAmount) * decimalToAtomic(market.bidUsd, 18) * 100n
      / (10n ** BigInt(asset.decimals)) / (10n ** 18n);
  }, 0n);
  return `$${atomicToDecimal(cents, 2)}`;
}

function validateIndicativeQuote(quote: DepositQuote, poolAddress: Address, assets: readonly PoolAsset[]) {
  if (quote.stateSnapshot.chainId !== requiredChainId) throw new Error("Indicative quote targets the wrong chain");
  if (!addressesMatch(quote.stateSnapshot.poolAddress, poolAddress)) {
    throw new Error("Indicative quote targets an unexpected pool");
  }
  if (quote.stateSnapshot.tradingPaused) throw new Error("Trading was paused while pricing this deposit");
  if (quote.orderedAtomicAmounts.length !== assets.length || quote.deposits.length !== assets.length) {
    throw new Error("Indicative quote does not include every contract-ordered pool asset");
  }
  for (const [index, asset] of assets.entries()) {
    if (quote.deposits[index]?.asset !== asset.id
      || quote.deposits[index]?.atomicAmount !== quote.orderedAtomicAmounts[index]) {
      throw new Error("Indicative quote asset order does not match the pool contract");
    }
  }
}

function relativeUnlock(timestamp: bigint): string {
  const seconds = Number(timestamp) - Math.floor(Date.now() / 1_000);
  if (seconds <= 0) return "now";
  const days = Math.ceil(seconds / 86_400);
  if (days > 1) return `in ${days} days`;
  const hours = Math.ceil(seconds / 3_600);
  return hours > 1 ? `in ${hours} hours` : "within an hour";
}

function currentTimestamp(): number {
  return Date.now();
}

function validateFirmQuote(
  firm: FirmDepositQuote,
  indicative: DepositQuote,
  address: Address,
  poolAddress: Address,
  mode: DepositMode,
  assets: readonly PoolAsset[],
  lockDays: number,
) {
  if (firm.transaction.chainId !== requiredChainId) throw new Error("Firm quote targets the wrong chain");
  if (!addressesMatch(firm.investor, address) || !addressesMatch(firm.requirements.sender, address)) {
    throw new Error("Firm quote requires a different sender");
  }
  if (!addressesMatch(firm.transaction.to, poolAddress)) throw new Error("Firm quote targets an unexpected contract");
  if (BigInt(firm.transaction.value) !== 0n) throw new Error("Deposit quote unexpectedly requests native value");
  if (firm.mode !== mode) throw new Error("Firm quote mode does not match the selected deposit mode");
  if (firm.lockDays !== lockDays) throw new Error("Firm quote lock duration does not match the selection");
  const expectedMethod = mode === "single-asset" ? "depositSingleAsset" : "depositPortfolio";
  if (firm.transaction.method !== expectedMethod) throw new Error("Firm quote method does not match the deposit mode");
  if (firm.orderedAtomicAmounts.length !== indicative.orderedAtomicAmounts.length
    || firm.orderedAtomicAmounts.some((amount, index) => amount !== indicative.orderedAtomicAmounts[index])) {
    throw new Error("Firm quote changed the contract-ordered deposit amounts");
  }
  if (Date.parse(firm.mustSubmitBy) <= Date.now()) throw new Error("Firm quote expired before wallet confirmation");

  const expectedApprovals = indicative.deposits.filter((item) => BigInt(item.atomicAmount) > 0n);
  if (firm.requirements.approvals.length !== expectedApprovals.length) {
    throw new Error("Firm quote approval requirements do not match the deposit");
  }
  for (const requirement of firm.requirements.approvals) {
    if (!addressesMatch(requirement.spender, poolAddress)) throw new Error("Firm quote has an unexpected spender");
    const asset = assets.find((candidate) => addressesMatch(candidate.address, requirement.token));
    const expected = asset && expectedApprovals.find((item) => item.asset === asset.id);
    if (!expected || expected.atomicAmount !== requirement.minimumAtomicAmount) {
      throw new Error("Firm quote has unexpected approval requirements");
    }
  }
}

function transactionLabel(stage: TransactionStage, approvals: number) {
  switch (stage) {
    case "allowance-check": return "Checking allowances…";
    case "firm-quote": return "Getting executable quote…";
    case "wallet": return "Confirm deposit in wallet…";
    case "confirming": return "Confirming deposit…";
    case "success": return "New deposit";
    case "expired": return "Refresh quote";
    case "error": return "Try deposit again";
    default: return approvals > 0 ? `Approve ${approvals} token${approvals === 1 ? "" : "s"} & deposit` : "Confirm deposit";
  }
}

export function DepositPage() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: requiredChainId });
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const online = useOnlineStatus();
  const [mode, setMode] = useState<DepositMode>("single-asset");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [targetUsd, setTargetUsd] = useState("");
  const [lockDays, setLockDays] = useState(0);
  const [quote, setQuote] = useState<DepositQuote | null>(null);
  const [quoteRequestKey, setQuoteRequestKey] = useState("");
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const [now, setNow] = useState(currentTimestamp);
  const [approvalViews, setApprovalViews] = useState<Record<string, ApprovalView>>({});
  const [firmQuote, setFirmQuote] = useState<FirmDepositQuote | null>(null);
  const [transaction, setTransaction] = useState<TransactionView>({ stage: "editing" });
  const [claimTransaction, setClaimTransaction] = useState<TransactionView>({ stage: "editing" });

  const poolQuery = useQuery({
    queryKey: ["pool", runtimeConfig.poolId],
    queryFn: ({ signal }) => getPool(runtimeConfig.poolId, signal),
    staleTime: 60_000,
  });
  const poolStateQuery = useQuery({
    queryKey: ["pool-state", runtimeConfig.poolId],
    queryFn: ({ signal }) => getPoolState(runtimeConfig.poolId, signal),
    refetchInterval: online ? 15_000 : false,
  });

  const discoveredAssets = useMemo(
    () => [...(poolQuery.data?.assets ?? [])].sort((left, right) => left.index - right.index),
    [poolQuery.data?.assets],
  );

  const chainQuery = useQuery({
    queryKey: ["deposit-chain", address, poolQuery.data?.contract.address,
      ...discoveredAssets.map((asset) => asset.address)],
    enabled: Boolean(address && publicClient && poolQuery.data),
    queryFn: async (): Promise<ChainDepositState & { orderedAssets: PoolAsset[] }> => {
      if (!address || !publicClient || !poolQuery.data) throw new Error("Wallet and pool are required");
      if (poolQuery.data.id !== runtimeConfig.poolId || poolQuery.data.chain.id !== requiredChainId) {
        throw new Error("Pool discovery does not match the configured pool and chain");
      }
      const poolAddress = poolQuery.data.contract.address;
      const assetCount = await publicClient.readContract({
        address: poolAddress, abi: setwisePoolAbi, functionName: "assetCount",
      });
      if (assetCount !== BigInt(discoveredAssets.length)) {
        throw new Error("Pool discovery asset count does not match the contract");
      }
      const contractOrder = await Promise.all(discoveredAssets.map((_, index) => publicClient.readContract({
        address: poolAddress,
        abi: setwisePoolAbi,
        functionName: "assetAt",
        args: [BigInt(index)],
      })));
      const orderedAssets = orderAssetsByContract(discoveredAssets, contractOrder);
      const [tokenStates, lockedDeposit, canClaim, shareBalance] = await Promise.all([
        Promise.all(orderedAssets.map(async (asset) => {
          const [balance, allowance] = await Promise.all([
            publicClient.readContract({ address: asset.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
            publicClient.readContract({ address: asset.address, abi: erc20Abi, functionName: "allowance", args: [address, poolAddress] }),
          ]);
          return [asset.id, { balance, allowance }] as const;
        })),
        publicClient.readContract({ address: poolAddress, abi: setwisePoolAbi, functionName: "lockedDeposits", args: [address] }),
        publicClient.readContract({ address: poolAddress, abi: setwisePoolAbi, functionName: "canClaimShares", args: [address] }),
        publicClient.readContract({ address: poolAddress, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
      ]);
      return {
        assets: Object.fromEntries(tokenStates),
        canClaim,
        lockedUntil: lockedDeposit[0],
        lockedShares: lockedDeposit[1],
        orderedAssets,
        shareBalance,
      };
    },
  });

  const assets = chainQuery.data?.orderedAssets ?? discoveredAssets;
  const effectiveSelectedAssetId = selectedAssetId || assets[0]?.id || "";

  const lockSelection = useMemo(() => allowedLockSelection(
    poolQuery.data?.quotePolicy.allowedLockDays ?? [0],
    chainQuery.data?.lockedShares ?? 0n,
  ), [chainQuery.data?.lockedShares, poolQuery.data?.quotePolicy.allowedLockDays]);
  const effectiveLockDays = lockSelection.allowed.includes(lockDays) ? lockDays : lockSelection.selected;

  const form = useMemo(() => {
    const selected = mode === "single-asset" ? assets.filter((asset) => asset.id === effectiveSelectedAssetId) : assets;
    const request: DepositAmount[] = [];
    const errors: Record<string, string> = {};
    for (const asset of selected) {
      const value = amounts[asset.id] ?? "";
      if (mode === "portfolio" && (!value || value === "0")) continue;
      const error = decimalInputError(value, asset.decimals);
      if (error) {
        errors[asset.id] = error;
        continue;
      }
      if (decimalToAtomic(value, asset.decimals) <= 0n) {
        errors[asset.id] = "Amount must be greater than zero";
        continue;
      }
      request.push({ asset: asset.id, amount: value });
    }
    if (mode === "portfolio" && request.length === 0 && Object.keys(errors).length === 0) {
      errors.portfolio = "Enter at least one amount";
    }
    return { errors, request };
  }, [amounts, assets, effectiveSelectedAssetId, mode]);
  const requestFingerprint = JSON.stringify(form.request);
  const currentRequestKey = `${requestFingerprint}:${effectiveLockDays}`;

  useEffect(() => {
    if (!online || !poolQuery.data || poolStateQuery.data?.trading.paused || form.request.length === 0
      || Object.keys(form.errors).length > 0 || !lockSelection.allowed.includes(effectiveLockDays)) {
      const resetTimer = window.setTimeout(() => {
        setQuoteLoading(false);
        setQuote(null);
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }
    const controller = new AbortController();
    const requestedKey = currentRequestKey;
    const statusTimer = window.setTimeout(() => {
      setQuoteLoading(true);
      setQuoteError(null);
    }, 0);
    const timer = window.setTimeout(() => {
      void requestDepositQuote(form.request, effectiveLockDays, controller.signal)
        .then((nextQuote) => {
          validateIndicativeQuote(nextQuote, poolQuery.data.contract.address, assets);
          setQuote(nextQuote);
          setQuoteRequestKey(requestedKey);
          const until = Date.parse(nextQuote.validUntil) - Date.now();
          window.setTimeout(() => setQuoteRefresh((value) => value + 1), Math.max(until, 0) + 20);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setQuoteError(errorMessage(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) setQuoteLoading(false);
        });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(statusTimer);
      controller.abort();
    };
  }, [assets, currentRequestKey, effectiveLockDays, form.errors, form.request, requestFingerprint,
    lockSelection.allowed, online, poolQuery.data, poolStateQuery.data?.trading.paused, quoteRefresh]);

  useEffect(() => {
    if (!quote && !firmQuote && !chainQuery.data?.lockedShares) return;
    const timer = window.setInterval(() => setNow(currentTimestamp()), 1_000);
    return () => window.clearInterval(timer);
  }, [chainQuery.data?.lockedShares, firmQuote, quote]);

  const shortfalls = useMemo(() => {
    if (!quote || !chainQuery.data) return [];
    return quote.deposits.flatMap((deposit) => {
      const asset = assets.find((candidate) => candidate.id === deposit.asset);
      const state = chainQuery.data.assets[deposit.asset];
      if (!asset || !state || BigInt(deposit.atomicAmount) <= state.balance) return [];
      return [`${asset.symbol}: requested ${deposit.amount}, wallet ${formatTokenAmount(state.balance, asset.decimals)}`];
    });
  }, [assets, chainQuery.data, quote]);

  const approvalInputs = useMemo(() => {
    if (!quote || !chainQuery.data) return [];
    return quote.deposits.flatMap((deposit) => {
      const asset = assets.find((candidate) => candidate.id === deposit.asset);
      const chainAsset = chainQuery.data.assets[deposit.asset];
      if (!asset || !chainAsset) return [];
      return [{
        allowance: chainAsset.allowance,
        amount: BigInt(deposit.atomicAmount),
        assetId: asset.id,
        token: asset.address,
      }];
    });
  }, [assets, chainQuery.data, quote]);
  const approvals = planApprovals(approvalInputs);

  const quoteFresh = Boolean(quote && Date.parse(quote.validUntil) > now);
  const quoteMatchesInput = quoteRequestKey === currentRequestKey;
  const busy = !["editing", "success", "error", "expired"].includes(transaction.stage);
  const canExecute = Boolean(
    quote && quoteFresh && quoteMatchesInput && !quoteLoading && online && !poolStateQuery.data?.trading.paused
    && shortfalls.length === 0 && address && publicClient && !busy,
  );

  async function refreshAfterReceipt() {
    await Promise.all([chainQuery.refetch(), poolStateQuery.refetch()]);
  }

  async function executeDeposit() {
    if (!canExecute || !quote || !address || !publicClient || !poolQuery.data) return;
    setTransaction({ stage: "allowance-check" });
    setFirmQuote(null);
    setApprovalViews(Object.fromEntries(approvals.map((approval) => [approval.assetId, { stage: "needed" }])));
    try {
      const latest = await chainQuery.refetch();
      if (!latest.data) throw new Error("Could not refresh wallet allowances");
      const latestInputs = approvalInputs.map((input) => ({
        ...input,
        allowance: latest.data?.assets[input.assetId]?.allowance ?? 0n,
      }));
      const requiredApprovals = planApprovals(latestInputs);
      for (const approval of requiredApprovals) {
        setApprovalViews((current) => ({ ...current, [approval.assetId]: { stage: "wallet" } }));
        let approvalHash: Hash;
        try {
          approvalHash = await writeContractAsync({
            address: approval.token,
            abi: erc20Abi,
            functionName: "approve",
            args: [poolQuery.data.contract.address, approval.amount],
          });
        } catch (error) {
          setApprovalViews((current) => ({ ...current, [approval.assetId]: { stage: "failed" } }));
          throw error;
        }
        setApprovalViews((current) => ({
          ...current,
          [approval.assetId]: { stage: "confirming", hash: approvalHash },
        }));
        const receipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        if (receipt.status !== "success") {
          setApprovalViews((current) => ({ ...current, [approval.assetId]: { stage: "failed", hash: approvalHash } }));
          throw new Error(`Approval for ${approval.assetId} reverted on chain`);
        }
        setApprovalViews((current) => ({
          ...current,
          [approval.assetId]: { stage: "confirmed", hash: approvalHash },
        }));
      }

      setTransaction({ stage: "firm-quote" });
      const firm = await requestFirmDepositQuote({
        amounts: form.request,
        investor: address,
        lockDays: effectiveLockDays,
        mode,
        idempotencyKey: `deposit:${address.toLowerCase()}:${crypto.randomUUID()}`,
      });
      validateFirmQuote(firm, quote, address, poolQuery.data.contract.address, mode, assets, effectiveLockDays);
      setFirmQuote(firm);
      if (Date.parse(firm.mustSubmitBy) <= currentTimestamp()) {
        setTransaction({ stage: "expired", error: "Executable quote expired. Refresh it before opening a new wallet request." });
        return;
      }

      setTransaction({ stage: "wallet" });
      const hash = await sendTransactionAsync({
        data: firm.transaction.data,
        to: firm.transaction.to,
        value: 0n,
      });
      setTransaction({ stage: "confirming", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Deposit reverted on chain");
      setTransaction({ stage: "success", hash });
      await refreshAfterReceipt();
    } catch (error) {
      const message = errorMessage(error);
      setTransaction({
        stage: message.toLowerCase().includes("expired") ? "expired" : "error",
        error: message,
      });
    }
  }

  function handleDepositAction() {
    if (transaction.stage === "success") {
      setAmounts({});
      setFirmQuote(null);
      setQuote(null);
      setTransaction({ stage: "editing" });
      return;
    }
    if (transaction.stage === "expired" || (transaction.stage === "error" && !quoteFresh)) {
      setFirmQuote(null);
      setTransaction({ stage: "editing" });
      setQuoteRefresh((value) => value + 1);
      return;
    }
    void executeDeposit();
  }

  async function claimShares() {
    if (!address || !publicClient || !poolQuery.data || !chainQuery.data?.canClaim) return;
    setClaimTransaction({ stage: "wallet" });
    try {
      const hash = await writeContractAsync({
        address: poolQuery.data.contract.address,
        abi: setwisePoolAbi,
        functionName: "claimShares",
      });
      setClaimTransaction({ stage: "confirming", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Claim reverted on chain");
      setClaimTransaction({ stage: "success", hash });
      await refreshAfterReceipt();
    } catch (error) {
      setClaimTransaction({ stage: "error", error: errorMessage(error) });
    }
  }

  function fillTargets() {
    if (!poolStateQuery.data) return;
    try {
      const filled = fillByTargetWeights(targetUsd, assets.map((asset) => {
        const market = poolStateQuery.data.assets.find((item) => item.asset === asset.id)?.market;
        if (!market) throw new Error(`No current price is available for ${asset.symbol}`);
        return {
          decimals: asset.decimals,
          priceUsd: midpointUsd(market.bidUsd, market.askUsd),
          weight: asset.weight,
        };
      }));
      setAmounts(Object.fromEntries(assets.map((asset, index) => [asset.id, filled[index] ?? ""])));
      setQuoteError(null);
    } catch (error) {
      setQuoteError(errorMessage(error));
    }
  }

  if (poolQuery.isPending || poolStateQuery.isPending || chainQuery.isPending) {
    return <section className="deposit-card" aria-live="polite">Loading pool assets and wallet balances…</section>;
  }
  const stateConfigurationError = poolQuery.data && poolStateQuery.data
    && (poolStateQuery.data.poolId !== poolQuery.data.id
      || poolStateQuery.data.chainId !== requiredChainId
      || !addressesMatch(poolStateQuery.data.poolAddress, poolQuery.data.contract.address))
    ? new Error("Pool state does not match the configured pool and chain")
    : null;
  const loadError = poolQuery.error ?? poolStateQuery.error ?? chainQuery.error ?? stateConfigurationError;
  if (loadError) {
    return (
      <section className="deposit-card error-panel" role="alert">
        <h2>Deposit data is unavailable</h2>
        <p>{errorMessage(loadError)}</p>
        <button className="secondary-button" type="button" onClick={() => {
          void poolQuery.refetch(); void poolStateQuery.refetch(); void chainQuery.refetch();
        }}>Retry</button>
      </section>
    );
  }

  const selectedAsset = assets.find((asset) => asset.id === effectiveSelectedAssetId);
  const firmSeconds = firmQuote ? Math.max(0, Math.ceil((Date.parse(firmQuote.mustSubmitBy) - now) / 1_000)) : null;
  const indicativeSeconds = quote ? Math.max(0, Math.ceil((Date.parse(quote.validUntil) - now) / 1_000)) : null;
  const refreshAction = transaction.stage === "expired" || (transaction.stage === "error" && !quoteFresh);
  const actionEnabled = transaction.stage === "success"
    || (refreshAction ? online && !poolStateQuery.data?.trading.paused : canExecute);

  return (
    <div className="deposit-layout">
      <section className="deposit-card deposit-form" aria-labelledby="deposit-form-title">
        <div className="mode-tabs" aria-label="Deposit mode">
          <button type="button" className={mode === "single-asset" ? "is-active" : ""}
            onClick={() => setMode("single-asset")} disabled={busy}>Single</button>
          <button type="button" className={mode === "portfolio" ? "is-active" : ""}
            onClick={() => setMode("portfolio")} disabled={busy}>Portfolio</button>
        </div>

        <div className="field-group">
          <span className="field-label">Share availability</span>
          <div className="lock-options" aria-label="Lock duration">
            {lockSelection.choices.map((days) => (
                <button key={days} type="button" className={effectiveLockDays === days ? "is-active" : ""}
                disabled={busy || !lockSelection.allowed.includes(days)} onClick={() => setLockDays(days)}>
                {days === 0 ? "Unlocked" : `${days} days`}
              </button>
            ))}
          </div>
          {chainQuery.data && chainQuery.data.lockedShares > 0n && (
            <p className="notice">You already have locked shares. New unlocked deposits remain available; another lock is disabled until you claim them.</p>
          )}
        </div>

        {mode === "single-asset" ? (
          <div className="asset-input-card">
            <label className="field-label" htmlFor="single-asset">Asset</label>
            <select id="single-asset" value={effectiveSelectedAssetId} disabled={busy}
              onChange={(event) => setSelectedAssetId(event.target.value)}>
              {assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.symbol} — {asset.name ?? asset.id}</option>)}
            </select>
            {selectedAsset && (
              <>
                <div className="amount-heading">
                  <label className="field-label" htmlFor="single-amount">Amount</label>
                  <span>Balance {formatTokenAmount(chainQuery.data?.assets[selectedAsset.id]?.balance ?? 0n, selectedAsset.decimals)}</span>
                </div>
                <div className="amount-control">
                  <input id="single-amount" inputMode="decimal" placeholder="0.0" disabled={busy}
                    value={amounts[selectedAsset.id] ?? ""} onChange={(event) => {
                      if (/^\d*\.?\d*$/.test(event.target.value)) {
                        setAmounts((current) => ({ ...current, [selectedAsset.id]: event.target.value }));
                      }
                    }} />
                  <button type="button" disabled={busy} onClick={() => setAmounts((current) => ({
                    ...current,
                    [selectedAsset.id]: atomicToDecimal(chainQuery.data?.assets[selectedAsset.id]?.balance ?? 0n, selectedAsset.decimals),
                  }))}>Max</button>
                </div>
                {form.errors[selectedAsset.id] && <p className="field-error">{form.errors[selectedAsset.id]}</p>}
                {selectedAsset.underlying && <p className="asset-caveat">Tokenized {selectedAsset.underlying.symbol} exposure; issuer conversion is not implied.</p>}
              </>
            )}
          </div>
        ) : (
          <div className="portfolio-fields">
            <div className="target-fill">
              <label className="field-label" htmlFor="target-usd">Target deposit value (USD)</label>
              <div className="amount-control amount-control--compact">
                <input id="target-usd" inputMode="decimal" placeholder="1000" disabled={busy}
                  value={targetUsd} onChange={(event) => {
                    if (/^\d*\.?\d*$/.test(event.target.value)) setTargetUsd(event.target.value);
                  }} />
                <button type="button" onClick={fillTargets} disabled={busy || !targetUsd}>Fill by weights</button>
              </div>
              <p>Requested amounts are never reduced to fit wallet balances; shortfalls are shown below.</p>
            </div>
            {assets.map((asset) => {
              const balance = chainQuery.data?.assets[asset.id]?.balance ?? 0n;
              return (
                <div className="portfolio-row" key={asset.id}>
                  <div><strong>{asset.symbol}</strong><span>{asset.weight}% target · {formatTokenAmount(balance, asset.decimals)} available</span></div>
                  <input aria-label={`${asset.symbol} amount`} inputMode="decimal" placeholder="0" disabled={busy}
                    value={amounts[asset.id] ?? ""} onChange={(event) => {
                      if (/^\d*\.?\d*$/.test(event.target.value)) {
                        setAmounts((current) => ({ ...current, [asset.id]: event.target.value }));
                      }
                    }} />
                  {form.errors[asset.id] && <p className="field-error">{form.errors[asset.id]}</p>}
                </div>
              );
            })}
            {form.errors.portfolio && <p className="field-error">{form.errors.portfolio}</p>}
          </div>
        )}

        {poolStateQuery.data?.trading.paused && <div className="warning-panel">Trading is paused. Both deposit modes are unavailable.</div>}
        {!online && <div className="warning-panel">Offline — reconnect to price or submit a deposit.</div>}
        {shortfalls.length > 0 && (
          <div className="warning-panel" role="alert"><strong>Wallet balance shortfall</strong>{shortfalls.map((item) => <span key={item}>{item}</span>)}<Link to="/faucet">Claim mock assets from the faucet</Link></div>
        )}
        {quoteError && <div className="error-panel" role="alert">{quoteError}</div>}

        {approvals.length > 0 && (
          <div className="approval-list" aria-label="Required approvals">
            <h3>Approval steps</h3>
            {approvals.map((approval, index) => {
              const asset = assets.find((item) => item.id === approval.assetId);
              const view = approvalViews[approval.assetId];
              return <div className="approval-row" key={approval.assetId}>
                <span>{index + 1}. {asset?.symbol ?? approval.assetId}</span>
                <span>{view?.stage ?? "needed"}</span>
                {view?.hash && <a href={`${runtimeConfig.explorerUrl}/tx/${view.hash}`} target="_blank" rel="noreferrer">View</a>}
              </div>;
            })}
            <p>Approvals are submitted and confirmed one at a time before the executable quote is requested.</p>
          </div>
        )}

        {firmSeconds !== null && transaction.stage === "wallet" && (
          <div className={firmSeconds <= 3 ? "firm-countdown is-warning" : "firm-countdown"} role="status">
            Confirm in wallet within <strong>{firmSeconds}s</strong>
          </div>
        )}

        <button className="primary-button deposit-action" type="button" disabled={!actionEnabled}
          onClick={handleDepositAction}>
          {quoteLoading ? "Refreshing estimate…" : transactionLabel(transaction.stage, approvals.length)}
        </button>
        {transaction.error && <div className="error-panel" role="alert">{transaction.error}</div>}
        {transaction.hash && (
          <p className="transaction-link">Transaction <a href={`${runtimeConfig.explorerUrl}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">{truncateAddress(transaction.hash)}</a></p>
        )}
      </section>

      <aside className="deposit-card quote-card" aria-live="polite">
        <div className="quote-title"><h2 id="deposit-form-title">Deposit estimate</h2>{quoteLoading && <span>Refreshing</span>}</div>
        {quote ? (
          <>
            <div className="quote-share"><span>Estimated SETWISE shares</span><strong>{quote.output.amount}</strong></div>
            <dl className="quote-details">
              <div><dt>Mode</dt><dd>{mode === "single-asset" ? "Single asset" : "Portfolio"}</dd></div>
              <div><dt>Estimated value</dt><dd>{depositValueUsd(quote, assets)}</dd></div>
              <div><dt>Availability</dt><dd>{effectiveLockDays === 0 ? "Immediately unlocked" : `Locked ${effectiveLockDays} days`}</dd></div>
              <div><dt>Indicative freshness</dt><dd>{quoteFresh ? `${indicativeSeconds ?? 0}s` : "Refreshing…"}</dd></div>
              {firmSeconds !== null && <div className={firmSeconds <= 3 ? "is-warning" : ""}><dt>Firm quote</dt><dd>Confirm within {firmSeconds}s</dd></div>}
            </dl>
            <p className="quote-note">The estimate can change until approvals finish and the signed executable quote is issued.</p>
          </>
        ) : <p>{quoteLoading ? "Getting an indicative price…" : "Enter an amount to preview SETWISE shares."}</p>}
      </aside>

      {chainQuery.data && chainQuery.data.lockedShares > 0n && poolQuery.data && (
        <section className="deposit-card locked-card" id="locked-shares">
          <div><p className="eyebrow">Locked shares</p><h2>{formatTokenAmount(chainQuery.data.lockedShares, poolQuery.data.lpToken.decimals)} {poolQuery.data.lpToken.symbol}</h2></div>
          <dl className="quote-details">
            <div><dt>Unlocks</dt><dd>{new Date(Number(chainQuery.data.lockedUntil) * 1_000).toLocaleString()} ({relativeUnlock(chainQuery.data.lockedUntil)})</dd></div>
            <div><dt>Status</dt><dd>{chainQuery.data.canClaim ? "Claimable" : "Locked"}</dd></div>
          </dl>
          <button className="secondary-button" type="button" disabled={!chainQuery.data.canClaim || !online || !["editing", "success", "error"].includes(claimTransaction.stage)}
            onClick={() => void claimShares()}>
            {claimTransaction.stage === "wallet" ? "Confirm claim in wallet…"
              : claimTransaction.stage === "confirming" ? "Confirming claim…"
                : claimTransaction.stage === "success" ? "Shares claimed" : "Claim unlocked shares"}
          </button>
          {!chainQuery.data.canClaim && <p className="quote-note">Claim becomes available at the contract-reported unlock time.</p>}
          {claimTransaction.error && <div className="error-panel" role="alert">{claimTransaction.error}</div>}
          {claimTransaction.hash && <a href={`${runtimeConfig.explorerUrl}/tx/${claimTransaction.hash}`} target="_blank" rel="noreferrer">View claim transaction</a>}
        </section>
      )}
    </div>
  );
}
