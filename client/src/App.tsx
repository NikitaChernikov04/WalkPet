import { useEffect, useRef, useState } from "react";
import "./App.css";
import {
  fetchPet,
  getGoogleFitStatus,
  pollAvatar,
  requestAvatar,
  restoreDebugSnapshot,
  startGoogleFitAuth,
  syncGoogleFit,
  syncSteps,
  type Pet,
  type Rarity,
} from "./lib/api";
import PetScene from "./components/PetScene";
import EggScene from "./components/EggScene";
import StepRing from "./components/StepRing";
import Toasts, { type ToastItem } from "./components/Toasts";
import AvatarGenerator from "./components/AvatarGenerator";
import GoogleFitConnect from "./components/GoogleFitConnect";
import GoogleFitOnboarding from "./components/GoogleFitOnboarding";
import StatsScreen from "./components/StatsScreen";
import {
  Heart,
  Smile,
  Brain,
  Dumbbell,
  Flame,
  Apple,
  Compass,
  Footprints,
  PawPrint,
  RotateCcw,
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

const MILESTONES = [
  { steps: 1000, icon: Apple, label: "Еда", toast: "🍎 Питомец поел! +5 здоровья" },
  { steps: 5000, icon: Smile, label: "Настроение", toast: "😊 Отличное настроение! +5 счастья" },
  { steps: 10000, icon: Dumbbell, label: "Тренировка", toast: "💪 Тренировка завершена! +5 силы" },
  { steps: 15000, icon: Compass, label: "Приключение", toast: "🗺 Приключение! +5 интеллекта" },
];

function StatChip({ icon: Icon, label, value }: { icon: typeof Heart; label: string; value: number }) {
  return (
    <div className="stat-chip" title={label}>
      <Icon size={14} />
      <div className="stat-chip-track">
        <div className="stat-chip-fill" style={{ height: `${value}%` }} />
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
  const pendingStepsRef = useRef(0);
  const lastSyncedStepsRef = useRef(0);
  const debugModeRef = useRef(false);
  const preDebugSnapshotRef = useRef<{ pet: Pet; todaySteps: number } | null>(null);
  const prevTodayStepsRef = useRef(0);
  const prevStageRef = useRef<string | null>(null);
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
        pendingStepsRef.current = todaySteps;
        lastSyncedStepsRef.current = todaySteps;
        prevTodayStepsRef.current = todaySteps;
        prevStageRef.current = pet.stage;
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
          pendingStepsRef.current = todaySteps;
          lastSyncedStepsRef.current = todaySteps;
          prevTodayStepsRef.current = todaySteps;
        })
        .catch((e) => setError(String(e)));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Pushes debug-tapped steps to the server. Real step counts come exclusively from Google
  // Fit (see the sync effect below); this only fires when a debug tap actually changed the
  // local count, so it stays idle — not fighting Google Fit's numbers — the rest of the time.
  useEffect(() => {
    const interval = setInterval(() => {
      if (pendingStepsRef.current === lastSyncedStepsRef.current) return;
      lastSyncedStepsRef.current = pendingStepsRef.current;
      syncSteps(pendingStepsRef.current)
        .then(({ pet, todaySteps }) => {
          setPet(pet);
          setTodaySteps(todaySteps);
        })
        .catch((e) => setError(String(e)));
    }, 2000);
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

  // Google Fit is the sole source of real step data once connected — sync it in periodically.
  // Paused during a debug session (see addDebugSteps/handleResetDebug) so real Google Fit
  // data doesn't immediately overwrite a manual test reset.
  useEffect(() => {
    if (!googleFitConnected) return;
    const sync = () => {
      if (debugModeRef.current) return;
      syncGoogleFit()
        .then(({ pet, todaySteps }) => {
          setPet(pet);
          setTodaySteps(todaySteps);
          pendingStepsRef.current = todaySteps;
          lastSyncedStepsRef.current = todaySteps;
        })
        .catch((e) => setError(String(e)));
    };
    sync();
    const interval = setInterval(sync, 60000);
    return () => clearInterval(interval);
  }, [googleFitConnected]);

  // First-run nudge: a brand-new egg (no steps yet) with no Google Fit connection means step
  // tracking can't do anything yet, so prompt to connect right away instead of leaving the
  // player staring at a stuck egg. Shown once per device via localStorage.
  useEffect(() => {
    if (!pet || googleFitConnected === null) return;
    if (pet.stage !== "egg" || pet.lifetime_steps > 0 || googleFitConnected) return;
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
      if (todaySteps >= m.steps && prevTodayStepsRef.current < m.steps) pushToast(m.toast);
    }
    prevTodayStepsRef.current = todaySteps;

    if (prevStageRef.current && prevStageRef.current !== pet.stage) {
      if (pet.stage === "cracking") pushToast("🥚 Яйцо начало трескаться!");
      if (pet.stage === "hatched") pushToast(`🎉 Питомец вылупился — это ${pet.species}!`);
    }
    prevStageRef.current = pet.stage;
  }, [todaySteps, pet]);

  // Debug controls are meant to be used without a real device or Google Fit fighting them
  // over the step count, so the first tap of a session snapshots the pre-tap state (to
  // restore later) and pauses the Google Fit auto-sync until the reset below resumes it.
  const addDebugSteps = (n: number) => {
    if (!preDebugSnapshotRef.current && pet) {
      preDebugSnapshotRef.current = { pet, todaySteps };
    }
    debugModeRef.current = true;
    pendingStepsRef.current += n;
    setTodaySteps(pendingStepsRef.current);
    setStepTick((t) => t + 1);
  };

  // Restores exactly the pre-debug-session snapshot — undoing only what the debug buttons
  // added, never touching real Google Fit history that came in before or after.
  const handleResetDebug = () => {
    const snapshot = preDebugSnapshotRef.current;
    if (!snapshot) {
      pushToast("Нечего сбрасывать — сначала натапай отладочные шаги");
      return;
    }
    // Zero the locally-cached step count immediately (not just after the response comes
    // back) so a debounced sync tick firing mid-request can't resend the stale pre-reset
    // total and have the server's idempotent max() restore it.
    pendingStepsRef.current = snapshot.todaySteps;
    lastSyncedStepsRef.current = snapshot.todaySteps;
    setTodaySteps(snapshot.todaySteps);
    restoreDebugSnapshot(snapshot.pet, snapshot.todaySteps)
      .then(({ pet, todaySteps }) => {
        pendingStepsRef.current = todaySteps;
        lastSyncedStepsRef.current = todaySteps;
        setPet(pet);
        setTodaySteps(todaySteps);
        preDebugSnapshotRef.current = null;
        debugModeRef.current = false;
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
        <h1>
          <PawPrint size={22} /> WalkPet
        </h1>
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
            />
          )}
        </>
      )}

      <div className="debug-panel">
        <p>
          <Footprints size={14} /> Отладка (без телефона):
        </p>
        <button onClick={() => addDebugSteps(500)}>+500 шагов</button>
        <button onClick={() => addDebugSteps(2000)}>+2000 шагов</button>
        <button className="debug-reset-btn" onClick={handleResetDebug}>
          <RotateCcw size={14} /> Сбросить всё
        </button>
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
}: {
  pet: Pet;
  todaySteps: number;
  mood: "great" | "ok" | "low";
  stepTick: number;
  onGenerateAvatar: (description: string) => void;
}) {
  return (
    <div className="panel">
      <div className="scene-frame">
        <div className="stats-rail">
          <StatChip icon={Heart} label="Здоровье" value={pet.health} />
          <StatChip icon={Smile} label="Счастье" value={pet.happiness} />
        </div>

        <PetScene species={pet.species} mood={mood} stepTick={stepTick} avatarUrl={pet.avatar_url} />

        <div className="stats-rail">
          <StatChip icon={Brain} label="Интеллект" value={pet.intellect} />
          <StatChip icon={Dumbbell} label="Сила" value={pet.strength} />
        </div>
      </div>

      <h2>{pet.species}</h2>
      <span className={`rarity-badge rarity-${pet.rarity}`}>{RARITY_LABELS[pet.rarity]}</span>
      <AvatarGenerator status={pet.avatar_status} onGenerate={onGenerateAvatar} />

      <div className="steps-hero">
        <StepRing todaySteps={todaySteps} />
      </div>

      <ul className="milestones">
        {MILESTONES.map((m) => {
          const Icon = m.icon;
          const done = todaySteps >= m.steps;
          return (
            <li key={m.steps} className={done ? "done" : ""}>
              <Icon size={16} />
              {m.label} ({m.steps.toLocaleString("ru-RU")})
            </li>
          );
        })}
      </ul>
    </div>
  );
}
