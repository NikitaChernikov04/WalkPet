// Mirrors api/_lib/leveling.ts — duplicated here since client and server are separate
// packages. Keep LEVEL_XP_BASE, statCapForLevel, statXpMultiplier and the evolution
// thresholds in sync with the server.
const LEVEL_XP_BASE = 2000;

export function xpForLevel(level: number): number {
  return (LEVEL_XP_BASE * level * (level + 1)) / 2;
}

export function levelProgress(xp: number, level: number): { into: number; span: number } {
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  return { into: xp - floor, span: ceiling - floor };
}

export function statCapForLevel(level: number): number {
  return 100 + level * 2;
}

export function statXpMultiplier(avgStat: number, statCap: number): number {
  const ratio = statCap > 0 ? Math.max(0, Math.min(1, avgStat / statCap)) : 0;
  return 0.7 + ratio * 0.6;
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
