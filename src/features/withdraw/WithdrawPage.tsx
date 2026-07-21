import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { isAddressEqual, type Address, type Hash } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useWriteContract } from "wagmi";

import { requiredChainId } from "../../config/chains";
import { TokenIdentity } from "../../components/TokenIdentity";
import { TokenSelector } from "../../components/TokenSelector";
import { bscTestnetDeployment } from "../../config/deployment";
import { runtimeConfig } from "../../config/env";
import { poolQueryKeys } from "../../data/queryKeys";
import { erc20Abi, setwisePoolAbi } from "../../data/chain/abis";
import { getPool, getPoolState, RfqApiError, type PoolAsset } from "../../data/rfq/deposits";
import {
  requestFirmWithdrawalQuote,
  requestWithdrawalQuote,
  type FirmWithdrawalQuote,
  type WithdrawalMode,
  type WithdrawalQuote,
} from "../../data/rfq/withdrawals";
import { atomicToDecimal, decimalInputError, decimalToAtomic, formatTokenAmount } from "../../lib/decimal";
import { truncateAddress } from "../../lib/format";
import { orderAssetsByContract } from "../deposit/model";
import {
  canReceiveNative,
  mapWithdrawalOutputs,
  relevantWithdrawalWarnings,
  shareShortcut,
  validateFirmWithdrawal,
} from "./model";

type ChainWithdrawalState = {
  assetBalances: Record<string, bigint>;
  lockedShares: bigint;
  orderedAssets: PoolAsset[];
  unlockedShares: bigint;
};

type TransactionStage =
  | "editing"
  | "simulation"
  | "firm-quote"
  | "wallet"
  | "confirming"
  | "success"
  | "rejected"
  | "expired"
  | "simulation-failed"
  | "reverted"
  | "error";

type TransactionView = { error?: string; hash?: Hash; stage: TransactionStage };

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
    if (error.code === "TRADING_PAUSED") return "Trading is paused. Switch to a proportional withdrawal.";
    if (error.code === "NETWORK_ERROR") return "The pricing service is unavailable. Check your connection and retry.";
    return error.message;
  }
  if (error instanceof Error) {
    const text = error.message.toLowerCase();
    if (text.includes("user rejected") || text.includes("user denied") || text.includes("rejected the request")) {
      return "Rejected in wallet. You can try again when ready.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
}

function transactionLabel(stage: TransactionStage, mode: WithdrawalMode): string {
  switch (stage) {
    case "simulation": return "Simulating withdrawal…";
    case "firm-quote": return "Getting executable quote…";
    case "wallet": return "Confirm withdrawal in wallet…";
    case "confirming": return "Confirming withdrawal…";
    case "success": return "New withdrawal";
    case "expired": return "Refresh quote";
    case "simulation-failed": return "Retry simulation";
    case "reverted":
    case "rejected":
    case "error": return "Try withdrawal again";
    default: return mode === "proportional" ? "Confirm withdrawal" : "Review withdrawal";
  }
}

function outputUsd(quote: WithdrawalQuote, output: WithdrawalQuote["outputs"][number]): string | null {
  const market = quote.marketSnapshot.find((item) => item.asset === output.asset);
  if (!market) return null;
  const cents = BigInt(output.atomicAmount) * decimalToAtomic(market.bidUsd, 18) * 100n
    / (10n ** BigInt(output.decimals)) / (10n ** 18n);
  return `$${atomicToDecimal(cents, 2)}`;
}

function totalOutputUsd(quote: WithdrawalQuote): string | null {
  let cents = 0n;
  for (const output of quote.outputs) {
    const market = quote.marketSnapshot.find((item) => item.asset === output.asset);
    if (!market) return null;
    cents += BigInt(output.atomicAmount) * decimalToAtomic(market.bidUsd, 18) * 100n
      / (10n ** BigInt(output.decimals)) / (10n ** 18n);
  }
  return `$${atomicToDecimal(cents, 2)}`;
}

function validateIndicativeQuote(input: {
  amountAtomic: bigint;
  assets: readonly PoolAsset[];
  mode: WithdrawalMode;
  outputAssetId: string;
  poolAddress: Address;
  quote: WithdrawalQuote;
}) {
  const { amountAtomic, assets, mode, outputAssetId, poolAddress, quote } = input;
  if (quote.stateSnapshot.chainId !== requiredChainId) throw new Error("Indicative quote targets the wrong chain");
  if (!isAddressEqual(quote.stateSnapshot.poolAddress, poolAddress)) {
    throw new Error("Indicative quote targets an unexpected pool");
  }
  if (quote.mode !== mode) throw new Error("Indicative quote mode does not match the withdrawal mode");
  if (BigInt(quote.input.atomicAmount) !== amountAtomic) throw new Error("Indicative quote changed the share amount");
  if (mode === "proportional" && quote.execution !== "direct-onchain") {
    throw new Error("Proportional withdrawal was not marked for direct execution");
  }
  if (mode === "single-asset") {
    if (quote.execution !== "requires-firm-quote" || quote.outputs[0]?.asset !== outputAssetId) {
      throw new Error("Single-asset withdrawal output does not match the selection");
    }
    if (quote.stateSnapshot.tradingPaused) throw new Error("Trading paused while pricing this withdrawal");
  }
  mapWithdrawalOutputs(quote, assets);
}

function stageForError(message: string): TransactionStage {
  const normalized = message.toLowerCase();
  if (normalized.includes("rejected in wallet")) return "rejected";
  if (normalized.includes("expired")) return "expired";
  return "error";
}

function currentTimestamp(): number {
  return Date.now();
}

export function WithdrawPage() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: requiredChainId });
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const online = useOnlineStatus();
  const [mode, setMode] = useState<WithdrawalMode>("proportional");
  const [amount, setAmount] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [receiveNative, setReceiveNative] = useState(false);
  const [quote, setQuote] = useState<WithdrawalQuote | null>(null);
  const [quoteRequestKey, setQuoteRequestKey] = useState("");
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const [firmQuote, setFirmQuote] = useState<FirmWithdrawalQuote | null>(null);
  const [transaction, setTransaction] = useState<TransactionView>({ stage: "editing" });
  const [now, setNow] = useState(currentTimestamp);

  const poolQuery = useQuery({
    queryKey: poolQueryKeys.discovery(runtimeConfig.poolId),
    queryFn: ({ signal }) => getPool(runtimeConfig.poolId, signal),
    staleTime: 60_000,
  });
  const poolStateQuery = useQuery({
    queryKey: poolQueryKeys.state(runtimeConfig.poolId),
    queryFn: ({ signal }) => getPoolState(runtimeConfig.poolId, signal),
    refetchInterval: online ? 15_000 : false,
  });
  const discoveredAssets = useMemo(
    () => [...(poolQuery.data?.assets ?? [])].sort((left, right) => left.index - right.index),
    [poolQuery.data?.assets],
  );
  const tokenChainId = poolQuery.data?.chain.id ?? requiredChainId;
  const chainQuery = useQuery({
    queryKey: ["withdraw-chain", address, poolQuery.data?.contract.address,
      ...discoveredAssets.map((asset) => asset.address)],
    enabled: Boolean(address && publicClient && poolQuery.data),
    queryFn: async (): Promise<ChainWithdrawalState> => {
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
        address: poolAddress, abi: setwisePoolAbi, functionName: "assetAt", args: [BigInt(index)],
      })));
      const orderedAssets = orderAssetsByContract(discoveredAssets, contractOrder);
      const [unlockedShares, lockedDeposit, balances] = await Promise.all([
        publicClient.readContract({
          address: poolQuery.data.lpToken.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        publicClient.readContract({
          address: poolAddress,
          abi: setwisePoolAbi,
          functionName: "lockedDeposits",
          args: [address],
        }),
        Promise.all(orderedAssets.map(async (asset) => [asset.id, await publicClient.readContract({
          address: asset.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        })] as const)),
      ]);
      return {
        assetBalances: Object.fromEntries(balances),
        lockedShares: lockedDeposit[1],
        orderedAssets,
        unlockedShares,
      };
    },
  });

  const assets = chainQuery.data?.orderedAssets ?? discoveredAssets;
  const effectiveSelectedAssetId = selectedAssetId || assets[0]?.id || "";
  const selectedAsset = assets.find((asset) => asset.id === effectiveSelectedAssetId);
  const nativeEligible = Boolean(selectedAsset
    && canReceiveNative(selectedAsset.address, bscTestnetDeployment.wrappedNative.address));
  const effectiveReceiveNative = nativeEligible && receiveNative;
  const lpDecimals = poolQuery.data?.lpToken.decimals ?? 18;
  const amountError = useMemo(() => {
    const error = decimalInputError(amount, lpDecimals);
    if (error) return error;
    return decimalToAtomic(amount, lpDecimals) > 0n ? null : "Amount must be greater than zero";
  }, [amount, lpDecimals]);
  const amountAtomic = amountError ? 0n : decimalToAtomic(amount, lpDecimals);
  const currentRequestKey = `${mode}:${amount}:${mode === "single-asset" ? effectiveSelectedAssetId : "all"}`;
  const tradingPaused = Boolean(poolStateQuery.data?.trading.paused);
  const busy = ["simulation", "firm-quote", "wallet", "confirming"].includes(transaction.stage);

  useEffect(() => {
    if (!online || !poolQuery.data || amountError || amountAtomic <= 0n
      || (mode === "single-asset" && (!effectiveSelectedAssetId || tradingPaused))) {
      const reset = window.setTimeout(() => {
        setQuoteLoading(false);
        if (amountError || amountAtomic <= 0n) {
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
      void requestWithdrawalQuote({
        poolTokenAmount: amount,
        ...(mode === "single-asset" ? { outputAsset: effectiveSelectedAssetId } : {}),
        signal: controller.signal,
      }).then((nextQuote) => {
        validateIndicativeQuote({
          amountAtomic,
          assets,
          mode,
          outputAssetId: effectiveSelectedAssetId,
          poolAddress: poolQuery.data.contract.address,
          quote: nextQuote,
        });
        setQuote(nextQuote);
        setQuoteRequestKey(requestedKey);
        const until = Date.parse(nextQuote.validUntil) - Date.now();
        window.setTimeout(() => setQuoteRefresh((value) => value + 1), Math.max(until, 0) + 20);
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setQuoteError(errorMessage(error));
      }).finally(() => {
        if (!controller.signal.aborted) setQuoteLoading(false);
      });
    }, 450);
    return () => {
      controller.abort();
      window.clearTimeout(loadingTimer);
      window.clearTimeout(requestTimer);
    };
  }, [amount, amountAtomic, amountError, assets, currentRequestKey, effectiveSelectedAssetId, mode,
    online, poolQuery.data, quoteRefresh, tradingPaused]);

  useEffect(() => {
    if (!quote && !firmQuote) return;
    const timer = window.setInterval(() => setNow(currentTimestamp()), 1_000);
    return () => window.clearInterval(timer);
  }, [firmQuote, quote]);

  useEffect(() => {
    if (nativeEligible || !receiveNative) return;
    const reset = window.setTimeout(() => setReceiveNative(false), 0);
    return () => window.clearTimeout(reset);
  }, [nativeEligible, receiveNative]);

  const quoteFresh = Boolean(quote && Date.parse(quote.validUntil) > now);
  const quoteMatchesInput = quoteRequestKey === currentRequestKey;
  const insufficientShares = Boolean(chainQuery.data && amountAtomic > chainQuery.data.unlockedShares);
  const canExecute = Boolean(
    address && publicClient && quote && quoteFresh && quoteMatchesInput && !quoteLoading && online && !busy
    && !amountError && !insufficientShares && !(mode === "single-asset" && tradingPaused),
  );
  const refetchChain = chainQuery.refetch;
  const refetchPoolState = poolStateQuery.refetch;
  const refreshAfterReceipt = useCallback(async () => {
    await Promise.all([refetchChain(), refetchPoolState()]);
  }, [refetchChain, refetchPoolState]);

  async function executeWithdrawal() {
    if (!canExecute || !quote || !address || !publicClient || !poolQuery.data) return;
    setFirmQuote(null);
    let submittedHash: Hash | undefined;
    try {
      const [latestChain, latestPoolState] = await Promise.all([chainQuery.refetch(), poolStateQuery.refetch()]);
      if (!latestChain.data || amountAtomic > latestChain.data.unlockedShares) {
        throw new Error("Insufficient unlocked SETWISE balance");
      }
      if (mode === "single-asset" && latestPoolState.data?.trading.paused) {
        throw new Error("Trading is paused. Switch to a proportional withdrawal.");
      }

      if (mode === "proportional") {
        setTransaction({ stage: "simulation" });
        try {
          await publicClient.simulateContract({
            account: address,
            address: poolQuery.data.contract.address,
            abi: setwisePoolAbi,
            functionName: "withdrawPortfolio",
            args: [amountAtomic],
          });
        } catch (error) {
          setTransaction({ stage: "simulation-failed", error: `Simulation failed. ${errorMessage(error)}` });
          return;
        }
        setTransaction({ stage: "wallet" });
        submittedHash = await writeContractAsync({
          account: address,
          address: poolQuery.data.contract.address,
          abi: setwisePoolAbi,
          functionName: "withdrawPortfolio",
          args: [amountAtomic],
        });
      } else {
        setTransaction({ stage: "firm-quote" });
        const firm = await requestFirmWithdrawalQuote({
          idempotencyKey: `withdraw:${address.toLowerCase()}:${crypto.randomUUID()}`,
          investor: address,
          outputAsset: effectiveSelectedAssetId,
          poolTokenAmount: amount,
          receiveNative: effectiveReceiveNative,
        });
        validateFirmWithdrawal({
          address,
          chainId: requiredChainId,
          firm,
          indicative: quote,
          outputAssetId: effectiveSelectedAssetId,
          poolAddress: poolQuery.data.contract.address,
          receiveNative: effectiveReceiveNative,
          unlockedBalance: latestChain.data.unlockedShares,
        });
        setFirmQuote(firm);
        if (Date.parse(firm.mustSubmitBy) <= Date.now()) {
          setTransaction({ stage: "expired", error: "Executable quote expired before a wallet request could open." });
          return;
        }
        setTransaction({ stage: "wallet" });
        // Once this external wallet request is open it cannot be revoked. Always reconcile a returned hash,
        // even if the firm countdown reaches zero while the wallet is still waiting for the user.
        submittedHash = await sendTransactionAsync({
          account: address,
          data: firm.transaction.data,
          to: firm.transaction.to,
          value: 0n,
        });
      }

      setTransaction({ stage: "confirming", hash: submittedHash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: submittedHash });
      if (receipt.status !== "success") {
        setTransaction({ stage: "reverted", hash: submittedHash, error: "Withdrawal reverted on chain. Review the transaction before retrying." });
        await refreshAfterReceipt();
        return;
      }
      setTransaction({ stage: "success", hash: submittedHash });
      await refreshAfterReceipt();
    } catch (error) {
      const message = errorMessage(error);
      setTransaction({ stage: stageForError(message), hash: submittedHash, error: message });
    }
  }

  function handleAction() {
    if (transaction.stage === "success") {
      setAmount("");
      setQuote(null);
      setFirmQuote(null);
      setTransaction({ stage: "editing" });
      return;
    }
    if (transaction.stage === "expired" || !quoteFresh) {
      setFirmQuote(null);
      setTransaction({ stage: "editing" });
      setQuoteRefresh((value) => value + 1);
      return;
    }
    void executeWithdrawal();
  }

  function changeMode(nextMode: WithdrawalMode) {
    setMode(nextMode);
    setFirmQuote(null);
    setTransaction({ stage: "editing" });
  }

  function setShortcut(percentage: 25 | 50 | 75 | 100) {
    const balance = chainQuery.data?.unlockedShares ?? 0n;
    setAmount(atomicToDecimal(shareShortcut(balance, percentage), lpDecimals));
    setFirmQuote(null);
    setTransaction({ stage: "editing" });
  }

  if (poolQuery.isPending || poolStateQuery.isPending || chainQuery.isPending) {
    return <section className="withdraw-card" aria-live="polite">Loading pool assets and unlocked shares…</section>;
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
      <section className="withdraw-card error-panel" role="alert">
        <h2>Withdrawal data is unavailable</h2>
        <p>{errorMessage(loadError)}</p>
        <button className="secondary-button" type="button" onClick={() => {
          void poolQuery.refetch(); void poolStateQuery.refetch(); void chainQuery.refetch();
        }}>Retry</button>
      </section>
    );
  }

  const mappedOutputs = quote ? mapWithdrawalOutputs(quote, assets) : [];
  const quoteWarnings = quote ? relevantWithdrawalWarnings(quote) : [];
  const indicativeSeconds = quote ? Math.max(0, Math.ceil((Date.parse(quote.validUntil) - now) / 1_000)) : null;
  const firmSeconds = firmQuote ? Math.max(0, Math.ceil((Date.parse(firmQuote.mustSubmitBy) - now) / 1_000)) : null;
  const terminalAction = ["success", "rejected", "expired", "simulation-failed", "reverted", "error"].includes(transaction.stage);
  const actionEnabled = transaction.stage === "success"
    || (terminalAction ? (transaction.stage === "expired" || !quoteFresh ? online : canExecute) : canExecute);

  return (
    <div className="withdraw-layout">
      <section className="withdraw-card withdraw-form" aria-labelledby="withdraw-form-title">
        <div className="mode-tabs" aria-label="Withdrawal mode">
          <button type="button" className={mode === "proportional" ? "is-active" : ""}
            disabled={busy} onClick={() => changeMode("proportional")}>Proportional</button>
          <button type="button" className={mode === "single-asset" ? "is-active" : ""}
            disabled={busy || tradingPaused} onClick={() => changeMode("single-asset")}>Single asset</button>
        </div>

        <div className="asset-input-card">
          <div className="amount-heading">
            <label className="field-label" htmlFor="withdraw-amount">Pool shares</label>
            <span>Unlocked {formatTokenAmount(chainQuery.data?.unlockedShares ?? 0n, lpDecimals)} {poolQuery.data?.lpToken.symbol}</span>
          </div>
          <div className="amount-control withdraw-amount-control">
            <input id="withdraw-amount" inputMode="decimal" placeholder="0.0" disabled={busy}
              value={amount} onChange={(event) => {
                if (/^\d*\.?\d*$/.test(event.target.value)) {
                  setAmount(event.target.value);
                  setFirmQuote(null);
                  setTransaction({ stage: "editing" });
                }
              }} />
            <span>{poolQuery.data?.lpToken.symbol}</span>
          </div>
          <div className="share-shortcuts" aria-label="Pool share shortcuts">
            {([25, 50, 75, 100] as const).map((percentage) => (
              <button key={percentage} type="button" disabled={busy || !chainQuery.data?.unlockedShares}
                onClick={() => setShortcut(percentage)}>{percentage === 100 ? "Max" : `${percentage}%`}</button>
            ))}
          </div>
          {amount && amountError && <p className="field-error">{amountError}</p>}
          {insufficientShares && <p className="field-error">Insufficient unlocked SETWISE balance.</p>}
          {Boolean(chainQuery.data?.lockedShares) && (
            <p className="notice">Locked shares are excluded from Max and cannot be withdrawn. <Link to="/deposit#locked-shares">View locked shares</Link>.</p>
          )}
        </div>

        {mode === "single-asset" && (
          <div className="asset-input-card">
            <span className="field-label">Output asset</span>
            <TokenSelector ariaLabel="Withdrawal asset" chainId={tokenChainId} options={assets} value={effectiveSelectedAssetId} disabled={busy}
              onChange={(nextAssetId) => {
                setSelectedAssetId(nextAssetId);
                setReceiveNative(false);
                setFirmQuote(null);
                setTransaction({ stage: "editing" });
              }} />
            {nativeEligible && (
              <label className="native-toggle">
                <input type="checkbox" checked={effectiveReceiveNative} disabled={busy}
                  onChange={(event) => {
                    setReceiveNative(event.target.checked);
                    setFirmQuote(null);
                    setTransaction({ stage: "editing" });
                  }} />
                <span>Receive native BNB</span>
              </label>
            )}
            {nativeEligible && effectiveReceiveNative && (
              <p className="notice">Receive native BNB, unwrapped from WBNB by the pool in the same withdrawal.</p>
            )}
          </div>
        )}

        {tradingPaused && mode === "single-asset" && (
          <div className="warning-panel" role="alert">
            Trading paused — single-asset withdrawals are unavailable.
            <button className="inline-action" type="button" onClick={() => changeMode("proportional")}>Switch to proportional</button>
          </div>
        )}
        {tradingPaused && mode === "proportional" && (
          <div className="notice">Trading is paused, but direct proportional withdrawals remain available.</div>
        )}
        {!online && <div className="warning-panel">Offline — reconnect to price or submit a withdrawal.</div>}
        {quoteError && <div className="error-panel" role="alert">{quoteError}</div>}
        {quoteWarnings.length > 0 && (
          <div className="notice quote-warnings" role="note">
            <strong>Market disclosures</strong>
            <ul>
              {quoteWarnings.map((warning) => <li key={`${warning.code}:${warning.message}`}>{warning.message}</li>)}
            </ul>
          </div>
        )}

        {firmSeconds !== null && transaction.stage === "wallet" && (
          <div className={firmSeconds <= 3 ? "firm-countdown is-warning" : "firm-countdown"} role="status">
            Confirm in wallet within <strong>{firmSeconds}s</strong>
          </div>
        )}
        <button className="primary-button withdraw-action" type="button" disabled={!actionEnabled} onClick={handleAction}>
          {quoteLoading ? "Refreshing estimate…" : transactionLabel(transaction.stage, mode)}
        </button>
        {transaction.error && <div className="error-panel" role="alert">{transaction.error}</div>}
        {transaction.hash && (
          <p className="transaction-link">Transaction <a href={`${runtimeConfig.explorerUrl}/tx/${transaction.hash}`}
            target="_blank" rel="noreferrer">{truncateAddress(transaction.hash)}</a></p>
        )}
        <p className="quote-note">No token approval is needed. The pool burns unlocked SETWISE shares directly from your wallet.</p>
      </section>

      <aside className="withdraw-card quote-card" aria-live="polite">
        <div className="quote-title"><h2 id="withdraw-form-title">Withdrawal estimate</h2>{quoteLoading && <span>Refreshing</span>}</div>
        {quote ? (
          <>
            <div className="quote-share">
              <span>Estimated output value</span>
              <strong>{totalOutputUsd(quote) ?? "Price unavailable"}</strong>
            </div>
            <div className="withdraw-outputs">
              {mappedOutputs.map(({ asset, output }) => (
                <div className="withdraw-output" key={asset.id}>
                  {effectiveReceiveNative && asset.id === effectiveSelectedAssetId
                    ? <div><strong>BNB</strong><span>Native BNB</span></div>
                    : <TokenIdentity asset={asset} chainId={tokenChainId} />}
                  <div><strong>{output.amount}</strong><span>{outputUsd(quote, output) ?? "USD estimate unavailable"}</span></div>
                </div>
              ))}
            </div>
            <dl className="quote-details">
              <div><dt>Mode</dt><dd>{mode === "proportional" ? "Every pool asset" : effectiveReceiveNative ? "Single asset · native BNB" : "Single asset"}</dd></div>
              <div><dt>Indicative freshness</dt><dd>{quoteFresh ? `${indicativeSeconds ?? 0}s` : "Refreshing…"}</dd></div>
              {firmSeconds !== null && <div className={firmSeconds <= 3 ? "is-warning" : ""}><dt>Firm quote</dt><dd>Confirm within {firmSeconds}s</dd></div>}
            </dl>
            <p className="quote-note">{mode === "proportional"
              ? "This estimate executes through a simulated direct contract call and never requests a firm quote."
              : "The executable signed quote is requested only after you review this estimate."}</p>
          </>
        ) : <p>{quoteLoading ? "Getting an indicative price…" : "Enter a pool-share amount to preview your outputs."}</p>}
      </aside>
    </div>
  );
}
