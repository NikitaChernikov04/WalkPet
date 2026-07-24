const MILESTONE_STEPS = [1000, 5000, 10000, 15000];
const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

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
        <circle cx="50" cy="50" r={RADIUS} className="ring-track" />
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          className="ring-progress"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="ring-label">
        <strong>{todaySteps.toLocaleString("ru-RU")}</strong>
        <span>{next ? `до ${next.toLocaleString("ru-RU")}` : "все цели!"}</span>
      </div>
    </div>
  );
}
