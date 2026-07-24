import { Activity, X } from "lucide-react";

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.google.android.apps.fitness";
const APP_STORE_URL = "https://apps.apple.com/app/id1433864494";

export default function GoogleFitOnboarding({
  onConnect,
  onClose,
}: {
  onConnect: () => void;
  onClose: () => void;
}) {
  const openStore = (url: string) => {
    if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(url);
    else window.open(url, "_blank");
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Закрыть">
          <X size={18} />
        </button>
        <Activity size={32} className="modal-icon" />
        <h2>Подключи Google Fit</h2>
        <p>
          Питомец растёт от твоих реальных шагов. Чтобы шаги начали засчитываться, подключи
          Google Fit — это займёт полминуты.
        </p>
        <button type="button" className="modal-primary-btn" onClick={onConnect}>
          <Activity size={16} /> Подключить Google Fit
        </button>
        <div className="modal-install-hint">
          <span>Нет приложения Google Fit?</span>
          <div className="modal-install-links">
            <button type="button" onClick={() => openStore(PLAY_STORE_URL)}>
              Google Play
            </button>
            <button type="button" onClick={() => openStore(APP_STORE_URL)}>
              App Store
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
