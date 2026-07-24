interface CreatureTheme {
  body: string;
  belly: string;
  accent: string;
  earShape: "round" | "pointed";
  decoration?: "stripes" | "spikes" | "sleepy";
}

const THEMES: Record<string, CreatureTheme> = {
  "Ленивый кот": { body: "#c9b6a3", belly: "#f2e6d8", accent: "#8a7160", earShape: "pointed", decoration: "sleepy" },
  Волк: { body: "#8a93a6", belly: "#e7ecf3", accent: "#525b6b", earShape: "pointed" },
  Тигр: { body: "#f0a03c", belly: "#fff1d6", accent: "#3a2a1a", earShape: "round", decoration: "stripes" },
  Дракон: { body: "#5bc98e", belly: "#e3fff0", accent: "#1f6b47", earShape: "pointed", decoration: "spikes" },
  unknown: { body: "#c99a44", belly: "#ede1c4", accent: "#5a3f1f", earShape: "round" },
};

function Ears({ theme }: { theme: CreatureTheme }) {
  if (theme.earShape === "pointed") {
    return (
      <>
        <path d="M32 34 L22 10 L46 28 Z" fill={theme.body} />
        <path d="M88 34 L98 10 L74 28 Z" fill={theme.body} />
      </>
    );
  }
  return (
    <>
      <circle cx="30" cy="26" r="14" fill={theme.body} />
      <circle cx="90" cy="26" r="14" fill={theme.body} />
    </>
  );
}

function Decoration({ theme }: { theme: CreatureTheme }) {
  switch (theme.decoration) {
    case "stripes":
      return (
        <g stroke={theme.accent} strokeWidth="4" strokeLinecap="round" opacity="0.8">
          <line x1="35" y1="45" x2="45" y2="60" />
          <line x1="85" y1="45" x2="75" y2="60" />
          <line x1="40" y1="85" x2="52" y2="95" />
          <line x1="80" y1="85" x2="68" y2="95" />
        </g>
      );
    case "spikes":
      return (
        <g fill={theme.accent}>
          <path d="M55 22 L60 8 L65 22 Z" />
          <path d="M45 26 L50 14 L55 27 Z" />
          <path d="M65 26 L70 14 L75 27 Z" />
        </g>
      );
    default:
      return null;
  }
}

function Eyes({ theme }: { theme: CreatureTheme }) {
  if (theme.decoration === "sleepy") {
    return (
      <g stroke={theme.accent} strokeWidth="3.5" strokeLinecap="round">
        <path d="M42 62 Q48 66 54 62" fill="none" />
        <path d="M66 62 Q72 66 78 62" fill="none" />
      </g>
    );
  }
  return (
    <>
      <circle cx="48" cy="62" r="6" fill="#20182f" />
      <circle cx="72" cy="62" r="6" fill="#20182f" />
      <circle cx="50" cy="60" r="1.8" fill="#fff" />
      <circle cx="74" cy="60" r="1.8" fill="#fff" />
    </>
  );
}

export function PetIllustration({ species, size = 120 }: { species: string; size?: number }) {
  const theme = THEMES[species] ?? THEMES.unknown;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={species}>
      <ellipse cx="60" cy="112" rx="34" ry="6" fill="#000" opacity="0.18" />
      <Ears theme={theme} />
      <circle cx="60" cy="66" r="42" fill={theme.body} />
      <ellipse cx="60" cy="80" rx="24" ry="20" fill={theme.belly} />
      <Decoration theme={theme} />
      <Eyes theme={theme} />
      <path d="M55 76 Q60 80 65 76" stroke={theme.accent} strokeWidth="3" fill="none" strokeLinecap="round" />
      {theme.decoration === "spikes" && (
        <>
          <ellipse cx="24" cy="70" rx="10" ry="6" fill={theme.body} transform="rotate(-25 24 70)" />
          <ellipse cx="96" cy="70" rx="10" ry="6" fill={theme.body} transform="rotate(25 96 70)" />
        </>
      )}
    </svg>
  );
}

export function EggIllustration({ cracks, size = 120 }: { cracks: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="egg">
      <ellipse cx="60" cy="112" rx="30" ry="6" fill="#000" opacity="0.18" />
      <path
        d="M60 8 C90 8 100 60 100 82 C100 106 82 116 60 116 C38 116 20 106 20 82 C20 60 30 8 60 8 Z"
        fill="#fdf3df"
        stroke="#e8d3a5"
        strokeWidth="2"
      />
      <circle cx="45" cy="55" r="3" fill="#e8d3a5" />
      <circle cx="72" cy="70" r="2.5" fill="#e8d3a5" />
      <circle cx="55" cy="90" r="2" fill="#e8d3a5" />
      {cracks >= 1 && <path d="M60 20 L52 45 L64 55 L50 75" stroke="#6b4f2a" strokeWidth="3" fill="none" strokeLinecap="round" />}
      {cracks >= 2 && <path d="M78 35 L86 50 L74 62" stroke="#6b4f2a" strokeWidth="3" fill="none" strokeLinecap="round" />}
      {cracks >= 3 && <path d="M40 70 L48 85 L38 98" stroke="#6b4f2a" strokeWidth="3" fill="none" strokeLinecap="round" />}
    </svg>
  );
}
