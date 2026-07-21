import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { setPath } from "../app/routes";
import { runtimeConfig } from "../config/env";
import {
  readActivity,
  subscribeToActivity,
  type ActivityAmount,
  type ActivityRecord,
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
          <div><dt>Set</dt><dd><SetLink setId={record.setId} /></dd></div>
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
      <dl className="quote-details">
        {record.setId && <div><dt>Set</dt><dd><SetLink setId={record.setId} /></dd></div>}
        <div><dt>Paid</dt><dd>{record.input.amount} {record.input.symbol}</dd></div>
        <div><dt>Received</dt><dd>{record.output.amount} {record.output.symbol}</dd></div>
        <div><dt>{timestampLabel(record)}</dt><dd><time dateTime={new Date(record.timestamp).toISOString()}>{new Date(record.timestamp).toLocaleString()}</time></dd></div>
      </dl>
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
        <h1>Activity</h1>
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
                <span className={`activity-status activity-status--${record.status}`}>{record.status}</span>
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
