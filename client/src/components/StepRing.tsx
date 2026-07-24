const MILESTONE_STEPS = [1000, 5000, 10000, 15000];
const RADIUS = 38;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = 50;
const FACE_R = 47;

// 32-point compass rose ticks — every 8th is a cardinal/major mark, every 4th a mid mark,
// the rest fine ticks. Encodes "your steps are a bearing, not just a percentage."
const TICKS = Array.from({ length: 32 }, (_, i) => {
  const angle = (i / 32) * 2 * Math.PI - Math.PI / 2;
  const major = i % 8 === 0;
  const mid = i % 4 === 0;
  const len = major ? 6 : mid ? 4 : 2.2;
  const r1 = FACE_R - 1;
  const r2 = r1 - len;
  return {
    key: i,
    x1: CENTER + r1 * Math.cos(angle),
    y1: CENTER + r1 * Math.sin(angle),
    x2: CENTER + r2 * Math.cos(angle),
    y2: CENTER + r2 * Math.sin(angle),
    weight: major ? 1.4 : mid ? 1 : 0.6,
    opacity: major ? 0.9 : mid ? 0.55 : 0.3,
  };
});

const DIRECTIONS = [
  { label: "N", deg: 0 },
  { label: "E", deg: 90 },
  { label: "S", deg: 180 },
  { label: "W", deg: 270 },
];

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
        <circle cx={CENTER} cy={CENTER} r={FACE_R} className="compass-face" />
        {TICKS.map((t) => (
          <line
            key={t.key}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            className="compass-tick"
            strokeWidth={t.weight}
            opacity={t.opacity}
          />
        ))}
        {DIRECTIONS.map((d) => {
          const angle = (d.deg * Math.PI) / 180 - Math.PI / 2;
          const r = FACE_R - 11;
          return (
            <text
              key={d.label}
              x={CENTER + r * Math.cos(angle)}
              y={CENTER + r * Math.sin(angle) + 2.2}
              textAnchor="middle"
              className="compass-dir"
              fontSize="5.5"
            >
              {d.label}
            </text>
          );
        })}
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
        <strong>{todaySteps.toLocaleString("ru-RU")}</strong>
        <span>{next ? `до ${next.toLocaleString("ru-RU")}` : "все цели!"}</span>
      </div>
    </div>
  );
}
