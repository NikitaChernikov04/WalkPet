import { useEffect, useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import { getStepHistory, type StepHistoryDay } from "../lib/api";
import { localDateString } from "../lib/day";

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

type Mode = "7" | "30" | "month";

function formatMonthLabel(monthStr: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// The server's dates are already the player's own calendar days, so they must be rendered as
// plain local dates. Parsing them as UTC and letting toLocaleDateString convert would shift
// every label back a day for anyone west of UTC.
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export default function StatsScreen({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("7");
  const [month, setMonth] = useState(() => localDateString().slice(0, 7));
  const [history, setHistory] = useState<StepHistoryDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  useEffect(() => {
    setHistory(null);
    setActiveIdx(null);
    const params = mode === "month" ? { month } : { range: (mode === "30" ? 30 : 7) as 7 | 30 };
    getStepHistory(params)
      .then(({ history }) => setHistory(history))
      .catch((e) => setError(String(e)));
  }, [mode, month]);

  const max = history && history.length ? Math.max(1, ...history.map((d) => d.steps)) : 1;
  const total = history ? history.reduce((s, d) => s + d.steps, 0) : 0;
  const activeDays = history ? history.filter((d) => d.steps > 0).length : 0;
  const avg = history && history.length ? Math.round(total / history.length) : 0;

  return (
    <div className="panel stats-screen">
      <div className="stats-header">
        <h2>
          <BarChart3 size={18} /> Статистика
        </h2>
        <button type="button" className="stats-close-btn" onClick={onClose}>
          Назад
        </button>
      </div>

      <div className="stats-tabs">
        <button type="button" className={mode === "7" ? "active" : ""} onClick={() => setMode("7")}>
          7 дней
        </button>
        <button type="button" className={mode === "30" ? "active" : ""} onClick={() => setMode("30")}>
          30 дней
        </button>
        <button type="button" className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>
          Месяц
        </button>
      </div>

      {mode === "month" && (
        <div className="stats-month-nav">
          <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Предыдущий месяц">
            <ChevronLeft size={16} />
          </button>
          <span>{formatMonthLabel(month)}</span>
          <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Следующий месяц">
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {error && <p className="avatar-gen-error">Ошибка: {error}</p>}
      {!error && !history && <p className="stats-loading">Загрузка…</p>}

      {history && history.length > 0 && (
        <>
          <div className="stats-summary">
            <div>
              <strong>{total.toLocaleString("ru-RU")}</strong>
              <span>всего шагов</span>
            </div>
            <div>
              <strong>{avg.toLocaleString("ru-RU")}</strong>
              <span>в среднем/день</span>
            </div>
            <div>
              <strong>{activeDays}</strong>
              <span>активных дней</span>
            </div>
          </div>

          <div className="stats-chart" role="img" aria-label="График шагов по дням">
            {history.map((d, i) => {
              const heightPct = Math.max(2, (d.steps / max) * 100);
              const isActive = activeIdx === i;
              return (
                <div
                  key={d.date}
                  className={`stats-bar-col ${isActive ? "active" : ""}`}
                  onClick={() => setActiveIdx(isActive ? null : i)}
                >
                  <div className="stats-bar-track">
                    <div className="stats-bar-fill" style={{ height: `${heightPct}%` }} />
                  </div>
                  {isActive && (
                    <div className="stats-tooltip">
                      {shortDate(d.date)}
                      <strong>{d.steps.toLocaleString("ru-RU")}</strong>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="stats-chart-axis">
            <span>{shortDate(history[0].date)}</span>
            <span>{shortDate(history[history.length - 1].date)}</span>
          </div>
        </>
      )}
    </div>
  );
}
