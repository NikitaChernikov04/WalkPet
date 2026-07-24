import { Activity } from "lucide-react";

export default function GoogleFitConnect({
  connected,
  onConnect,
}: {
  connected: boolean | null;
  onConnect: () => void;
}) {
  if (connected === null) return null;

  if (connected) {
    return (
      <div className="google-fit-status">
        <Activity size={14} /> Google Fit подключён
      </div>
    );
  }

  return (
    <button type="button" className="google-fit-connect-btn" onClick={onConnect}>
      <Activity size={14} /> Подключить Google Fit
    </button>
  );
}
