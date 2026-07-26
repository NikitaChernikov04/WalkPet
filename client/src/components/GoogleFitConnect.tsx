import { Activity, RefreshCw } from "lucide-react";

export default function GoogleFitConnect({
  connected,
  syncing,
  onConnect,
  onSync,
}: {
  connected: boolean | null;
  syncing: boolean;
  onConnect: () => void;
  onSync: () => void;
}) {
  if (connected === null) return null;

  // Steps arrive on Google's own schedule, so the automatic poll can still feel like a wait.
  // The status pill doubles as a "pull it in now" button rather than leaving the player with
  // nothing to do but stare at an unchanged number.
  if (connected) {
    return (
      <button
        type="button"
        className="google-fit-status"
        onClick={onSync}
        disabled={syncing}
        aria-label="Обновить шаги из Google Fit"
      >
        <Activity size={14} /> Google Fit подключён
        <RefreshCw size={13} className={syncing ? "gf-refresh spinning" : "gf-refresh"} />
      </button>
    );
  }

  return (
    <button type="button" className="google-fit-connect-btn" onClick={onConnect}>
      <Activity size={14} /> Подключить Google Fit
    </button>
  );
}
