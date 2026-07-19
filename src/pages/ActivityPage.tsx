import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { runtimeConfig } from "../config/env";
import { readActivity, subscribeToActivity } from "../features/activity/store";
import { truncateAddress } from "../lib/format";

export function ActivityPage() {
  const [records, setRecords] = useState(readActivity);
  useEffect(() => subscribeToActivity(() => setRecords(readActivity())), []);

  return (
    <div className="screen">
      <header className="screen-header">
        <p className="eyebrow">Local record</p>
        <h1>Activity</h1>
        <p>This will show locally submitted Setwise testnet transactions, not complete account history.</p>
      </header>
      {records.length === 0 ? (
        <section className="empty-card">
          <div className="empty-mark" aria-hidden="true">S</div>
          <h2>No activity yet</h2>
          <p>Completed and failed prototype swaps will appear here.</p>
          <Link className="secondary-link" to="/swap">Try a swap</Link>
        </section>
      ) : (
        <section className="activity-list" aria-label="Local activity">
          {records.map((record) => (
            <article className="activity-card" key={record.id}>
              <div className="activity-heading">
                <div>
                  <p className="eyebrow">Swap</p>
                  <h2>{record.input.symbol} → {record.output.symbol}</h2>
                </div>
                <span className={`activity-status activity-status--${record.status}`}>{record.status}</span>
              </div>
              <dl className="quote-details">
                <div><dt>Paid</dt><dd>{record.input.amount} {record.input.symbol}</dd></div>
                <div><dt>Received</dt><dd>{record.output.amount} {record.output.symbol}</dd></div>
                <div><dt>Submitted</dt><dd>{new Date(record.timestamp).toLocaleString()}</dd></div>
              </dl>
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
