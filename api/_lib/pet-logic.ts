import { db, ensureSchema } from "./db.js";
import { refreshAccessToken } from "./googleFit.js";
import { startAvatarGeneration } from "./nanobanana.js";
import {
  buildEvolutionEditPrompt,
  buildPetPrompt,
  pickRandomSpecies,
  RARITY_DECAY_RESISTANCE,
  RARITY_STAT_CAP_BONUS,
  type Rarity,
} from "./species.js";
import {
  evolutionStageForLevel,
  LEVEL_UP_STAT_BONUS,
  levelForXp,
  statCapForLevel,
  statXpMultiplier,
} from "./leveling.js";

export const EGG_CRACK_STEPS = 3000;
export const EGG_HATCH_STEPS = 7000;

// `minLevel` gates a milestone behind pet level, so the daily-goal list itself grows as the
// pet levels up instead of staying fixed at 4 forever.
export const MILESTONES = {
  food: { steps: 1000, stat: "health", amount: 5, minLevel: 0 },
  mood: { steps: 5000, stat: "happiness", amount: 5, minLevel: 0 },
  training: { steps: 10000, stat: "strength", amount: 5, minLevel: 0 },
  adventure: { steps: 15000, stat: "intellect", amount: 5, minLevel: 0 },
  marathon: { steps: 20000, stat: "strength", amount: 5, minLevel: 10 },
  peak: { steps: 25000, stat: "intellect", amount: 5, minLevel: 20 },
} as const;

type MilestoneKey = keyof typeof MILESTONES;

const DECAY_PER_INACTIVE_DAY = 5;
const MAX_DECAY_DAYS = 30;

export interface Pet {
  id: number;
  user_id: number;
  stage: "egg" | "cracking" | "hatched";
  species: string;
  rarity: Rarity;
  level: number;
  xp: number;
  name: string | null;
  lifetime_steps: number;
  health: number;
  happiness: number;
  intellect: number;
  strength: number;
  streak_days: number;
  last_active_date: string | null;
  hatched_at: string | null;
  created_at: string;
  avatar_url: string | null;
  avatar_status: "none" | "pending" | "completed" | "failed";
  avatar_generation_id: string | null;
  avatar_description: string | null;
  avatar_seed: number | null;
  avatar_source_url: string | null;
}

const clamp = (n: number, max = 100) => Math.max(0, Math.min(max, n));
const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export async function upsertUser(telegramId: string, username: string | null): Promise<number> {
  await ensureSchema();
  const existing = await db.execute({
    sql: "SELECT id FROM users WHERE telegram_id = ?",
    args: [telegramId],
  });
  if (existing.rows[0]) return Number(existing.rows[0].id);

  const result = await db.execute({
    sql: "INSERT INTO users (telegram_id, username) VALUES (?, ?)",
    args: [telegramId, username],
  });
  return Number(result.lastInsertRowid);
}

export async function getOrCreatePet(userId: number): Promise<Pet> {
  await ensureSchema();
  const existing = await db.execute({ sql: "SELECT * FROM pets WHERE user_id = ?", args: [userId] });
  if (existing.rows[0]) return existing.rows[0] as unknown as Pet;

  await db.execute({ sql: "INSERT INTO pets (user_id) VALUES (?)", args: [userId] });
  const created = await db.execute({ sql: "SELECT * FROM pets WHERE user_id = ?", args: [userId] });
  return created.rows[0] as unknown as Pet;
}

/** Records today's absolute step count for a user and applies game rules.
 *  `stepsToday` is the cumulative count for the day (client re-sends the running total,
 *  so we take the max to stay idempotent against retries). */
export async function recordSteps(userId: number, stepsToday: number): Promise<Pet> {
  await ensureSchema();
  const date = today();
  const rowRes = await db.execute({
    sql: "SELECT steps, milestones_applied FROM step_logs WHERE user_id = ? AND date = ?",
    args: [userId, date],
  });
  const row = rowRes.rows[0] as unknown as { steps: number; milestones_applied: string } | undefined;

  const previousSteps = row?.steps ?? 0;
  const newSteps = Math.max(previousSteps, stepsToday);
  const delta = newSteps - previousSteps;

  if (row) {
    await db.execute({
      sql: "UPDATE step_logs SET steps = ? WHERE user_id = ? AND date = ?",
      args: [newSteps, userId, date],
    });
  } else {
    await db.execute({
      sql: "INSERT INTO step_logs (user_id, date, steps) VALUES (?, ?, ?)",
      args: [userId, date, newSteps],
    });
  }

  const pet = await getOrCreatePet(userId);
  let { health, happiness, intellect, strength } = pet;
  const lifetimeSteps = pet.lifetime_steps + delta;

  // XP is derived fresh from lifetime_steps every time (not accumulated), so it can never
  // drift from it — "steps to next level" always matches the step ring's own number exactly,
  // with no hidden conversion the player has no way to verify. This also self-heals any
  // pet whose `xp` was thrown off by the now-removed care multiplier. Care/rarity effects
  // live elsewhere (milestone reward size below, and the stat-cap/decay-resistance bonuses),
  // never on this figure.
  const xp = Math.max(0, lifetimeSteps - EGG_HATCH_STEPS);
  const level = levelForXp(xp);
  // Rarity permanently raises the stat ceiling on top of the level-based one, so a rarer
  // pet's care bars simply go further — this is what ties rarity to something real too.
  const statCap = statCapForLevel(level) + RARITY_STAT_CAP_BONUS[pet.rarity];

  // Every level gained (could be more than one on a big sync) grants an immediate flat bonus
  // to all four stats — a level-up feels rewarding on its own, not just via the raised cap.
  const levelsGained = Math.max(0, level - pet.level);
  if (levelsGained > 0) {
    const bonus = LEVEL_UP_STAT_BONUS * levelsGained;
    health = clamp(health + bonus, statCap);
    happiness = clamp(happiness + bonus, statCap);
    intellect = clamp(intellect + bonus, statCap);
    strength = clamp(strength + bonus, statCap);
  }

  // Streak bookkeeping, plus a tamagotchi-style stat decay for each fully inactive day since
  // this player was last seen — only computed once, the first time we see a new calendar day.
  let streakDays = pet.streak_days;
  if (pet.last_active_date !== date) {
    streakDays = pet.last_active_date === yesterday() ? streakDays + 1 : 1;

    const yesterdayRes = await db.execute({
      sql: "SELECT steps FROM step_logs WHERE user_id = ? AND date = ?",
      args: [userId, yesterday()],
    });
    const yesterdaySteps = Number((yesterdayRes.rows[0] as unknown as { steps: number } | undefined)?.steps ?? 0);

    let inactiveDays = yesterdaySteps < MILESTONES.food.steps ? 1 : 0;
    if (pet.last_active_date) {
      const lastActiveMs = new Date(`${pet.last_active_date}T00:00:00.000Z`).getTime();
      const todayMs = new Date(`${date}T00:00:00.000Z`).getTime();
      const gapDays = Math.round((todayMs - lastActiveMs) / 86_400_000) - 1;
      inactiveDays += Math.max(0, gapDays);
    }
    inactiveDays = Math.min(inactiveDays, MAX_DECAY_DAYS);

    if (inactiveDays > 0) {
      const decay = Math.round(DECAY_PER_INACTIVE_DAY * inactiveDays * RARITY_DECAY_RESISTANCE[pet.rarity]);
      health = clamp(health - decay, statCap);
      happiness = clamp(happiness - decay, statCap);
      intellect = clamp(intellect - decay, statCap);
      strength = clamp(strength - decay, statCap);
    }
  }

  // A well-kept pet (stats close to its own cap) earns a bit more from each milestone —
  // this is where "stats affect something real" now lives, kept well away from the step/XP
  // figures so it can never look like a step-count mismatch.
  const careMultiplier = statXpMultiplier((health + happiness + intellect + strength) / 4, statCap);

  const appliedBefore = new Set((row?.milestones_applied ?? "").split(",").filter(Boolean));
  const appliedNow = new Set(appliedBefore);
  for (const [key, milestone] of Object.entries(MILESTONES) as [MilestoneKey, (typeof MILESTONES)[MilestoneKey]][]) {
    if (level < milestone.minLevel) continue;
    if (newSteps >= milestone.steps && !appliedBefore.has(key)) {
      appliedNow.add(key);
      const gain = Math.max(1, Math.round(milestone.amount * careMultiplier));
      if (milestone.stat === "health") health = clamp(health + gain, statCap);
      if (milestone.stat === "happiness") happiness = clamp(happiness + gain, statCap);
      if (milestone.stat === "strength") strength = clamp(strength + gain, statCap);
      if (milestone.stat === "intellect") intellect = clamp(intellect + gain, statCap);
    }
  }
  if (appliedNow.size !== appliedBefore.size) {
    await db.execute({
      sql: "UPDATE step_logs SET milestones_applied = ? WHERE user_id = ? AND date = ?",
      args: [[...appliedNow].join(","), userId, date],
    });
  }

  if (streakDays > 0 && streakDays % 7 === 0 && streakDays !== pet.streak_days) {
    happiness = clamp(happiness + 10, statCap);
  }

  let stage = pet.stage;
  let hatchedAt = pet.hatched_at;
  let justHatched = false;
  if (stage === "egg" && lifetimeSteps >= EGG_CRACK_STEPS) stage = "cracking";
  if (stage !== "hatched" && lifetimeSteps >= EGG_HATCH_STEPS) {
    stage = "hatched";
    hatchedAt = new Date().toISOString();
    justHatched = true;
  }

  // Species and rarity are rolled once, at the exact moment the egg hatches, then stay fixed
  // for the pet's lifetime — activity no longer reshuffles them on every subsequent sync.
  let species = pet.species;
  let rarity = pet.rarity;
  if (justHatched) {
    const picked = pickRandomSpecies();
    species = picked.species;
    rarity = picked.rarity;
  }

  const evolutionStage = evolutionStageForLevel(level);
  const evolved = !justHatched && evolutionStageForLevel(pet.level) !== evolutionStage;

  await db.execute({
    sql: `UPDATE pets SET stage = ?, species = ?, rarity = ?, level = ?, xp = ?, lifetime_steps = ?, health = ?, happiness = ?,
          intellect = ?, strength = ?, streak_days = ?, last_active_date = ?, hatched_at = ?
          WHERE user_id = ?`,
    args: [stage, species, rarity, level, xp, lifetimeSteps, health, happiness, intellect, strength, streakDays, date, hatchedAt, userId],
  });

  if (justHatched) {
    // Best-effort: kick off the pet's very first avatar right away so the reveal feels alive —
    // completely bare/unclothed (see EVOLUTION_OUTFIT_PROMPT["baby"]), gear gets earned through
    // evolution below. A random seed is rolled once here and reused on every future evolution
    // edit for extra visual consistency on top of the image-to-image reference.
    // If Polza errors out here, avatar_status just stays "none" and the player can still
    // generate one manually from the pet panel.
    try {
      const seed = Math.floor(Math.random() * 2 ** 31);
      const gen = await startAvatarGeneration(buildPetPrompt(species, "", rarity, evolutionStage), { seed });
      await setAvatarPending(userId, gen.id, "", seed);
    } catch {
      // ignore — manual generation remains available
    }
  } else if (evolved && pet.avatar_status === "completed" && pet.avatar_source_url) {
    // Crossing an evolution-stage boundary (baby → adult → elder → ascended) image-to-image
    // edits the pet's EXISTING avatar (the magenta-background source version, not the
    // transparent display cutout) to add the next tier of gear, so it stays recognizably the
    // same creature instead of rolling a completely different-looking image.
    try {
      const prompt = buildEvolutionEditPrompt(species, rarity, evolutionStage);
      const gen = await startAvatarGeneration(prompt, {
        images: [pet.avatar_source_url],
        strength: 0.35,
        seed: pet.avatar_seed ?? undefined,
      });
      await setAvatarPending(userId, gen.id, pet.avatar_description ?? "", pet.avatar_seed ?? undefined);
    } catch {
      // ignore — pet keeps its current art, nothing broken
    }
  }

  const updated = await db.execute({ sql: "SELECT * FROM pets WHERE user_id = ?", args: [userId] });
  return updated.rows[0] as unknown as Pet;
}

/** Wipes a pet back to a brand-new egg and deletes its step history, so the player can start
 *  completely clean — e.g. after removing the manual debug-step controls, to shed any steps
 *  those added that are now inseparably mixed into lifetime_steps/step_logs alongside real
 *  Google Fit data. Irreversible; the Google account link itself (on the `users` row) is
 *  untouched, so Google Fit stays connected and simply starts contributing to a fresh pet. */
export async function resetPet(userId: number): Promise<Pet> {
  await ensureSchema();
  await db.batch(
    [
      { sql: "DELETE FROM step_logs WHERE user_id = ?", args: [userId] },
      {
        sql: `UPDATE pets SET stage = 'egg', species = 'unknown', rarity = 'common', level = 0, xp = 0, name = NULL,
              lifetime_steps = 0, health = 50, happiness = 50, intellect = 10, strength = 10, streak_days = 0,
              last_active_date = NULL, hatched_at = NULL, avatar_url = NULL, avatar_status = 'none',
              avatar_generation_id = NULL, avatar_description = NULL, avatar_seed = NULL, avatar_source_url = NULL
              WHERE user_id = ?`,
        args: [userId],
      },
    ],
    "write",
  );
  return getOrCreatePet(userId);
}

/** Daily step totals for [startDate, endDate] (inclusive, ISO "YYYY-MM-DD"), zero-filled for
 *  days with no logged activity. */
export async function getStepHistory(
  userId: number,
  startDate: string,
  endDate: string,
): Promise<{ date: string; steps: number }[]> {
  await ensureSchema();
  const res = await db.execute({
    sql: "SELECT date, steps FROM step_logs WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date ASC",
    args: [userId, startDate, endDate],
  });
  const byDate = new Map<string, number>();
  for (const row of res.rows as unknown as { date: string; steps: number }[]) {
    byDate.set(row.date, row.steps);
  }

  const result: { date: string; steps: number }[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    const iso = cursor.toISOString().slice(0, 10);
    result.push({ date: iso, steps: byDate.get(iso) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export async function getTodaySteps(userId: number): Promise<number> {
  await ensureSchema();
  const res = await db.execute({
    sql: "SELECT steps FROM step_logs WHERE user_id = ? AND date = ?",
    args: [userId, today()],
  });
  return Number((res.rows[0] as unknown as { steps: number } | undefined)?.steps ?? 0);
}

export async function setPetName(userId: number, name: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: "UPDATE pets SET name = ? WHERE user_id = ?",
    args: [name, userId],
  });
}

export async function setAvatarPending(
  userId: number,
  generationId: string,
  description: string,
  seed?: number,
): Promise<void> {
  await ensureSchema();
  if (seed !== undefined) {
    await db.execute({
      sql: `UPDATE pets SET avatar_status = 'pending', avatar_generation_id = ?, avatar_description = ?, avatar_seed = ?
            WHERE user_id = ?`,
      args: [generationId, description, seed, userId],
    });
  } else {
    await db.execute({
      sql: `UPDATE pets SET avatar_status = 'pending', avatar_generation_id = ?, avatar_description = ?
            WHERE user_id = ?`,
      args: [generationId, description, userId],
    });
  }
}

export async function completeAvatar(userId: number, displayUrl: string, sourceUrl: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: "UPDATE pets SET avatar_status = 'completed', avatar_url = ?, avatar_source_url = ? WHERE user_id = ?",
    args: [displayUrl, sourceUrl, userId],
  });
}

export async function failAvatar(userId: number): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: "UPDATE pets SET avatar_status = 'failed' WHERE user_id = ?",
    args: [userId],
  });
}

export interface GoogleAccountTokens {
  accessToken: string;
  refreshToken: string;
  expiry: number;
}

export async function saveGoogleTokens(
  userId: number,
  accessToken: string,
  refreshToken: string,
  expiry: number,
): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: "UPDATE users SET google_access_token = ?, google_refresh_token = ?, google_token_expiry = ? WHERE id = ?",
    args: [accessToken, refreshToken, expiry, userId],
  });
}

export async function getGoogleTokens(userId: number): Promise<GoogleAccountTokens | null> {
  await ensureSchema();
  const res = await db.execute({
    sql: "SELECT google_access_token, google_refresh_token, google_token_expiry FROM users WHERE id = ?",
    args: [userId],
  });
  const row = res.rows[0] as unknown as
    | { google_access_token: string | null; google_refresh_token: string | null; google_token_expiry: number | null }
    | undefined;
  if (!row?.google_access_token || !row.google_refresh_token) return null;
  return { accessToken: row.google_access_token, refreshToken: row.google_refresh_token, expiry: row.google_token_expiry ?? 0 };
}

/** Returns a usable access token, transparently refreshing it if it's expired (or about to).
 *  Returns null if the user has never connected Google Fit. */
export async function getValidGoogleAccessToken(userId: number): Promise<string | null> {
  const tokens = await getGoogleTokens(userId);
  if (!tokens) return null;
  if (tokens.expiry > Date.now() + 60_000) return tokens.accessToken;

  const refreshed = await refreshAccessToken(tokens.refreshToken);
  await db.execute({
    sql: "UPDATE users SET google_access_token = ?, google_token_expiry = ? WHERE id = ?",
    args: [refreshed.accessToken, refreshed.expiresAt, userId],
  });
  return refreshed.accessToken;
}
