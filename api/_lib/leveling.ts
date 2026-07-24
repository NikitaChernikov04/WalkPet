// Level grows from steps walked *after* hatching (pre-hatch egg steps don't count), on a
// triangular curve: reaching level L needs a cumulative LEVEL_STEP_BASE * L * (L+1) / 2
// post-hatch steps. That gives quick early levels (L1 at 2000 steps) and a steadily steeper
// climb later (L10 at 110,000; L20 at 420,000) — a believable long-term walking goal.
const LEVEL_STEP_BASE = 2000;

export function stepsForLevel(level: number): number {
  return (LEVEL_STEP_BASE * level * (level + 1)) / 2;
}

export function levelForPostHatchSteps(postHatchSteps: number): number {
  if (postHatchSteps <= 0) return 0;
  const target = (2 * postHatchSteps) / LEVEL_STEP_BASE;
  const level = Math.floor((-1 + Math.sqrt(1 + 4 * target)) / 2);
  return Math.max(0, level);
}

export function levelProgress(postHatchSteps: number, level: number): { into: number; span: number } {
  const floor = stepsForLevel(level);
  const ceiling = stepsForLevel(level + 1);
  return { into: postHatchSteps - floor, span: ceiling - floor };
}

// Every level permanently raises the stat ceiling a little, so grinding out levels keeps
// paying off even once health/happiness/etc. would otherwise be capped at 100.
export function statCapForLevel(level: number): number {
  return 100 + level * 2;
}

export type EvolutionStage = "baby" | "adult" | "elder" | "ascended";

const EVOLUTION_THRESHOLDS: [EvolutionStage, number][] = [
  ["ascended", 30],
  ["elder", 15],
  ["adult", 5],
  ["baby", 0],
];

export function evolutionStageForLevel(level: number): EvolutionStage {
  for (const [stage, minLevel] of EVOLUTION_THRESHOLDS) {
    if (level >= minLevel) return stage;
  }
  return "baby";
}

export const EVOLUTION_STAGE_LABELS: Record<EvolutionStage, string> = {
  baby: "Детёныш",
  adult: "Взрослый",
  elder: "Матёрый",
  ascended: "Вознёсшийся",
};

// Layered onto the AI art prompt so a pet actually looks more powerful as it evolves, the
// same way RARITY_PROMPT_MODIFIERS makes rarer pets look fancier (see species.ts).
export const EVOLUTION_PROMPT_MODIFIERS: Record<EvolutionStage, string> = {
  baby: "Small, young, extra-cute baby proportions with a big head and tiny round body.",
  adult: "Fully grown, confident stance, well-defined proportions and features.",
  elder: "Powerful battle-hardened veteran look, larger and more imposing, with visible scars or battle-worn detail, richer fur/scale texture.",
  ascended:
    "Awe-inspiring ascended master form, glowing power aura radiating off the body, intricate legendary-grade detail, crown-like or majestic markings showing true mastery.",
};
