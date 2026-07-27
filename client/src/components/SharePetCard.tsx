import { useState } from "react";
import { Share2, Sparkles } from "lucide-react";
import { petCardUrl, preparePetCardShare, sendPetCardToChat, type Pet } from "../lib/api";

const STORY_TEXT = "Мой питомец растёт от реальных шагов 🐾";

/** Sharing the pet card, in whichever way this Telegram client actually supports.
 *
 *  Three routes, best first. `shareMessage` (Bot API 8.0) opens Telegram's own chat picker for a
 *  message the server staged, which is the only one that lets the player choose where it lands.
 *  Failing that the card is sent to their chat with the bot, from where they can forward it — not
 *  as direct, but it asks nothing of the client version. `shareToStory` (Bot API 7.8) is a
 *  separate destination rather than a fallback, so it sits as its own button and simply isn't
 *  offered on clients that lack it. */
export default function SharePetCard({ pet, onToast }: { pet: Pet; onToast: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const webApp = window.Telegram?.WebApp;
  const atLeast = (version: string) => webApp?.isVersionAtLeast?.(version) ?? false;
  const canStory = Boolean(webApp?.shareToStory) && atLeast("7.8");

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (webApp?.shareMessage && atLeast("8.0")) {
        const { preparedMessageId } = await preparePetCardShare();
        webApp.shareMessage(preparedMessageId);
      } else {
        await sendPetCardToChat();
        onToast("📨 Карточка отправлена в чат с ботом — перешлите её кому угодно");
      }
    } catch (err) {
      onToast(`😕 Не получилось поделиться: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const shareToStory = () => {
    // Telegram fetches this URL itself, so nothing is uploaded from here.
    webApp?.shareToStory?.(petCardUrl(pet, "story"), { text: STORY_TEXT });
  };

  return (
    <div className="share-card-row">
      <button type="button" className="share-card-btn" onClick={share} disabled={busy}>
        <Share2 size={15} /> {busy ? "Готовим карточку…" : "Поделиться питомцем"}
      </button>
      {canStory && (
        <button type="button" className="share-card-btn secondary" onClick={shareToStory} aria-label="Поделиться в истории">
          <Sparkles size={15} /> В историю
        </button>
      )}
    </div>
  );
}
