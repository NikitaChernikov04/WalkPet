import { useEffect, useRef, useState } from "react";
import "./App.css";
import {
  fetchPet,
  generateAiPetName,
  getGoogleFitStatus,
  pollAvatar,
  requestAvatar,
  resetPet,
  setCustomPetName,
  startGoogleFitAuth,
  syncGoogleFit,
  type Pet,
  type Rarity,
} from "./lib/api";
import {
  evolutionStageForLevel,
  EVOLUTION_STAGE_LABELS,
  levelProgress,
  statCapForLevel,
  statXpMultiplier,
} from "./lib/leveling";
import PetScene from "./components/PetScene";
import EggScene from "./components/EggScene";
import StepRing from "./components/StepRing";
import Toasts, { type ToastItem } from "./components/Toasts";
import AvatarGenerator from "./components/AvatarGenerator";
import GoogleFitConnect from "./components/GoogleFitConnect";
import GoogleFitOnboarding from "./components/GoogleFitOnboarding";
import PetNameEditor from "./components/PetNameEditor";
import StatsScreen from "./components/StatsScreen";
import {
  Heart,
  Smile,
  Brain,
  Dumbbell,
  Flame,
  Apple,
  Compass,
  Lock,
  PawPrint,
  Trash2,
  Trophy,
  Zap,
  BarChart3,
} from "lucide-react";

const EGG_CRACK_STEPS = 3000;
const EGG_HATCH_STEPS = 7000;

const RARITY_LABELS: Record<Rarity, string> = {
  common: "Обычный",
  uncommon: "Необычный",
  rare: "Редкий",
  epic: "Эпический",
  legendary: "Легендарный",
};

// Mirrors RARITY_STAT_CAP_BONUS / RARITY_DECAY_RESISTANCE in api/_lib/species.ts.
const RARITY_STAT_CAP_BONUS: Record<Rarity, number> = {
  common: 0,
  uncommon: 5,
  rare: 12,
  epic: 22,
  legendary: 40,
};

const RARITY_DECAY_RESISTANCE: Record<Rarity, number> = {
  common: 1,
  uncommon: 0.85,
  rare: 0.7,
  epic: 0.55,
  legendary: 0.35,
};

// minLevel gates a milestone behind pet level — mirrors MILESTONES in api/_lib/pet-logic.ts.
const MILESTONES = [
  { steps: 1000, icon: Apple, label: "Еда", toast: "🍎 Питомец поел! +5 здоровья", minLevel: 0 },
  { steps: 5000, icon: Smile, label: "Настроение", toast: "😊 Отличное настроение! +5 счастья", minLevel: 0 },
  { steps: 10000, icon: Dumbbell, label: "Тренировка", toast: "💪 Тренировка завершена! +5 силы", minLevel: 0 },
  { steps: 15000, icon: Compass, label: "Приключение", toast: "🗺 Приключение! +5 интеллекта", minLevel: 0 },
  { steps: 20000, icon: Zap, label: "Марафон", toast: "⚡ Марафон пройден! +5 силы", minLevel: 10 },
  { steps: 25000, icon: Trophy, label: "Вершина", toast: "🏆 Вершина покорена! +5 интеллекта", minLevel: 20 },
];

function StatChip({ icon: Icon, label, value, max = 100 }: { icon: typeof Heart; label: string; value: number; max?: number }) {
  return (
    <div className="stat-chip" title={label}>
      <Icon size={14} />
      <div className="stat-chip-track">
        <div className="stat-chip-fill" style={{ height: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
      <span>{value}</span>
    </div>
  );
}

let toastSeq = 0;

const ONBOARDING_SEEN_KEY = "walkpet_google_fit_onboarding_seen";

export default function App() {
  const [pet, setPet] = useState<Pet | null>(null);
  const [todaySteps, setTodaySteps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [stepTick, setStepTick] = useState(0);
  const [googleFitConnected, setGoogleFitConnected] = useState<boolean | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  // Tracks the latest known step count purely so the Google Fit sync can tell "did today's
  // steps just go up" and give the pet a little bounce — no debounced write-back involved.
  const lastKnownStepsRef = useRef(0);
  const prevTodayStepsRef = useRef(0);
  const prevStageRef = useRef<string | null>(null);
  const prevLevelRef = useRef<number | null>(null);
  const currentDateRef = useRef(new Date().toISOString().slice(0, 10));

  const pushToast = (text: string) => {
    const id = toastSeq++;
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2500);
  };

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
    fetchPet()
      .then(({ pet, todaySteps }) => {
        setPet(pet);
        setTodaySteps(todaySteps);
        lastKnownStepsRef.current = todaySteps;
        prevTodayStepsRef.current = todaySteps;
        prevStageRef.current = pet.stage;
        prevLevelRef.current = pet.level;
      })
      .catch((e) => setError(String(e)));
  }, []);

  // The server naturally starts a fresh day (new step_logs row, reset milestones) at UTC
  // midnight, but if the app stays open across that boundary the client never finds out —
  // it would otherwise keep piling new taps on top of yesterday's cached total. Poll for the
  // date rollover and re-fetch fresh state from the server when it happens.
  useEffect(() => {
    const interval = setInterval(() => {
      const nowDate = new Date().toISOString().slice(0, 10);
      if (nowDate === currentDateRef.current) return;
      currentDateRef.current = nowDate;
      fetchPet()
        .then(({ pet, todaySteps }) => {
          setPet(pet);
          setTodaySteps(todaySteps);
          lastKnownStepsRef.current = todaySteps;
          prevTodayStepsRef.current = todaySteps;
        })
        .catch((e) => setError(String(e)));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const refreshGoogleFitStatus = () => {
    getGoogleFitStatus()
      .then(({ connected }) => setGoogleFitConnected(connected))
      .catch(() => {});
  };

  useEffect(refreshGoogleFitStatus, []);

  // The OAuth consent screen opens in the system browser (Telegram.WebApp.openLink); re-check
  // connection status once the user comes back to the Mini App tab.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshGoogleFitStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Google Fit is the sole source of step data — sync it in periodically.
  useEffect(() => {
    if (!googleFitConnected) return;
    const sync = () => {
      syncGoogleFit()
        .then(({ pet, todaySteps }) => {
          setPet(pet);
          // Give the pet a little bounce when a sync actually brought in new steps.
          if (todaySteps > lastKnownStepsRef.current) setStepTick((t) => t + 1);
          lastKnownStepsRef.current = todaySteps;
          setTodaySteps(todaySteps);
        })
        .catch((e) => setError(String(e)));
    };
    sync();
    const interval = setInterval(sync, 60000);
    return () => clearInterval(interval);
  }, [googleFitConnected]);

  // First-run nudge: any account with no Google Fit connection can't get real step data at
  // all, so prompt to connect right away instead of leaving the player wondering why nothing
  // moves. Shown once per device via localStorage.
  useEffect(() => {
    if (!pet || googleFitConnected === null || googleFitConnected) return;
    if (localStorage.getItem(ONBOARDING_SEEN_KEY)) return;
    setShowOnboarding(true);
  }, [pet, googleFitConnected]);

  // Close the onboarding modal on its own once the user actually connects (they may have
  // done it via the header button while the modal was open, or come back from the OAuth tab).
  useEffect(() => {
    if (googleFitConnected) setShowOnboarding(false);
  }, [googleFitConnected]);

  const dismissOnboarding = () => {
    localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    setShowOnboarding(false);
  };

  const handleConnectGoogleFit = () => {
    startGoogleFitAuth()
      .then(({ url }) => {
        if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(url);
        else window.open(url, "_blank");
      })
      .catch((e) => setError(String(e)));
  };

  // React to milestones crossed and to the egg hatching with a toast + pet animation cue.
  useEffect(() => {
    if (!pet) return;
    for (const m of MILESTONES) {
      if (pet.level < m.minLevel) continue;
      if (todaySteps >= m.steps && prevTodayStepsRef.current < m.steps) pushToast(m.toast);
    }
    prevTodayStepsRef.current = todaySteps;

    if (prevStageRef.current && prevStageRef.current !== pet.stage) {
      if (pet.stage === "cracking") pushToast("🥚 Яйцо начало трескаться!");
      if (pet.stage === "hatched") pushToast(`🎉 Питомец вылупился — это ${pet.species}!`);
    }
    prevStageRef.current = pet.stage;

    // Level progress resets to 0 the instant a level-up happens — without this, that reset
    // looks like the counter randomly dropped instead of "you just leveled up".
    if (prevLevelRef.current !== null && pet.level > prevLevelRef.current) {
      const prevEvolutionStage = evolutionStageForLevel(prevLevelRef.current);
      const newEvolutionStage = evolutionStageForLevel(pet.level);
      if (newEvolutionStage !== prevEvolutionStage) {
        pushToast(`🧬 Питомец эволюционировал: ${EVOLUTION_STAGE_LABELS[newEvolutionStage]}! (Ур. ${pet.level})`);
      } else {
        pushToast(`⭐ Новый уровень: ${pet.level}!`);
      }
    }
    prevLevelRef.current = pet.level;
  }, [todaySteps, pet]);

  // Irreversible: wipes the pet back to a fresh egg and clears step history, so anything
  // built up from now on is 100% real Google Fit data. Two-tap confirm (no native dialog).
  const handleResetPet = () => {
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }
    setConfirmingReset(false);
    resetPet()
      .then(({ pet, todaySteps }) => {
        lastKnownStepsRef.current = todaySteps;
        prevTodayStepsRef.current = todaySteps;
        prevStageRef.current = pet.stage;
        prevLevelRef.current = pet.level;
        setPet(pet);
        setTodaySteps(todaySteps);
      })
      .catch((e) => setError(String(e)));
  };

  // Poll while an avatar generation is in flight (each poll is a cheap status check, not a new generation).
  useEffect(() => {
    if (pet?.avatar_status !== "pending") return;
    const interval = setInterval(() => {
      pollAvatar()
        .then(({ pet }) => {
          setPet(pet);
          if (pet.avatar_status === "completed") pushToast("🎨 Питомец готов!");
          if (pet.avatar_status === "failed") pushToast("😕 Не получилось сгенерировать питомца");
        })
        .catch((e) => setError(String(e)));
    }, 4000);
    return () => clearInterval(interval);
  }, [pet?.avatar_status]);

  const handleGenerateAvatar = (description: string) => {
    requestAvatar(description)
      .then(({ pet }) => setPet(pet))
      .catch((e) => setError(String(e)));
  };

  const handleGenerateAiName = async () => {
    try {
      const { pet } = await generateAiPetName();
      setPet(pet);
      pushToast(`✨ Кличка: ${pet.name}`);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSetCustomName = async (name: string) => {
    try {
      const { pet } = await setCustomPetName(name);
      setPet(pet);
    } catch (e) {
      setError(String(e));
    }
  };

  if (error) return <div className="app-shell error">Ошибка: {error}</div>;
  if (!pet) return <div className="app-shell loading">Загрузка…</div>;

  const mood = pet.happiness >= 70 ? "great" : pet.happiness >= 40 ? "ok" : "low";

  return (
    <div className="app-shell">
      <Toasts toasts={toasts} />

      {showOnboarding && (
        <GoogleFitOnboarding
          onConnect={() => {
            handleConnectGoogleFit();
            dismissOnboarding();
          }}
          onClose={dismissOnboarding}
        />
      )}

      <header className="app-header">
        <div>
          <span className="app-eyebrow">ID #{String(pet.id).padStart(3, "0")}</span>
          <h1>
            <PawPrint size={22} /> WalkPet
          </h1>
        </div>
        <div className="header-actions">
          <button type="button" className="stats-toggle-btn" onClick={() => setShowStats((s) => !s)} aria-label="Статистика">
            <BarChart3 size={18} />
          </button>
          {pet.stage === "hatched" && (
            <span className="streak-pill">
              <Flame size={16} /> {pet.streak_days}
            </span>
          )}
        </div>
      </header>

      <GoogleFitConnect connected={googleFitConnected} onConnect={handleConnectGoogleFit} />

      {showStats ? (
        <StatsScreen onClose={() => setShowStats(false)} />
      ) : (
        <>
          {pet.stage !== "hatched" && (
            <EggPanel pet={pet} googleFitConnected={googleFitConnected} onConnectGoogleFit={handleConnectGoogleFit} />
          )}

          {pet.stage === "hatched" && (
            <PetPanel
              pet={pet}
              todaySteps={todaySteps}
              mood={mood}
              stepTick={stepTick}
              onGenerateAvatar={handleGenerateAvatar}
              onGenerateAiName={handleGenerateAiName}
              onSetCustomName={handleSetCustomName}
            />
          )}
        </>
      )}

      <div className="reset-panel">
        {confirmingReset ? (
          <>
            <p>Точно сбросить питомца? Это необратимо — все шаги и прогресс удалятся.</p>
            <button className="reset-pet-btn" onClick={handleResetPet}>
              <Trash2 size={14} /> Да, сбросить
            </button>
            <button className="reset-cancel-btn" onClick={() => setConfirmingReset(false)}>
              Отмена
            </button>
          </>
        ) : (
          <button className="reset-pet-btn" onClick={handleResetPet}>
            <Trash2 size={14} /> Сбросить питомца
          </button>
        )}
      </div>
    </div>
  );
}

function EggPanel({
  pet,
  googleFitConnected,
  onConnectGoogleFit,
}: {
  pet: Pet;
  googleFitConnected: boolean | null;
  onConnectGoogleFit: () => void;
}) {
  const target = pet.stage === "egg" ? EGG_CRACK_STEPS : EGG_HATCH_STEPS;
  const progress = Math.min(100, (pet.lifetime_steps / target) * 100);
  return (
    <div className="panel">
      <EggScene progress={progress} stage={pet.stage as "egg" | "cracking"} />
      <p className="egg-caption">
        {pet.stage === "egg" ? "Яйцо ждёт первых шагов…" : "Яйцо трескается — уже скоро!"}
      </p>
      <div className="stat-track">
        <div className="stat-fill" style={{ width: `${progress}%` }} />
      </div>
      <p className="egg-progress">
        {pet.lifetime_steps.toLocaleString("ru-RU")} / {target.toLocaleString("ru-RU")} шагов
      </p>
      {googleFitConnected === false && (
        <button onClick={onConnectGoogleFit}>Подключить Google Fit</button>
      )}
    </div>
  );
}

function PetPanel({
  pet,
  todaySteps,
  mood,
  stepTick,
  onGenerateAvatar,
  onGenerateAiName,
  onSetCustomName,
}: {
  pet: Pet;
  todaySteps: number;
  mood: "great" | "ok" | "low";
  stepTick: number;
  onGenerateAvatar: (description: string) => void;
  onGenerateAiName: () => Promise<void>;
  onSetCustomName: (name: string) => Promise<void>;
}) {
  const statCap = statCapForLevel(pet.level) + RARITY_STAT_CAP_BONUS[pet.rarity];
  // Level XP is a direct 1:1 mirror of post-hatch steps server-side (see pet-logic.ts) —
  // no conversion here, so this always matches the step ring's own number exactly.
  const { into, span } = levelProgress(pet.xp, pet.level);
  const levelPct = span > 0 ? Math.min(100, (into / span) * 100) : 100;
  const evolutionStage = evolutionStageForLevel(pet.level);
  const avgStat = (pet.health + pet.happiness + pet.intellect + pet.strength) / 4;
  const careMultiplier = statXpMultiplier(avgStat, statCap);
  const decayResistance = RARITY_DECAY_RESISTANCE[pet.rarity];

  return (
    <div className="panel">
      <div className={`scene-frame rarity-${pet.rarity}`}>
        <div className="stats-rail">
          <StatChip icon={Heart} label="Здоровье" value={pet.health} max={statCap} />
          <StatChip icon={Smile} label="Счастье" value={pet.happiness} max={statCap} />
        </div>

        <PetScene species={pet.species} mood={mood} stepTick={stepTick} avatarUrl={pet.avatar_url} />

        <div className="stats-rail">
          <StatChip icon={Brain} label="Интеллект" value={pet.intellect} max={statCap} />
          <StatChip icon={Dumbbell} label="Сила" value={pet.strength} max={statCap} />
        </div>
      </div>

      <h2>{pet.name ?? pet.species}</h2>
      {pet.name && <p className="pet-species-sub">{pet.species}</p>}
      <span className={`rarity-badge rarity-${pet.rarity}`}>{RARITY_LABELS[pet.rarity]}</span>
      <p className="rarity-effect">
        потолок характеристик +{RARITY_STAT_CAP_BONUS[pet.rarity]} · угасание ×{decayResistance.toFixed(2)} · награды ×
        {careMultiplier.toFixed(2)}
      </p>

      <div className="level-block">
        <span className="level-label">
          Ур. {pet.level} · {EVOLUTION_STAGE_LABELS[evolutionStage]}
        </span>
        <div className="stat-track level-track">
          <div className="stat-fill" style={{ width: `${levelPct}%` }} />
        </div>
        <span className="level-progress-text">
          {into.toLocaleString("ru-RU")} / {span.toLocaleString("ru-RU")} шагов до след. уровня
        </span>
      </div>

      <PetNameEditor name={pet.name} onGenerateAi={onGenerateAiName} onSetCustom={onSetCustomName} />

      <AvatarGenerator status={pet.avatar_status} onGenerate={onGenerateAvatar} />

      <div className="steps-hero">
        <StepRing todaySteps={todaySteps} />
      </div>

      <ul className="milestones">
        {MILESTONES.map((m) => {
          const locked = pet.level < m.minLevel;
          const Icon = locked ? Lock : m.icon;
          const done = !locked && todaySteps >= m.steps;
          return (
            <li key={m.steps} className={locked ? "locked" : done ? "done" : ""}>
              <Icon size={16} />
              {locked ? `Открывается на ур. ${m.minLevel}` : `${m.label} (${m.steps.toLocaleString("ru-RU")})`}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
