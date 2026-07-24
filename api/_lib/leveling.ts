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

// Seven tiers instead of the original four, so gear (and the title that comes with it)
// updates more often across a pet's lifetime — spacing widens with level to match the
// leveling curve's own growing cost per level (each tier roughly doubles the XP of the last).
export type EvolutionStage = "baby" | "novice" | "wanderer" | "veteran" | "champion" | "master" | "legend";

const EVOLUTION_THRESHOLDS: [EvolutionStage, number][] = [
  ["legend", 48],
  ["master", 34],
  ["champion", 24],
  ["veteran", 16],
  ["wanderer", 9],
  ["novice", 4],
  ["baby", 0],
];

export function evolutionStageForLevel(level: number): EvolutionStage {
  for (const [stage, minLevel] of EVOLUTION_THRESHOLDS) {
    if (level >= minLevel) return stage;
  }
  return "baby";
}

// Doubles as the pet's displayed title/rank — not just an internal stage key.
export const EVOLUTION_STAGE_LABELS: Record<EvolutionStage, string> = {
  baby: "Детёныш",
  novice: "Новичок",
  wanderer: "Странник",
  veteran: "Ветеран",
  champion: "Чемпион",
  master: "Мастер",
  legend: "Легенда",
};

// Body/proportion changes per stage — layered onto the AI art prompt the same way
// RARITY_PROMPT_MODIFIERS makes rarer pets look fancier (see species.ts).
export const EVOLUTION_BODY_PROMPT: Record<EvolutionStage, string> = {
  baby: "Small, young, extra-cute baby proportions with a big head and tiny round body.",
  novice: "Growing out of baby proportions, a bit more upright and confident, still youthful.",
  wanderer: "Lean, alert, well-traveled build with a confident stance.",
  veteran: "Sturdier, more muscular build, a few battle-worn details, richer fur/scale texture.",
  champion: "Bold, powerful, imposing build radiating confidence and strength.",
  master: "Refined, masterful bearing with a subtle magical aura glowing softly around it.",
  legend: "Awe-inspiring legendary form with a radiant magical aura glowing around it.",
};

// Full cumulative outfit description, for a FROM-SCRATCH generation (hatch, or regenerating
// after a failure) — each stage restates everything it should be wearing by that point.
export const EVOLUTION_OUTFIT_PROMPT: Record<EvolutionStage, string> = {
  baby: "Completely bare and unclothed — no clothing, no accessories, no items worn, just its natural body, fur/scales/feathers and colors.",
  novice: "Wearing exactly one simple item of clothing or gear, such as a bandana, a scarf, or a small collar.",
  wanderer: "Wearing simple travel gear — a small satchel or backpack — plus the accessory from before.",
  veteran: "Wearing light armor pieces or a cloak on top of its travel gear, plus one extra accessory.",
  champion: "Wearing bold, sturdy armor with a weapon or shield, looking like a proud champion.",
  master: "Wearing ornate, high-quality gear with a subtle magical glow, marking real mastery.",
  legend: "Wearing an ornate, majestic full outfit — golden armor, a flowing cape, and a crown or a glowing halo.",
};

// Only the NEW addition since the previous stage — used for image-to-image evolution edits,
// where the existing look (including gear already added) comes from the reference image
// itself and must not be redescribed or it risks being replaced instead of built upon.
export const EVOLUTION_GEAR_DELTA_PROMPT: Partial<Record<EvolutionStage, string>> = {
  novice:
    "Add exactly one simple item of clothing or gear onto the character — such as a bandana, a scarf, or a small collar — fitted naturally. Do not change the character's face, body shape, colors, pose, or the background.",
  wanderer:
    "Add a small satchel or backpack onto the character, on top of what it's already wearing. Do not change the character's face, body shape, colors, pose, or the background.",
  veteran:
    "Add light armor pieces or a cloak on top of what it's already wearing, plus one extra accessory. Do not change the character's face, body shape, colors, pose, or the background.",
  champion:
    "Upgrade its gear to bold, sturdy armor with a weapon or shield, on top of what it's already wearing. Do not change the character's face, body shape, colors, pose, or the background.",
  master:
    "Upgrade its gear to ornate, high-quality equipment with a subtle magical glow, on top of what it's already wearing. Do not change the character's face, body shape, colors, pose, or the background.",
  legend:
    "Add an ornate, majestic full outfit on top of what it's already wearing — golden armor, a flowing cape, and a crown or glowing halo. Do not change the character's face, body shape, colors, pose, or the background.",
};

// A small, immediate reward on every level-up (not just at gear-tier boundaries) — this is
// what makes leveling feel good level-to-level, not just every several levels.
export const LEVEL_UP_STAT_BONUS = 2;
