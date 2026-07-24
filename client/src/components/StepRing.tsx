import { Footprints } from "lucide-react";

const MILESTONE_STEPS = [1000, 5000, 10000, 15000];
const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = 50;
const NOTCH_COUNT = 24;

// Chunky HUD-meter notches around the gauge, like a stamina/mana ring in a mobile game —
// not a real-world instrument, just a game-y "this is a meter" signal.
const NOTCHES = Array.from({ length: NOTCH_COUNT }, (_, i) => {
  const angle = (i / NOTCH_COUNT) * 2 * Math.PI - Math.PI / 2;
  const r1 = RADIUS + 7;
  const r2 = RADIUS + 3.5;
  return {
    key: i,
    x1: CENTER + r1 * Math.cos(angle),
    y1: CENTER + r1 * Math.sin(angle),
    x2: CENTER + r2 * Math.cos(angle),
    y2: CENTER + r2 * Math.sin(angle),
  };
});

export default function StepRing({ todaySteps }: { todaySteps: number }) {
  const next = MILESTONE_STEPS.find((s) => todaySteps < s);
  const prev = [0, ...MILESTONE_STEPS].filter((s) => s <= todaySteps).at(-1) ?? 0;
  const target = next ?? MILESTONE_STEPS.at(-1)!;
  const span = target - prev || 1;
  const progress = next ? (todaySteps - prev) / span : 1;
  const offset = CIRCUMFERENCE * (1 - progress);

  return (
    <div className="step-ring">
      <svg viewBox="0 0 100 100">
        {NOTCHES.map((n) => (
          <line key={n.key} x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2} className="gauge-notch" />
        ))}
        <circle cx={CENTER} cy={CENTER} r={RADIUS} className="ring-track" />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          className="ring-progress"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
        />
      </svg>
      <div className="ring-label">
        <Footprints size={16} className="ring-icon" />
        <strong>{todaySteps.toLocaleString("ru-RU")}</strong>
        <span>{next ? `до ${next.toLocaleString("ru-RU")}` : "все цели!"}</span>
      </div>
    </div>
  );
}
