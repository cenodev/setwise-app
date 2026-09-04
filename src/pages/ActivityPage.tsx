import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Hash } from "viem";

import { setPath } from "../app/routes";
import { getRoutedSwapNetwork } from "../config/chains";
import { explorerTxUrl } from "../config/explorers";
import { runtimeConfig } from "../config/env";
import {
  readActivity,
  subscribeToActivity,
  type ActivityAmount,
  type ActivityRecord,
  type RoutedSwapLifecycle,
  type SwapActivityRecord,
} from "../features/activity/store";
import { truncateAddress } from "../lib/format";

function amountList(amounts: ActivityAmount[]): string {
  return amounts.map((amount) => `${amount.amount} ${amount.symbol}`).join(", ");
}

function modeLabel(mode: string): string {
  return mode.replace("-", " ");
}

function timestampLabel(record: ActivityRecord): string {
  const submitted = record.submitted ?? Boolean(record.hash || record.status === "success");
  return submitted ? "Submitted" : "Attempted";
}

function chainLabel(chainId: number): string {
  return getRoutedSwapNetwork(chainId)?.name ?? `Chain ${chainId}`;
}

function statusLabel(record: ActivityRecord): string {
  if (record.operation === "swap" && record.routed) return record.routed.lifecycle;
  return record.status;
}

/**
 * The routed settlement line. Only `delivered` claims receipt of the
 * destination token; partial, refunded, failed, and unknown outcomes say so
 * explicitly instead.
 */
function routedSettlementLabel(lifecycle: RoutedSwapLifecycle): string {
  switch (lifecycle) {
    case "delivered": return "Received";
    case "partially-delivered": return "Partially delivered — the full output was not received";
    case "refunded": return "Refunded to the source wallet — destination token not received";
    case "failed": return "Not delivered";
    case "unknown": return "Settlement status unknown — destination token receipt unconfirmed";
    case "destination-pending": return "Settling on the destination chain";
    case "source-submitted": return "Confirming on the source chain";
    case "prepared": return "Waiting for wallet submission";
  }
}

function RoutedSwapDetails({ record }: { record: SwapActivityRecord }) {
  const routed = record.routed;
  if (!routed) return null;
  const delivered = routed.lifecycle === "delivered";
  const links: { hash: Hash; label: string; chainId: number }[] = [];
  if (routed.approvalHash) {
    links.push({ chainId: record.chainId, hash: routed.approvalHash, label: "Approval" });
  }
  if (record.hash) {
    links.push({ chainId: record.chainId, hash: record.hash, label: "Source" });
  }
  if (routed.destinationHash) {
    links.push({ chainId: routed.destinationChainId, hash: routed.destinationHash, label: "Destination" });
  }
  return (
    <dl className="quote-details">
      <div><dt>Route provider</dt><dd>{routed.routeProvider}</dd></div>
      <div><dt>Quote</dt><dd>{routed.quoteId}</dd></div>
      <div><dt>Paid</dt><dd>{record.input.amount} {record.input.symbol} on {chainLabel(record.chainId)}</dd></div>
      <div>
        <dt>{routedSettlementLabel(routed.lifecycle)}</dt>
        <dd>
          {delivered
            ? `${record.output.amount} ${record.output.symbol} on ${chainLabel(routed.destinationChainId)}`
            : `${record.output.amount} ${record.output.symbol} expected on ${chainLabel(routed.destinationChainId)}`}
        </dd>
      </div>
      {routed.providerDetail && <div><dt>Provider detail</dt><dd>{routed.providerDetail}</dd></div>}
      <div>
        <dt>{timestampLabel(record)}</dt>
        <dd><time dateTime={new Date(record.timestamp).toISOString()}>{new Date(record.timestamp).toLocaleString()}</time></dd>
      </div>
      {links.length > 0 && (
        <div>
          <dt>Transactions</dt>
          <dd>
            {links.map(({ chainId, hash, label }) => {
              const href = explorerTxUrl(chainId, hash) ?? `${runtimeConfig.explorerUrl}/tx/${hash}`;
              return (
                <a key={`${label}-${hash}`} href={href} target="_blank" rel="noreferrer">
                  {label} {truncateAddress(hash)}
                </a>
              );
            })}
          </dd>
        </div>
      )}
    </dl>
  );
}

function SetLink({ setId }: { setId: string }) {
  return <Link to={setPath(setId, "overview")}>{setId}</Link>;
}

function ActivityDetails({ record }: { record: ActivityRecord }) {
  if (record.operation === "deposit") {
    return (
      <>
        <h2 id={`activity-${record.id}`}>{record.deposits.map((amount) => amount.symbol).join(" + ")} → {record.shares.symbol}</h2>
        <dl className="quote-details">
          <div><dt>Set</dt><dd><SetLink setId={record.setId} /></dd></div>
          <div><dt>Mode</dt><dd>{modeLabel(record.mode)}</dd></div>
          <div><dt>Deposited</dt><dd>{amountList(record.deposits)}</dd></div>
          <div><dt>Shares received</dt><dd>{record.shares.amount} {record.shares.symbol}</dd></div>
          <div><dt>Lock period</dt><dd>{record.lockDays === 0 ? "None" : `${record.lockDays} days`}</dd></div>
          <div><dt>{timestampLabel(record)}</dt><dd><time dateTime={new Date(record.timestamp).toISOString()}>{new Date(record.timestamp).toLocaleString()}</time></dd></div>
        </dl>
      </>
    );
  }
  if (record.operation === "withdrawal") {
    return (
      <>
        <h2 id={`activity-${record.id}`}>{record.shares.symbol} → {record.outputs.map((amount) => amount.symbol).join(" + ")}</h2>
        <dl className="quote-details">
          {record.setId && <div><dt>Set</dt><dd><SetLink setId={record.setId} /></dd></div>}
          <div><dt>Mode</dt><dd>{modeLabel(record.mode)}</dd></div>
          <div><dt>Shares burned</dt><dd>{record.shares.amount} {record.shares.symbol}</dd></div>
          <div><dt>Assets received</dt><dd>{amountList(record.outputs)}</dd></div>
          <div><dt>{timestampLabel(record)}</dt><dd><time dateTime={new Date(record.timestamp).toISOString()}>{new Date(record.timestamp).toLocaleString()}</time></dd></div>
        </dl>
      </>
    );
  }
  return (
    <>
      <h2 id={`activity-${record.id}`}>{record.input.symbol} → {record.output.symbol}</h2>
      {record.routed ? <RoutedSwapDetails record={record} /> : (
        <dl className="quote-details">
          {record.setId && <div><dt>Set</dt><dd><SetLink setId={record.setId} /></dd></div>}
          <div><dt>Paid</dt><dd>{record.input.amount} {record.input.symbol}</dd></div>
          <div><dt>Received</dt><dd>{record.output.amount} {record.output.symbol}</dd></div>
          <div><dt>{timestampLabel(record)}</dt><dd><time dateTime={new Date(record.timestamp).toISOString()}>{new Date(record.timestamp).toLocaleString()}</time></dd></div>
        </dl>
      )}
    </>
  );
}

function operationLabel(record: ActivityRecord): string {
  if (record.operation === "withdrawal") return "Withdrawal";
  return record.operation === "deposit" ? "Deposit" : "Swap";
}

export function ActivityPage() {
  const [records, setRecords] = useState(readActivity);
  useEffect(() => subscribeToActivity(() => setRecords(readActivity())), []);

  return (
    <div className="screen">
      <header className="screen-header">
        <p className="eyebrow">Local record</p>
        <h1>History</h1>
        <p>This shows Setwise transactions submitted from this browser, not complete on-chain account history.</p>
      </header>
      {records.length === 0 ? (
        <section className="empty-card">
          <div className="empty-mark" aria-hidden="true">S</div>
          <h2>No activity yet</h2>
          <p>Deposits, withdrawals, and swaps submitted from this browser will appear here.</p>
          <Link className="secondary-link" to="/sets">Explore Sets</Link>
        </section>
      ) : (
        <section className="activity-list" aria-label="Local activity">
          {records.map((record) => (
            <article className="activity-card" key={record.id} aria-labelledby={`activity-${record.id}`}>
              <div className="activity-heading">
                <div>
                  <p className="eyebrow">{operationLabel(record)}</p>
                  <ActivityDetails record={record} />
                </div>
                <span className={`activity-status activity-status--${record.status}`}>{statusLabel(record)}</span>
              </div>
              {record.error && <p className="field-error">{record.error}</p>}
              {record.hash && (
                <a href={`${runtimeConfig.explorerUrl}/tx/${record.hash}`} target="_blank" rel="noreferrer">
                  View {truncateAddress(record.hash)} on explorer
                </a>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
