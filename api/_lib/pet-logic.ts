import type { InStatement } from "@libsql/client";
import { db } from "./db.js";
import { ensureSchema } from "./schema.js";
import { attributeReferral, grantInviterReward, parseReferralCode } from "./referrals.js";
import { refreshAccessToken } from "./googleFit.js";
import { startAvatarGeneration } from "./nanobanana.js";
import { daysBetween, localDate, shiftDate } from "./tz.js";
import {
  buildEvolutionEditPrompt,
  buildPetPrompt,
  pickRandomSpecies,
  RARITY_DECAY_RESISTANCE,
  RARITY_STAT_CAP_BONUS,
  type Rarity,
} from "./species.js";
import {
  type EvolutionStage,
  effectiveEvolutionStage,
  LEVEL_UP_STAT_BONUS,
  levelForXp,
  nextEvolutionStageToward,
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
  avatar_stage: EvolutionStage | null;
  avatar_target_stage: EvolutionStage | null;
  /** Steps granted as rewards rather than walked; excluded from the XP baseline. */
  bonus_steps: number;
  /** Free evolution tiers earned by inviting players, added on top of the level-derived stage. */
  evolution_bonus_tiers: number;
}

export interface PetState {
  pet: Pet;
  todaySteps: number;
}

/** `avatar_url` holds a ~200KB base64 PNG data URL. Pulling it out of the DB and shipping it to
 *  the client on every 20-second sync dominated sync latency — a plain `SELECT *` on this table
 *  measured ~1000ms against ~250ms for the same row without the artwork. Syncs therefore work
 *  with this narrower shape; the client already has the image and keeps showing it, and picks up
 *  a new one through the avatar poll (which fires whenever avatar_status goes to "pending"). */
export type PetWithoutArt = Omit<Pet, "avatar_url">;

export interface SyncState {
  pet: PetWithoutArt;
  todaySteps: number;
}

const PET_COLUMNS_WITHOUT_ART = `id, user_id, stage, species, rarity, level, xp, name, lifetime_steps, health, happiness,
  intellect, strength, streak_days, last_active_date, hatched_at, created_at, avatar_status, avatar_generation_id,
  avatar_description, avatar_seed, avatar_source_url, avatar_stage, avatar_target_stage,
  bonus_steps, evolution_bonus_tiers`;

const clamp = (n: number, max = 100) => Math.max(0, Math.min(max, n));

/** Everything below works on the *player's* calendar day (see _lib/tz.ts): the step ring, the
 *  step_logs row a sync writes to, milestone resets and streaks all roll over at their local
 *  00:00, not at UTC midnight. `tzOffset` is minutes east of UTC. */
export interface UserContext {
  userId: number;
  tzOffset: number;
  tokens: GoogleAccountTokens | null;
  /** True only when this call inserted the row. Referral attribution keys off this: being
   *  brand new is what makes a referral legitimate, so an existing player can never be
   *  retro-credited by opening an invite link. */
  created: boolean;
}

/** Resolves the caller in a single round trip: their row id, the timezone to run their day on,
 *  and their Google tokens — the three things nearly every request needs before it can do
 *  anything. Previously three separate sequential queries against a remote DB. */
export async function getUserContext(
  telegramId: string,
  username: string | null,
  tzOffsetHint: number | null,
  startParam: string | null = null,
): Promise<UserContext> {
  await ensureSchema();
  const existing = await db.execute({
    sql: `SELECT id, tz_offset, google_access_token, google_refresh_token, google_token_expiry
          FROM users WHERE telegram_id = ?`,
    args: [telegramId],
  });
  const row = existing.rows[0] as unknown as
    | {
        id: number;
        tz_offset: number | null;
        google_access_token: string | null;
        google_refresh_token: string | null;
        google_token_expiry: number | null;
      }
    | undefined;

  if (!row) {
    // RETURNING rather than lastInsertRowid: the latter is SQLite-only and has no Postgres
    // equivalent, so this is one less thing to rewrite for the Supabase move.
    const result = await db.execute({
      sql: "INSERT INTO users (telegram_id, username, tz_offset) VALUES (?, ?, ?) RETURNING id",
      args: [telegramId, username, tzOffsetHint ?? 0],
    });
    const userId = Number((result.rows[0] as unknown as { id: number }).id);

    // Referrals are attributed here and nowhere else on this path, because "the row was created
    // by this very statement" is exactly the condition that makes the attribution trustworthy —
    // an existing player can never be retro-credited to someone by re-opening an invite link.
    const code = parseReferralCode(startParam);
    if (code) await attributeReferral(userId, code);

    return { userId, tzOffset: tzOffsetHint ?? 0, tokens: null, created: true };
  }

  const userId = Number(row.id);
  const stored = Number(row.tz_offset ?? 0);
  const tzOffset = tzOffsetHint ?? stored;
  // Only written when the player actually moved zone (or DST flipped) — normally free.
  if (tzOffsetHint !== null && tzOffsetHint !== stored) {
    await db.execute({ sql: "UPDATE users SET tz_offset = ? WHERE id = ?", args: [tzOffsetHint, userId] });
  }

  const tokens =
    row.google_access_token && row.google_refresh_token
      ? {
          accessToken: row.google_access_token,
          refreshToken: row.google_refresh_token,
          expiry: row.google_token_expiry ?? 0,
        }
      : null;
  return { userId, tzOffset, tokens, created: false };
}

export async function upsertUser(
  telegramId: string,
  username: string | null,
  tzOffsetHint: number | null = null,
): Promise<number> {
  return (await getUserContext(telegramId, username, tzOffsetHint)).userId;
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
 *  `stepsToday` is the cumulative count for the *player's local* day (the client re-sends the
 *  running total, so we take the max to stay idempotent against retries), and `tzOffset` is what
 *  defines which local day that is.
 *
 *  This is the hot path — it runs on every 20-second sync — so it reads everything it needs in
 *  one batched round trip, writes at most one more, and short-circuits entirely when a sync
 *  brings nothing new (which is most of them). */
export async function recordSteps(userId: number, stepsToday: number, tzOffset: number): Promise<SyncState> {
  await ensureSchema();
  const date = localDate(tzOffset);
  const prevDate = shiftDate(date, -1);

  const [petRes, todayRes, prevRes] = await db.batch(
    [
      { sql: `SELECT ${PET_COLUMNS_WITHOUT_ART} FROM pets WHERE user_id = ?`, args: [userId] },
      { sql: "SELECT steps, milestones_applied FROM step_logs WHERE user_id = ? AND date = ?", args: [userId, date] },
      { sql: "SELECT steps FROM step_logs WHERE user_id = ? AND date = ?", args: [userId, prevDate] },
    ],
    "read",
  );

  const pet = (petRes.rows[0] as unknown as PetWithoutArt | undefined) ?? (await getOrCreatePet(userId));
  const row = todayRes.rows[0] as unknown as { steps: number; milestones_applied: string } | undefined;
  const yesterdaySteps = Number((prevRes.rows[0] as unknown as { steps: number } | undefined)?.steps ?? 0);

  const previousSteps = Number(row?.steps ?? 0);
  const newSteps = Math.max(previousSteps, stepsToday);
  const delta = newSteps - previousSteps;

  let { health, happiness, intellect, strength } = pet;
  const lifetimeSteps = pet.lifetime_steps + delta;

  // XP is derived fresh from lifetime_steps every time (not accumulated), so it can never
  // drift from it — "steps to next level" always matches the step ring's own number exactly,
  // with no hidden conversion the player has no way to verify. This also self-heals any
  // pet whose `xp` was thrown off by the now-removed care multiplier. Care/rarity effects
  // live elsewhere (milestone reward size below, and the stat-cap/decay-resistance bonuses),
  // never on this figure.
  // bonus_steps (referral head starts) is subtracted so granted steps can speed up hatching
  // without ever inflating the level counter — that stays a 1:1 mirror of steps actually walked.
  const xp = Math.max(0, lifetimeSteps - pet.bonus_steps - EGG_HATCH_STEPS);
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
    streakDays = pet.last_active_date === prevDate ? streakDays + 1 : 1;

    let inactiveDays = yesterdaySteps < MILESTONES.food.steps ? 1 : 0;
    if (pet.last_active_date) {
      const gapDays = daysBetween(pet.last_active_date, date) - 1;
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

  const evolutionStage = effectiveEvolutionStage(level, pet.evolution_bonus_tiers);

  const updatedPet: PetWithoutArt = {
    ...pet,
    stage,
    species,
    rarity,
    level,
    xp,
    lifetime_steps: lifetimeSteps,
    health,
    happiness,
    intellect,
    strength,
    streak_days: streakDays,
    last_active_date: date,
    hatched_at: hatchedAt,
  };

  const stepLogChanged = delta > 0 || appliedNow.size !== appliedBefore.size;
  const petChanged =
    stage !== pet.stage ||
    species !== pet.species ||
    rarity !== pet.rarity ||
    level !== pet.level ||
    xp !== pet.xp ||
    lifetimeSteps !== pet.lifetime_steps ||
    health !== pet.health ||
    happiness !== pet.happiness ||
    intellect !== pet.intellect ||
    strength !== pet.strength ||
    streakDays !== pet.streak_days ||
    date !== pet.last_active_date ||
    hatchedAt !== pet.hatched_at;

  const writes: InStatement[] = [];
  if (stepLogChanged) {
    writes.push({
      sql: `INSERT INTO step_logs (user_id, date, steps, milestones_applied) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET steps = excluded.steps, milestones_applied = excluded.milestones_applied`,
      args: [userId, date, newSteps, [...appliedNow].join(",")],
    });
  }
  if (petChanged) {
    writes.push({
      sql: `UPDATE pets SET stage = ?, species = ?, rarity = ?, level = ?, xp = ?, lifetime_steps = ?, health = ?, happiness = ?,
            intellect = ?, strength = ?, streak_days = ?, last_active_date = ?, hatched_at = ?
            WHERE user_id = ?`,
      args: [stage, species, rarity, level, xp, lifetimeSteps, health, happiness, intellect, strength, streakDays, date, hatchedAt, userId],
    });
  }
  // A sync that brought nothing new (by far the most common case when polling every 20s)
  // writes nothing at all and is over after the single read batch above.
  if (writes.length > 0) await db.batch(writes, "write");

  // Hatching is what confirms a referral was a real player rather than a throwaway account, so
  // it's the moment the inviter's half of the reward is released. No-op if nobody invited them.
  if (justHatched) {
    try {
      await grantInviterReward(userId);
    } catch (err) {
      console.error(`inviter reward failed for invitee ${userId}`, err);
    }
  }

  await syncAvatarToStage(userId, updatedPet, evolutionStage, justHatched);

  return { pet: updatedPet, todaySteps: newSteps };
}

/** Brings the pet's artwork in line with the evolution stage its level has actually reached.
 *
 *  This used to fire only on the exact sync that crossed a stage boundary, and only if an
 *  avatar happened to be in the "completed" state right then — so an evolution that landed
 *  while the first avatar was still generating (or while the image API was erroring) was lost
 *  permanently, and the pet visually never upgraded again. Instead we now persist which stage
 *  the current artwork depicts (`avatar_stage`) and reconcile against it on every sync, so a
 *  missed or failed upgrade is simply retried on the next one. */
async function syncAvatarToStage(
  userId: number,
  pet: PetWithoutArt,
  evolutionStage: EvolutionStage,
  justHatched: boolean,
): Promise<void> {
  if (justHatched) {
    // Best-effort: kick off the pet's very first avatar right away so the reveal feels alive —
    // completely bare/unclothed (see EVOLUTION_OUTFIT_PROMPT["baby"]), gear gets earned through
    // evolution. A random seed is rolled once here and reused on every future generation for
    // extra visual consistency on top of the image-to-image reference.
    try {
      const seed = Math.floor(Math.random() * 2 ** 31);
      const gen = await startAvatarGeneration(buildPetPrompt(pet.species, "", pet.rarity, evolutionStage), { seed });
      await setAvatarPending(userId, gen.id, "", seed, evolutionStage);
      pet.avatar_status = "pending";
    } catch (err) {
      console.error("hatch avatar generation failed", err);
      // manual generation remains available
    }
    return;
  }

  // Only a finished avatar can be evolved, and only one job at a time.
  if (pet.avatar_status !== "completed") return;

  // Pets that predate the avatar_stage column have artwork from the hatch generation, i.e. bare.
  const currentArtStage = pet.avatar_stage ?? "baby";
  if (nextEvolutionStageToward(currentArtStage, evolutionStage) === null) return;

  // The image-to-image path needs a reference the generation API can actually fetch. Pets
  // created before this was fixed have a `data:` URI stored there, which the API rejects
  // outright — for those, redraw from scratch instead of leaving them stuck forever.
  const reference = pet.avatar_source_url?.startsWith("http") ? pet.avatar_source_url : null;

  // With a usable reference, edit the EXISTING artwork to add exactly one tier of gear, so the
  // pet stays recognizably the same creature. Without one, generate fresh from the stage's full
  // cumulative outfit description — which lets it jump straight to the current stage, since that
  // prompt already describes everything the pet should be wearing by then.
  const targetStage = reference ? nextEvolutionStageToward(currentArtStage, evolutionStage)! : evolutionStage;
  const prompt = reference
    ? buildEvolutionEditPrompt(pet.species, pet.rarity, targetStage)
    : buildPetPrompt(pet.species, "", pet.rarity, targetStage);

  try {
    const gen = await startAvatarGeneration(prompt, {
      ...(reference ? { images: [reference], strength: 0.35 } : {}),
      seed: pet.avatar_seed ?? undefined,
    });
    await setAvatarPending(userId, gen.id, pet.avatar_description ?? "", pet.avatar_seed ?? undefined, targetStage);
    pet.avatar_status = "pending";
    pet.avatar_target_stage = targetStage;
  } catch (err) {
    // Logged rather than swallowed: this failing silently is exactly why evolutions went
    // unnoticed for so long. The pet keeps its current art and retries on the next sync.
    console.error(`evolution ${currentArtStage} -> ${targetStage} failed for user ${userId}`, err);
  }
}

/** Wipes a pet back to a brand-new egg and deletes its step history, so the player can start
 *  completely clean — e.g. after removing the manual debug-step controls, to shed any steps
 *  those added that are now inseparably mixed into lifetime_steps/step_logs alongside real
 *  Google Fit data. Irreversible; the Google account link itself (on the `users` row) is
 *  untouched, so Google Fit stays connected and simply starts contributing to a fresh pet.
 *  `evolution_bonus_tiers` also survives on purpose — those tiers were earned by inviting real
 *  players, and resetting your own pet shouldn't confiscate them. */
export async function resetPet(userId: number): Promise<Pet> {
  await ensureSchema();
  await db.batch(
    [
      { sql: "DELETE FROM step_logs WHERE user_id = ?", args: [userId] },
      {
        sql: `UPDATE pets SET stage = 'egg', species = 'unknown', rarity = 'common', level = 0, xp = 0, name = NULL,
              lifetime_steps = 0, health = 50, happiness = 50, intellect = 10, strength = 10, streak_days = 0,
              last_active_date = NULL, hatched_at = NULL, avatar_url = NULL, avatar_status = 'none',
              avatar_generation_id = NULL, avatar_description = NULL, avatar_seed = NULL, avatar_source_url = NULL,
              avatar_stage = NULL, avatar_target_stage = NULL, bonus_steps = 0
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

/** Pet plus today's step count in a single round trip — what every screen needs on open. */
export async function getPetState(userId: number, tzOffset: number): Promise<PetState> {
  await ensureSchema();
  const [petRes, stepsRes] = await db.batch(
    [
      { sql: "SELECT * FROM pets WHERE user_id = ?", args: [userId] },
      { sql: "SELECT steps FROM step_logs WHERE user_id = ? AND date = ?", args: [userId, localDate(tzOffset)] },
    ],
    "read",
  );
  const pet = (petRes.rows[0] as unknown as Pet | undefined) ?? (await getOrCreatePet(userId));
  const todaySteps = Number((stepsRes.rows[0] as unknown as { steps: number } | undefined)?.steps ?? 0);
  return { pet, todaySteps };
}

export async function setPetName(userId: number, name: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: "UPDATE pets SET name = ? WHERE user_id = ?",
    args: [name, userId],
  });
}

/** `targetStage` is the evolution stage the artwork being generated will depict — recorded now
 *  and promoted to `avatar_stage` only once the image actually lands (see completeAvatar), so a
 *  failed generation leaves the pet's recorded look untouched and gets retried. */
export async function setAvatarPending(
  userId: number,
  generationId: string,
  description: string,
  seed?: number,
  targetStage?: EvolutionStage,
): Promise<void> {
  await ensureSchema();
  if (seed !== undefined) {
    await db.execute({
      sql: `UPDATE pets SET avatar_status = 'pending', avatar_generation_id = ?, avatar_description = ?, avatar_seed = ?,
            avatar_target_stage = ? WHERE user_id = ?`,
      args: [generationId, description, seed, targetStage ?? null, userId],
    });
  } else {
    await db.execute({
      sql: `UPDATE pets SET avatar_status = 'pending', avatar_generation_id = ?, avatar_description = ?,
            avatar_target_stage = ? WHERE user_id = ?`,
      args: [generationId, description, targetStage ?? null, userId],
    });
  }
}

export async function completeAvatar(userId: number, displayUrl: string, sourceUrl: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: `UPDATE pets SET avatar_status = 'completed', avatar_url = ?, avatar_source_url = ?,
          avatar_stage = COALESCE(avatar_target_stage, avatar_stage, 'baby'), avatar_target_stage = NULL
          WHERE user_id = ?`,
    args: [displayUrl, sourceUrl, userId],
  });
}

export async function failAvatar(userId: number): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: "UPDATE pets SET avatar_status = 'failed', avatar_target_stage = NULL WHERE user_id = ?",
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
 *  Returns null if the user has never connected Google Fit. Pass `known` when the tokens were
 *  already loaded (getUserContext does) to skip a redundant round trip. */
export async function getValidGoogleAccessToken(
  userId: number,
  known?: GoogleAccountTokens | null,
): Promise<string | null> {
  const tokens = known !== undefined ? known : await getGoogleTokens(userId);
  if (!tokens) return null;
  if (tokens.expiry > Date.now() + 60_000) return tokens.accessToken;

  const refreshed = await refreshAccessToken(tokens.refreshToken);
  await db.execute({
    sql: "UPDATE users SET google_access_token = ?, google_token_expiry = ? WHERE id = ?",
    args: [refreshed.accessToken, refreshed.expiresAt, userId],
  });
  return refreshed.accessToken;
}
