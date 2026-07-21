import { Link, NavLink, Navigate, Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { SET_TABS, setPath, setsPath } from "../../app/routes";
import { requiredChainId } from "../../config/chains";
import { setQueryKeys } from "../../data/queryKeys";
import { getPools } from "../../data/rfq/pools";
import { resolveSet } from "../../data/sets";

export function SetDetailLayout() {
  const { setId: rawSetId } = useParams<{ setId: string }>();
  const setId = rawSetId ? decodeURIComponent(rawSetId) : "";

  const poolsQuery = useQuery({
    queryKey: setQueryKeys.list,
    queryFn: ({ signal }) => getPools(signal),
    staleTime: 60_000,
  });

  const resolution = resolveSet(setId, poolsQuery.data, requiredChainId);

  if (!setId) {
    return <Navigate to={setsPath()} replace />;
  }

  if (resolution.status === "loading" || poolsQuery.isPending) {
    return (
      <div className="screen set-detail-screen">
        <section className="prototype-card" aria-live="polite">Loading Set…</section>
      </div>
    );
  }

  if (poolsQuery.error) {
    return (
      <div className="screen set-detail-screen">
        <section className="prototype-card error-panel" role="alert">
          <h1>Set unavailable</h1>
          <p>{poolsQuery.error instanceof Error ? poolsQuery.error.message : "RFQ registry unavailable"}</p>
          <button className="secondary-button" type="button" onClick={() => void poolsQuery.refetch()}>
            Retry
          </button>
          <Link className="secondary-link" to={setsPath()}>Back to Sets</Link>
        </section>
      </div>
    );
  }

  if (resolution.status === "not-found") {
    return (
      <div className="screen set-detail-screen">
        <section className="empty-card" role="alert">
          <div className="empty-mark" aria-hidden="true">?</div>
          <h1>Unknown Set</h1>
          <p>
            No Set with id <code>{resolution.poolId}</code> appears in the RFQ registry.
          </p>
          <Link className="secondary-link" to={setsPath()}>Browse Sets</Link>
        </section>
      </div>
    );
  }

  const definition = resolution.definition;
  const unsupported = resolution.status === "unsupported-chain";

  return (
    <div className="screen set-detail-screen">
      <header className="screen-header">
        <p className="eyebrow">{definition.chainName ?? `Chain ${definition.chainId}`}</p>
        <h1>{definition.id}</h1>
        <p>
          {unsupported
            ? "This Set is listed in the registry but is not executable on the current app chain."
            : "Review this Set, deposit liquidity, or withdraw unlocked shares. Swaps stay on the standalone Swap page."}
        </p>
      </header>

      {unsupported && (
        <aside className="warning-panel" role="status">
          <strong>Unsupported chain.</strong>
          {" "}
          Overview remains visible for discovery. Deposit and withdraw stay disabled until this chain is supported.
        </aside>
      )}

      <nav className="set-tabs" aria-label="Set sections">
        {SET_TABS.map(({ label, tab }) => (
          <NavLink
            key={tab}
            to={setPath(definition.id, tab)}
            className={({ isActive }) => (isActive ? "set-tab is-active" : "set-tab")}
            end
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ definition, unsupported }} />
    </div>
  );
}
