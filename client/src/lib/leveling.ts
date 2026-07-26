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

export type EvolutionStage = "baby" | "novice" | "wanderer" | "veteran" | "champion" | "master" | "legend";

export const EVOLUTION_ORDER: EvolutionStage[] = [
  "baby",
  "novice",
  "wanderer",
  "veteran",
  "champion",
  "master",
  "legend",
];

const EVOLUTION_MIN_LEVEL: Record<EvolutionStage, number> = {
  baby: 0,
  novice: 2,
  wanderer: 6,
  veteran: 11,
  champion: 18,
  master: 28,
  legend: 40,
};

export function evolutionStageForLevel(level: number): EvolutionStage {
  let stage: EvolutionStage = "baby";
  for (const candidate of EVOLUTION_ORDER) {
    if (level >= EVOLUTION_MIN_LEVEL[candidate]) stage = candidate;
  }
  return stage;
}

/** Level at which the pet next changes its look/title — drives the "next evolution" hint. */
export function nextEvolutionLevel(level: number): number | null {
  for (const stage of EVOLUTION_ORDER) {
    if (EVOLUTION_MIN_LEVEL[stage] > level) return EVOLUTION_MIN_LEVEL[stage];
  }
  return null;
}

// Doubles as the pet's displayed title/rank.
export const EVOLUTION_STAGE_LABELS: Record<EvolutionStage, string> = {
  baby: "Детёныш",
  novice: "Новичок",
  wanderer: "Странник",
  veteran: "Ветеран",
  champion: "Чемпион",
  master: "Мастер",
  legend: "Легенда",
};
