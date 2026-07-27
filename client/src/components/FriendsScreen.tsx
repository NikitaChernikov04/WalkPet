import { useEffect, useState } from "react";
import { Footprints, Globe, Trophy, Users } from "lucide-react";
import { fetchSocial, petImageUrl, type PlayerRow, type SocialSnapshot } from "../lib/api";

type Tab = "friends" | "global";

const MEDALS = ["🥇", "🥈", "🥉"];

function weekLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const from = new Date(y, m - 1, d);
  const to = new Date(y, m - 1, d + 6);
  const fmt = (date: Date) => date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return `${fmt(from)} — ${fmt(to)}`;
}

function PlayerCard({ player, place }: { player: PlayerRow; place: number }) {
  return (
    <li className={player.isMe ? "player-row me" : "player-row"}>
      <span className="player-place">{MEDALS[place - 1] ?? place}</span>

      {player.hatched && player.avatarGenerationId ? (
        <img
          className={`player-avatar rarity-${player.rarity}`}
          src={petImageUrl(player.userId, player.avatarGenerationId)}
          alt=""
          loading="lazy"
        />
      ) : (
        <span className="player-avatar player-egg">🥚</span>
      )}

      <div className="player-text">
        <strong>{player.petName ?? (player.hatched ? player.species : "Яйцо")}</strong>
        <span>
          {player.username ? `@${player.username}` : `Игрок #${player.userId}`}
          {player.hatched ? ` · ур. ${player.level}` : ""}
        </span>
      </div>

      <span className="player-steps">
        <Footprints size={12} />
        {player.weekSteps.toLocaleString("ru-RU")}
      </span>
    </li>
  );
}

export default function FriendsScreen({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("friends");
  const [data, setData] = useState<SocialSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSocial()
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="panel">Ошибка: {error}</div>;
  if (!data) return <div className="panel">Загрузка…</div>;

  const rows = tab === "friends" ? data.friends : data.top;
  // The global board is already ranked; the friends tab is ranked among friends only, and both
  // arrive sorted by weekly steps, so position is just the array index.
  const inList = rows.some((r) => r.isMe);

  return (
    <div className="panel friends-panel">
      <header className="referral-head">
        <h2>
          <Trophy size={20} /> Рейтинг
        </h2>
        <button type="button" className="referral-close" onClick={onClose}>
          Назад
        </button>
      </header>

      <p className="friends-week">Неделя {weekLabel(data.weekStart)}</p>

      <div className="stats-tabs">
        <button type="button" className={tab === "friends" ? "active" : ""} onClick={() => setTab("friends")}>
          <Users size={14} /> Друзья
        </button>
        <button type="button" className={tab === "global" ? "active" : ""} onClick={() => setTab("global")}>
          <Globe size={14} /> Все игроки
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="referral-empty">
          {tab === "friends"
            ? "Пока только ты. Пригласи друга — он появится здесь, и вы сможете соревноваться."
            : "На этой неделе ещё никто не сделал ни шага."}
        </p>
      ) : (
        <ul className="player-list">
          {rows.map((player, i) => (
            <PlayerCard key={player.userId} player={player} place={i + 1} />
          ))}
        </ul>
      )}

      {/* Only worth showing when the player fell outside the visible slice. */}
      {tab === "global" && !inList && data.myRank !== null && (
        <p className="friends-myrank">
          Твоё место: <strong>{data.myRank}</strong> · {data.myWeekSteps.toLocaleString("ru-RU")} шагов
        </p>
      )}
    </div>
  );
}
