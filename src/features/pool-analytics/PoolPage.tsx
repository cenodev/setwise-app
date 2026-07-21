import type { Pool, PoolState } from "../../data/rfq/deposits";
import { useOnlineStatus } from "../../lib/useOnlineStatus";
import { PoolOverviewPage } from "./PoolOverviewPage";
import { PoolUserPosition } from "./PoolUserPosition";

export const POOL_STATE_REFRESH_INTERVAL_MS = 15_000;

export type PoolPageProps = {
  error: Error | null;
  loading: boolean;
  onRetry: () => void;
  pool: Pool | undefined;
  poolState: PoolState | undefined;
  refreshing: boolean;
  showWalletPosition: boolean;
};

export function PoolPage({
  error,
  loading,
  onRetry,
  pool,
  poolState,
  refreshing,
  showWalletPosition,
}: PoolPageProps) {
  const online = useOnlineStatus();
  const hasPublicSnapshot = Boolean(pool && poolState);

  return (
    <div className="pool-page">
      {!online && hasPublicSnapshot && (
        <aside className="warning-panel pool-stale-notice" role="status">
          <strong>You’re offline.</strong> Showing the most recently saved Set snapshot and wallet estimate.
        </aside>
      )}
      {online && hasPublicSnapshot && error && (
        <aside className="warning-panel pool-stale-notice" role="status">
          <strong>Live refresh failed.</strong> The last complete Set snapshot remains visible.
          <button className="inline-action" onClick={onRetry} type="button">Retry refresh</button>
        </aside>
      )}
      <PoolOverviewPage
        error={error}
        loading={loading}
        onRetry={onRetry}
        online={online}
        pool={pool}
        refreshing={refreshing}
        state={poolState}
      />
      <aside className="pool-liquidity-note" role="note">
        <strong>Set reserves are not market depth.</strong>
        <span>Usable balances describe assets held by the Set&apos;s underlying liquidity pool. External venue liquidity and executable prices may differ.</span>
      </aside>
      {showWalletPosition
        ? <PoolUserPosition pool={pool} poolState={poolState} />
        : (
          <section className="pool-user-card" role="status">
            <p className="eyebrow">Your Set position</p>
            <h2>Wallet position unavailable on this chain</h2>
            <p>Public Set data remains visible, but wallet reads are disabled for unsupported chains.</p>
          </section>
        )}
    </div>
  );
}
