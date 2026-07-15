export function ActivityPage() {
  return (
    <div className="screen">
      <header className="screen-header">
        <p className="eyebrow">Local record</p>
        <h1>Activity</h1>
        <p>This will show locally submitted Setwise testnet transactions, not complete account history.</p>
      </header>
      <section className="empty-card">
        <div className="empty-mark" aria-hidden="true">S</div>
        <h2>No activity yet</h2>
        <p>Completed and pending prototype transactions will appear here.</p>
      </section>
    </div>
  );
}
