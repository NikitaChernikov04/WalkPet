// Mirrors api/_lib/leveling.ts — duplicated here since client and server are separate
// packages. Keep the LEVEL_STEP_BASE and evolution thresholds in sync with the server.
const LEVEL_STEP_BASE = 2000;

export function stepsForLevel(level: number): number {
  return (LEVEL_STEP_BASE * level * (level + 1)) / 2;
}

export function levelProgress(postHatchSteps: number, level: number): { into: number; span: number } {
  const floor = stepsForLevel(level);
  const ceiling = stepsForLevel(level + 1);
  return { into: postHatchSteps - floor, span: ceiling - floor };
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
