// Level grows from XP earned *after* hatching (pre-hatch egg steps don't count), on a
// triangular curve: reaching level L needs a cumulative LEVEL_XP_BASE * L * (L+1) / 2 XP.
// That gives quick early levels (L1 at 2000 XP) and a steadily steeper climb later (L10 at
// 110,000; L20 at 420,000) — a believable long-term walking goal. XP isn't a 1:1 mirror of
// steps walked: see statXpMultiplier below — how well-kept the pet is scales how much XP
// each step is actually worth, so the stat bars aren't just decorative.
const LEVEL_XP_BASE = 2000;

export function xpForLevel(level: number): number {
  return (LEVEL_XP_BASE * level * (level + 1)) / 2;
}

export function levelForXp(xp: number): number {
  if (xp <= 0) return 0;
  const target = (2 * xp) / LEVEL_XP_BASE;
  const level = Math.floor((-1 + Math.sqrt(1 + 4 * target)) / 2);
  return Math.max(0, level);
}

export function levelProgress(xp: number, level: number): { into: number; span: number } {
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  return { into: xp - floor, span: ceiling - floor };
}

// Every level permanently raises the stat ceiling a little, so grinding out levels keeps
// paying off even once health/happiness/etc. would otherwise be capped at 100. Rarity adds
// its own bonus on top of this (see RARITY_STAT_CAP_BONUS in species.ts).
export function statCapForLevel(level: number): number {
  return 100 + level * 2;
}

// How well-kept the pet currently is (0..1, its average stat relative to its own cap)
// scales how efficiently today's steps convert into XP: a neglected pet (stats near 0)
// converts steps at 70% efficiency, a thriving one (stats near the cap) at 130% — the same
// walking pays off faster for a pet that's actually being taken care of.
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

// Body/proportion changes per stage — layered onto the AI art prompt the same way
// RARITY_PROMPT_MODIFIERS makes rarer pets look fancier (see species.ts).
export const EVOLUTION_BODY_PROMPT: Record<EvolutionStage, string> = {
  baby: "Small, young, extra-cute baby proportions with a big head and tiny round body.",
  adult: "Fully grown, confident stance, well-defined proportions and features.",
  elder: "Powerful battle-hardened veteran build, larger and more imposing, with a richer fur/scale texture.",
  ascended: "Awe-inspiring ascended form with a subtle magical aura glowing softly around it.",
};

// Full cumulative outfit description, for a FROM-SCRATCH generation (hatch, or regenerating
// after a failure) — each stage restates everything it should be wearing by that point.
export const EVOLUTION_OUTFIT_PROMPT: Record<EvolutionStage, string> = {
  baby: "Completely bare and unclothed — no clothing, no accessories, no items worn, just its natural body, fur/scales/feathers and colors.",
  adult: "Wearing exactly one simple item of clothing or gear, such as a bandana, a scarf, or a small collar.",
  elder: "Wearing a more elaborate outfit than a simple accessory — light armor pieces, a cloak, or a warrior's hat — plus one extra accessory.",
  ascended: "Wearing an ornate, majestic full outfit — golden armor, a flowing cape, and a crown or a glowing halo.",
};

// Only the NEW addition since the previous stage — used for image-to-image evolution edits,
// where the existing look (including gear already added) comes from the reference image
// itself and must not be redescribed or it risks being replaced instead of built upon.
export const EVOLUTION_GEAR_DELTA_PROMPT: Partial<Record<EvolutionStage, string>> = {
  adult:
    "Add exactly one simple item of clothing or gear onto the character — such as a bandana, a scarf, or a small collar — fitted naturally. Do not change the character's face, body shape, colors, pose, or the background.",
  elder:
    "Add a more elaborate outfit on top of what it's already wearing — light armor pieces, a cloak, or a warrior's hat — plus one extra accessory. Do not change the character's face, body shape, colors, pose, or the background.",
  ascended:
    "Add an ornate, majestic full outfit on top of what it's already wearing — golden armor, a flowing cape, and a crown or glowing halo. Do not change the character's face, body shape, colors, pose, or the background.",
};
