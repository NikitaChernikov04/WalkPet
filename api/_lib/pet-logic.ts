import { db, ensureSchema } from "./db.js";
import { refreshAccessToken } from "./googleFit.js";
import { buildPetPrompt, startAvatarGeneration } from "./nanobanana.js";

export const EGG_CRACK_STEPS = 3000;
export const EGG_HATCH_STEPS = 7000;

export const MILESTONES = {
  food: { steps: 1000, stat: "health", amount: 5 },
  mood: { steps: 5000, stat: "happiness", amount: 5 },
  training: { steps: 10000, stat: "strength", amount: 5 },
  adventure: { steps: 15000, stat: "intellect", amount: 5 },
} as const;

type MilestoneKey = keyof typeof MILESTONES;

const DECAY_PER_INACTIVE_DAY = 5;
const MAX_DECAY_DAYS = 30;

const AVATAR_FLAVORS = [
  "космический исследователь в скафандре",
  "маленький рыцарь в блестящих доспехах",
  "диджей в неоновых наушниках",
  "искатель приключений с картой и биноклем",
  "супергерой в развевающемся плаще",
  "путешественник во времени в стимпанк-очках",
  "пиратский капитан в треуголке",
  "детектив в плаще со шляпой и лупой",
  "рок-звезда с электрогитарой",
  "волшебник в мантии со звёздами",
];

function randomAvatarFlavor(): string {
  return AVATAR_FLAVORS[Math.floor(Math.random() * AVATAR_FLAVORS.length)];
}

export interface Pet {
  id: number;
  user_id: number;
  stage: "egg" | "cracking" | "hatched";
  species: string;
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
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
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

function classifySpecies(pet: Pet, activeDays: number): string {
  if (pet.streak_days >= 30) return "Дракон";
  const avgDailySteps = activeDays > 0 ? pet.lifetime_steps / activeDays : 0;
  if (avgDailySteps >= 15000) return "Тигр";
  if (avgDailySteps >= 7000) return "Волк";
  return "Ленивый кот";
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
  let { health, happiness, intellect, strength, lifetime_steps: lifetimeSteps } = pet;
  lifetimeSteps += delta;

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
      const decay = DECAY_PER_INACTIVE_DAY * inactiveDays;
      health = clamp(health - decay);
      happiness = clamp(happiness - decay);
      intellect = clamp(intellect - decay);
      strength = clamp(strength - decay);
    }
  }

  const appliedBefore = new Set((row?.milestones_applied ?? "").split(",").filter(Boolean));
  const appliedNow = new Set(appliedBefore);
  for (const [key, milestone] of Object.entries(MILESTONES) as [MilestoneKey, (typeof MILESTONES)[MilestoneKey]][]) {
    if (newSteps >= milestone.steps && !appliedBefore.has(key)) {
      appliedNow.add(key);
      if (milestone.stat === "health") health = clamp(health + milestone.amount);
      if (milestone.stat === "happiness") happiness = clamp(happiness + milestone.amount);
      if (milestone.stat === "strength") strength = clamp(strength + milestone.amount);
      if (milestone.stat === "intellect") intellect = clamp(intellect + milestone.amount);
    }
  }
  if (appliedNow.size !== appliedBefore.size) {
    await db.execute({
      sql: "UPDATE step_logs SET milestones_applied = ? WHERE user_id = ? AND date = ?",
      args: [[...appliedNow].join(","), userId, date],
    });
  }

  if (streakDays > 0 && streakDays % 7 === 0 && streakDays !== pet.streak_days) {
    happiness = clamp(happiness + 10);
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

  let species = pet.species;
  if (stage === "hatched") {
    const activeDaysRes = await db.execute({
      sql: "SELECT COUNT(*) as n FROM step_logs WHERE user_id = ? AND steps > 0",
      args: [userId],
    });
    const activeDays = Number((activeDaysRes.rows[0] as unknown as { n: number }).n);
    species = classifySpecies({ ...pet, lifetime_steps: lifetimeSteps, streak_days: streakDays }, activeDays);
  }

  await db.execute({
    sql: `UPDATE pets SET stage = ?, species = ?, lifetime_steps = ?, health = ?, happiness = ?,
          intellect = ?, strength = ?, streak_days = ?, last_active_date = ?, hatched_at = ?
          WHERE user_id = ?`,
    args: [stage, species, lifetimeSteps, health, happiness, intellect, strength, streakDays, date, hatchedAt, userId],
  });

  if (justHatched) {
    // Best-effort: kick off a randomized avatar right away so the reveal feels alive.
    // If Polza errors out here, avatar_status just stays "none" and the player can still
    // generate one manually from the pet panel.
    try {
      const description = randomAvatarFlavor();
      const gen = await startAvatarGeneration(buildPetPrompt(species, description));
      await setAvatarPending(userId, gen.id, description);
    } catch {
      // ignore — manual generation remains available
    }
  }

  const updated = await db.execute({ sql: "SELECT * FROM pets WHERE user_id = ?", args: [userId] });
  return updated.rows[0] as unknown as Pet;
}

/** Debug-only: restores the pet (and today's step log) to a snapshot taken client-side right
 *  before a debug-tap session started, so the "reset" undoes only the manually-tapped steps —
 *  real history from Google Fit or an actual pedometer, captured in that snapshot, is untouched.
 *  Milestones_applied is recomputed from the restored day-total so a later sync doesn't skip
 *  re-granting a milestone whose stat bonus this restore just undid. */
export async function restorePetSnapshot(
  userId: number,
  snapshot: Omit<Pet, "id" | "user_id" | "created_at">,
  todaySteps: number,
): Promise<Pet> {
  await ensureSchema();
  const date = today();

  const appliedNow = (Object.entries(MILESTONES) as [MilestoneKey, (typeof MILESTONES)[MilestoneKey]][])
    .filter(([, m]) => todaySteps >= m.steps)
    .map(([key]) => key)
    .join(",");

  const existing = await db.execute({ sql: "SELECT 1 FROM step_logs WHERE user_id = ? AND date = ?", args: [userId, date] });
  if (existing.rows[0]) {
    await db.execute({
      sql: "UPDATE step_logs SET steps = ?, milestones_applied = ? WHERE user_id = ? AND date = ?",
      args: [todaySteps, appliedNow, userId, date],
    });
  } else {
    await db.execute({
      sql: "INSERT INTO step_logs (user_id, date, steps, milestones_applied) VALUES (?, ?, ?, ?)",
      args: [userId, date, todaySteps, appliedNow],
    });
  }

  await db.execute({
    sql: `UPDATE pets SET stage = ?, species = ?, lifetime_steps = ?, health = ?, happiness = ?,
          intellect = ?, strength = ?, streak_days = ?, last_active_date = ?, hatched_at = ?,
          avatar_url = ?, avatar_status = ?, avatar_generation_id = ?, avatar_description = ?
          WHERE user_id = ?`,
    args: [
      snapshot.stage,
      snapshot.species,
      snapshot.lifetime_steps,
      snapshot.health,
      snapshot.happiness,
      snapshot.intellect,
      snapshot.strength,
      snapshot.streak_days,
      snapshot.last_active_date,
      snapshot.hatched_at,
      snapshot.avatar_url,
      snapshot.avatar_status,
      snapshot.avatar_generation_id,
      snapshot.avatar_description,
      userId,
    ],
  });

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

export async function setAvatarPending(userId: number, generationId: string, description: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: `UPDATE pets SET avatar_status = 'pending', avatar_generation_id = ?, avatar_description = ?
          WHERE user_id = ?`,
    args: [generationId, description, userId],
  });
}

export async function completeAvatar(userId: number, url: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: "UPDATE pets SET avatar_status = 'completed', avatar_url = ? WHERE user_id = ?",
    args: [url, userId],
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
