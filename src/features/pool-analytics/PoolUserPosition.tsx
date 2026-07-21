import { useAppKit } from "@reown/appkit/react";
import { useSwitchChain } from "wagmi";

import "./PoolUserPosition.css";

import type { Pool, PoolState } from "../../data/rfq/deposits";
import { formatTokenAmount } from "../../lib/decimal";
import {
  calculateOwnershipPercentage,
  calculateUserLiquidityValue,
  calculateWalletAssetUsdValue,
  formatDecimalRatio,
  type Calculation,
  type DecimalRatio,
} from "./model";
import { useWalletPoolPosition } from "../wallet/useWalletPoolPosition";

type PoolUserPositionProps = { pool: Pool | undefined; poolState: PoolState | undefined };
type MetricProps = { label: string; value: string };

function Metric({ label, value }: MetricProps) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatUsd(value: DecimalRatio): string {
  const formatted = formatDecimalRatio(value, 2);
  const [integer, fraction] = formatted.split(".");
  return `~$${(integer ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction ?? "00"}`;
}

function formatCalculation(value: Calculation, formatter: (ratio: DecimalRatio) => string): string {
  return value.status === "available" ? formatter(value.value) : "Unavailable";
}

function unlockStatus(locked: bigint, lockedUntil: bigint, canClaim: boolean): string {
  if (locked === 0n) return "No locked shares";
  if (canClaim) return "Claimable now";
  if (lockedUntil === 0n) return "Locked";
  return `Unlocks ${new Date(Number(lockedUntil) * 1_000).toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  })}`;
}

function ConnectPrompt() {
  const { open } = useAppKit();
  return (
    <section className="pool-user-card pool-user-card--prompt" aria-labelledby="pool-user-connect-title">
      <p className="eyebrow">Your Set position</p>
      <h2 id="pool-user-connect-title">Connect to view your balances</h2>
      <p>Set information remains available while your wallet is disconnected.</p>
      <button className="secondary-button" type="button" onClick={() => void open({ view: "Connect" })}>Connect wallet</button>
    </section>
  );
}

function WrongNetwork({ actualChainId, expectedChainId }: { actualChainId: number; expectedChainId: number }) {
  const switchChain = useSwitchChain();
  return (
    <section className="pool-user-card" aria-labelledby="pool-user-network-title">
      <p className="eyebrow eyebrow--critical">Your Set position</p>
      <h2 id="pool-user-network-title">Switch to BSC Testnet</h2>
      <p>Your wallet is connected to chain {actualChainId}; this Set uses chain {expectedChainId}.</p>
      <button className="secondary-button" type="button" disabled={switchChain.isPending} onClick={() => switchChain.switchChain({ chainId: expectedChainId })}>
        {switchChain.isPending ? "Switching network…" : "Switch network"}
      </button>
    </section>
  );
}

function LoadingState() {
  return (
    <section className="pool-user-card" aria-busy="true" aria-label="Loading wallet position">
      <p className="eyebrow">Your Set position</p>
      <h2>Loading wallet balances…</h2>
      <p>Reading your balances at the current Set snapshot.</p>
    </section>
  );
}

/** Connected-user content that can sit beside public pool data without blocking it. */
export function PoolUserPosition({ pool, poolState }: PoolUserPositionProps) {
  const { state } = useWalletPoolPosition(pool, poolState);
  if (state.status === "disconnected") return <ConnectPrompt />;
  if (state.status === "wrong-network") return <WrongNetwork actualChainId={state.actualChainId} expectedChainId={state.expectedChainId} />;
  if (state.status === "loading") return <LoadingState />;
  if (state.status === "rpc-error" || state.status === "context-error") {
    return <section className="pool-user-card pool-user-card--error" role="alert" aria-labelledby="pool-user-error-title">
      <p className="eyebrow eyebrow--critical">Your Set position</p><h2 id="pool-user-error-title">Wallet balances are unavailable</h2>
      <p>{state.error.message}. Public Set data is still up to date.</p>
    </section>;
  }
  if (!pool || !poolState) return <LoadingState />;

  const { position } = state;
  const ownership = calculateOwnershipPercentage(position.shares.totalAttributed, poolState.totalSupply);
  const liquidityValue = calculateUserLiquidityValue({ attributedSharesAtomic: position.shares.totalAttributed, state: poolState });
  const stateByAsset = new Map(poolState.assets.map((asset) => [asset.asset, asset]));
  const balanceByAsset = new Map(position.assetBalances.map((balance) => [balance.assetId, balance.balance]));
  const wrappedNativeToken = poolState.contract?.wrappedNativeToken?.toLowerCase();
  const wrappedNativeAsset = pool.assets.find((asset) => asset.address.toLowerCase() === wrappedNativeToken);
  const nativeMarket = wrappedNativeAsset ? stateByAsset.get(wrappedNativeAsset.id)?.market : undefined;
  const nativeValue = nativeMarket ? calculateWalletAssetUsdValue({ balanceAtomic: position.nativeBalance, market: nativeMarket, tokenDecimals: 18 }) : undefined;

  return <section className="pool-user-section" aria-label="Your Set position and wallet balances">
    <article className="pool-user-card">
      <div className="pool-user-heading"><div><p className="eyebrow">Your Set position</p><h2>Liquidity position</h2></div><span className="estimate-label">Estimated</span></div>
      {state.status === "zero-balance" && <p className="pool-user-empty">You do not hold Set shares or supported assets in this wallet yet.</p>}
      <dl className="pool-user-metrics">
        <Metric label="Liquidity value" value={formatCalculation(liquidityValue, formatUsd)} />
        <Metric label="Ownership" value={formatCalculation(ownership, (value) => `${formatDecimalRatio(value, 4)}%`)} />
        <Metric label={`Total ${pool.lpToken.symbol} shares`} value={formatTokenAmount(position.shares.totalAttributed, pool.lpToken.decimals)} />
        <Metric label="Unlocked shares" value={formatTokenAmount(position.shares.unlocked, pool.lpToken.decimals)} />
        <Metric label="Locked shares" value={formatTokenAmount(position.shares.locked, pool.lpToken.decimals)} />
        <Metric label="Lock status" value={unlockStatus(position.shares.locked, position.shares.lockedUntil, position.shares.canClaim)} />
      </dl>
      <p className="estimate-note">Liquidity value includes unlocked and locked shares. It is an estimate, not a withdrawal quote.</p>
    </article>
    <article className="pool-user-card">
      <div className="pool-user-heading"><div><p className="eyebrow">Your wallet</p><h2>Supported assets</h2></div><span className="estimate-label">USD estimates</span></div>
      <ul className="wallet-balance-list">
        {pool.assets.map((asset) => {
          const balance = balanceByAsset.get(asset.id) ?? 0n;
          const assetState = stateByAsset.get(asset.id);
          const usdValue = assetState ? calculateWalletAssetUsdValue({ balanceAtomic: balance, market: assetState.market, tokenDecimals: asset.decimals }) : undefined;
          return <li key={asset.id}><span>{asset.symbol}</span><strong>{formatTokenAmount(balance, asset.decimals)}</strong><small>{usdValue ? formatUsd(usdValue) : "Price unavailable"}</small></li>;
        })}
        <li className="wallet-balance-list__native"><span>BNB <small>Gas</small></span><strong>{formatTokenAmount(position.nativeBalance, 18)}</strong><small>{nativeValue ? formatUsd(nativeValue) : "Price unavailable"}</small></li>
      </ul>
      <p className="estimate-note">Wallet assets are separate from your Set liquidity. BNB receives a USD estimate only when a reliable wrapped-BNB pool price is available.</p>
    </article>
  </section>;
}
