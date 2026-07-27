import { useEffect, useState } from "react";
import { Copy, Gift, Share2, UserPlus, Users } from "lucide-react";
import { fetchReferrals, petImageUrl, type ReferralSummary } from "../lib/api";
import { shortHandle } from "../lib/handle";

const SHARE_TEXT =
  "Я выгуливаю питомца в WalkPet — он растёт от моих реальных шагов. " +
  "Заходи по ссылке, и твоё яйцо начнёт трескаться сразу 🥚";

/** Opens Telegram's native share sheet. openTelegramLink keeps the user inside the app instead
 *  of bouncing them out to a browser, which openLink would do. */
function shareLink(link: string) {
  const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(SHARE_TEXT)}`;
  if (window.Telegram?.WebApp?.openTelegramLink) window.Telegram.WebApp.openTelegramLink(url);
  else window.open(url, "_blank");
}

export default function ReferralPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<ReferralSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchReferrals()
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  const copy = () => {
    if (!data) return;
    navigator.clipboard
      ?.writeText(data.link)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  };

  if (error) return <div className="panel referral-panel">Ошибка: {error}</div>;
  if (!data) return <div className="panel referral-panel">Загрузка…</div>;

  return (
    <div className="panel referral-panel">
      <header className="referral-head">
        <h2>
          <UserPlus size={20} /> Пригласи друга
        </h2>
        <button type="button" className="referral-close" onClick={onClose}>
          Назад
        </button>
      </header>

      <p className="referral-copy">
        Другу — яйцо, которое трескается сразу. Тебе — новая ступень облика питомца, как только он
        вылупит своего.
      </p>

      <div className="referral-link-row">
        <code className="referral-code">{data.code}</code>
        <button type="button" className="referral-copy-btn" onClick={copy}>
          <Copy size={14} /> {copied ? "Скопировано" : "Копировать"}
        </button>
      </div>

      <button type="button" className="referral-share-btn" onClick={() => shareLink(data.link)}>
        <Share2 size={16} /> Поделиться ссылкой
      </button>

      <div className="referral-stats">
        <div>
          <Users size={16} />
          <strong>{data.invitedCount}</strong>
          <span>приглашено</span>
        </div>
        <div>
          <Gift size={16} />
          <strong>
            {data.bonusTiers}/{data.maxBonusTiers}
          </strong>
          <span>ступеней получено</span>
        </div>
      </div>

      {data.invitedByUsername && (
        <p className="referral-inviter">Тебя пригласил @{data.invitedByUsername}</p>
      )}

      {data.invited.length === 0 ? (
        <p className="referral-empty">Пока никого. Отправь ссылку — награда придёт, когда друг вылупит питомца.</p>
      ) : (
        <ul className="referral-list">
          {data.invited.map((friend) => (
            <li key={friend.userId} className={friend.rewardGranted ? "confirmed" : ""}>
              {friend.hatched && friend.avatarGenerationId ? (
                <img src={petImageUrl(friend.userId, friend.avatarGenerationId)} alt="" loading="lazy" />
              ) : (
                <span className="referral-egg">🥚</span>
              )}
              <div className="referral-friend-text">
                <strong>{friend.petName ?? (friend.hatched ? friend.species : "Яйцо")}</strong>
                <span>
                  {shortHandle(friend.username, friend.userId)}
                  {friend.hatched ? ` · ур. ${friend.level}` : " · ещё не вылупился"}
                </span>
              </div>
              {friend.rewardGranted && <Gift size={14} className="referral-granted" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
