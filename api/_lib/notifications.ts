import { db } from "./db.js";
import { ensureSchema } from "./schema.js";
import { localDate, shiftDate } from "./tz.js";
import { fetchDailySteps } from "./googleFit.js";
import { getValidGoogleAccessToken, MILESTONES, recordSteps } from "./pet-logic.js";

/** The evening window, in the player's own local time, during which a streak-risk nudge may be
 *  sent. The scheduler fires hourly and each player is eligible for at most one message per
 *  local day, so a two-hour window means "whichever of those two hours comes first". */
const WINDOW_START_HOUR = 19;
const WINDOW_END_HOUR = 21;

/** A day counts toward the streak once the first milestone is reached — the same threshold
 *  recordSteps uses to decide a day was active, so the warning can never contradict the rule. */
const DAILY_GOAL = MILESTONES.food.steps;

const KIND = "streak_risk";

/** Bounded so one invocation can't run past the function timeout. Well above the current player
 *  count; if it ever binds, the next hourly run picks up whoever was left. */
const MAX_PER_RUN = 50;

/** Every UTC offset (in minutes) whose local clock currently sits inside the evening window.
 *  Computing the eligible offsets here and matching them with IN keeps the selection a plain
 *  indexed comparison, instead of pushing per-user clock arithmetic into SQL where it would
 *  have to be written twice for two dialects. */
export function offsetsInEveningWindow(now: number = Date.now()): number[] {
  const utcMinutes = Math.floor(now / 60_000) % 1440;
  const offsets: number[] = [];
  // Real-world zones run from UTC-12:00 to UTC+14:00, on quarter-hour boundaries.
  for (let offset = -720; offset <= 840; offset += 15) {
    const hour = Math.floor(((((utcMinutes + offset) % 1440) + 1440) % 1440) / 60);
    if (hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR) offsets.push(offset);
  }
  return offsets;
}

/** Three phrasings rotated deterministically, so a player who gets nudged several days running
 *  doesn't read the same sentence every time. The pet's own name comes from the database — it
 *  is never invented here, so the message always matches what they see in the app. */
function buildMessage(petName: string | null, streakDays: number, steps: number, variant: number): string {
  const pet = petName ?? "твой питомец";
  const left = Math.max(0, DAILY_GOAL - steps).toLocaleString("ru-RU");
  const messages = [
    `🔥 Не потеряй стрик! Прогуляйся сегодня, чтобы ${pet} не загрустил.`,
    `🔥 ${pet} ждёт прогулку — до дневной нормы осталось ${left} шагов. Стрик ${streakDays} дн. на кону!`,
    `🔥 Стрик ${streakDays} дн. под угрозой. ${pet} верит в тебя — ещё ${left} шагов, и день засчитан.`,
  ];
  return messages[variant % messages.length];
}

async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    // 403 means the player blocked the bot — expected, not worth escalating.
    console.error(`sendMessage to ${chatId} failed: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

interface Candidate {
  id: number;
  telegram_id: string;
  tz_offset: number;
  pet_name: string | null;
  streak_days: number;
  last_active_date: string | null;
}

export interface ReminderRun {
  considered: number;
  notified: number;
  skippedGoalMet: number;
  skippedAlreadySent: number;
  failed: number;
}

export async function runStreakReminders(now: number = Date.now()): Promise<ReminderRun> {
  await ensureSchema();
  const result: ReminderRun = { considered: 0, notified: 0, skippedGoalMet: 0, skippedAlreadySent: 0, failed: 0 };

  const offsets = offsetsInEveningWindow(now);
  if (offsets.length === 0) return result;

  const placeholders = offsets.map(() => "?").join(",");
  const candidatesRes = await db.execute({
    // Only players who have something to lose and a step source to check: a live streak, a
    // hatched pet, and a Google account connected. Without a refresh token there is no way to
    // know whether they walked today, so warning them would be guesswork.
    sql: `SELECT u.id, u.telegram_id, u.tz_offset, p.name AS pet_name, p.streak_days, p.last_active_date
          FROM users u
          JOIN pets p ON p.user_id = u.id
          WHERE u.tz_offset IN (${placeholders})
            AND p.stage = 'hatched'
            AND p.streak_days > 0
            AND u.google_refresh_token IS NOT NULL
          LIMIT ${MAX_PER_RUN}`,
    args: offsets,
  });

  const candidates = candidatesRes.rows as unknown as Candidate[];
  if (candidates.length === 0) return result;

  // A streak whose last active day is older than yesterday is already broken — the app just
  // hasn't recomputed it yet. Nudging those players would be a lie.
  const live = candidates.filter((c) => {
    const today = localDate(Number(c.tz_offset), now);
    return c.last_active_date === today || c.last_active_date === shiftDate(today, -1);
  });

  // One cheap lookup instead of a Google Fit call per already-notified player: the window spans
  // two hourly runs, so on the second one most candidates are expected to be filtered out here.
  const dates = [...new Set(live.map((c) => localDate(Number(c.tz_offset), now)))];
  const sentRes = dates.length
    ? await db.execute({
        sql: `SELECT user_id, date FROM notifications_sent WHERE kind = ? AND date IN (${dates.map(() => "?").join(",")})`,
        args: [KIND, ...dates],
      })
    : { rows: [] };
  const alreadySent = new Set(
    (sentRes.rows as unknown as { user_id: number; date: string }[]).map((r) => `${r.user_id}|${r.date}`),
  );

  for (const candidate of live) {
    const userId = Number(candidate.id);
    const tzOffset = Number(candidate.tz_offset);
    const today = localDate(tzOffset, now);
    result.considered++;

    if (alreadySent.has(`${userId}|${today}`)) {
      result.skippedAlreadySent++;
      continue;
    }

    try {
      const accessToken = await getValidGoogleAccessToken(userId);
      if (!accessToken) continue;

      // Recording rather than merely reading: the player may not have opened the app all day, so
      // this is also what keeps their steps, streak and level current. The notification decision
      // then rests on the same authoritative numbers the app itself would have produced.
      const yesterday = shiftDate(today, -1);
      const steps = await fetchDailySteps(accessToken, yesterday, today, tzOffset);
      const { todaySteps } = await recordSteps(userId, steps.get(today) ?? 0, tzOffset, steps.get(yesterday));

      if (todaySteps >= DAILY_GOAL) {
        result.skippedGoalMet++;
        continue;
      }

      // Claim before sending, so two overlapping runs can't both message the same player. The
      // primary key makes the claim atomic; a losing claim affects no rows.
      const claim = await db.execute({
        sql: `INSERT INTO notifications_sent (user_id, kind, date) VALUES (?, ?, ?)
              ON CONFLICT(user_id, kind, date) DO NOTHING`,
        args: [userId, KIND, today],
      });
      if (claim.rowsAffected === 0) {
        result.skippedAlreadySent++;
        continue;
      }

      const variant = userId + Number(today.slice(-2));
      const sent = await sendTelegramMessage(
        String(candidate.telegram_id),
        buildMessage(candidate.pet_name, Number(candidate.streak_days), todaySteps, variant),
      );

      if (sent) {
        result.notified++;
      } else {
        // Release the claim so the next hourly run can try again within the window.
        result.failed++;
        await db.execute({
          sql: "DELETE FROM notifications_sent WHERE user_id = ? AND kind = ? AND date = ?",
          args: [userId, KIND, today],
        });
      }
    } catch (err) {
      result.failed++;
      console.error(`streak reminder failed for user ${userId}`, err);
    }
  }

  return result;
}
