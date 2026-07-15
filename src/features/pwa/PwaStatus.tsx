import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}

export function PwaStatus() {
  const online = useOnlineStatus();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();

  return (
    <>
      {!online && (
        <div className="status-banner status-banner--warning" role="status">
          Offline — pricing and transactions are unavailable.
        </div>
      )}
      {needRefresh && (
        <div className="status-banner status-banner--info" role="status">
          <span>A new version of Setwise is available.</span>
          <span className="banner-actions">
            <button type="button" onClick={() => void updateServiceWorker(true)}>Reload</button>
            <button type="button" onClick={() => setNeedRefresh(false)}>Later</button>
          </span>
        </div>
      )}
      {offlineReady && (
        <div className="status-banner status-banner--info" role="status">
          <span>Setwise is ready for a safe read-only offline launch.</span>
          <button type="button" onClick={() => setOfflineReady(false)}>Dismiss</button>
        </div>
      )}
    </>
  );
}
