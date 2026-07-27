import { db } from "./db.js";
import { ensureSchema } from "./schema.js";
import { localDate, weekStart } from "./tz.js";

const LEADERBOARD_LIMIT = 50;

export interface PlayerRow {
  userId: number;
  username: string | null;
  petName: string | null;
  species: string;
  rarity: string;
  level: number;
  hatched: boolean;
  avatarGenerationId: string | null;
  weekSteps: number;
  isMe: boolean;
}

/** Shared shape of the joined player row both queries below return. */
const PLAYER_SELECT = `u.id AS user_id, u.username, p.name AS pet_name, p.species, p.rarity, p.level,
  p.stage, p.avatar_generation_id, COALESCE(sw.steps, 0) AS week_steps`;

function toPlayer(row: Record<string, unknown>, meId: number): PlayerRow {
  const userId = Number(row.user_id);
  return {
    userId,
    username: (row.username as string | null) ?? null,
    petName: (row.pet_name as string | null) ?? null,
    species: (row.species as string | null) ?? "unknown",
    rarity: (row.rarity as string | null) ?? "common",
    level: Number(row.level ?? 0),
    hatched: row.stage === "hatched",
    avatarGenerationId: (row.avatar_generation_id as string | null) ?? null,
    weekSteps: Number(row.week_steps ?? 0),
    isMe: userId === meId,
  };
}

export interface SocialSnapshot {
  weekStart: string;
  friends: PlayerRow[];
  top: PlayerRow[];
  myRank: number | null;
  myWeekSteps: number;
}

/** Friends are the referral graph in both directions — everyone this player invited plus
 *  whoever invited them — with the player themselves folded in so the list doubles as a
 *  standings table they can find themselves in. */
export async function getSocialSnapshot(userId: number, tzOffset: number): Promise<SocialSnapshot> {
  await ensureSchema();
  const week = weekStart(localDate(tzOffset));

  const [friendsRes, topRes, rankRes] = await db.batch(
    [
      {
        sql: `SELECT ${PLAYER_SELECT}
              FROM users u
              LEFT JOIN pets p ON p.user_id = u.id
              LEFT JOIN step_weeks sw ON sw.user_id = u.id AND sw.week_start = ?
              WHERE u.id = ?
                 OR u.id IN (SELECT invitee_user_id FROM referrals WHERE inviter_user_id = ?)
                 OR u.id IN (SELECT inviter_user_id FROM referrals WHERE invitee_user_id = ?)
              ORDER BY week_steps DESC, u.id ASC`,
        args: [week, userId, userId, userId],
      },
      {
        // Only players who actually moved this week appear, so the board never opens on a wall
        // of zeroes. Ranking happens in SQL against a single shared week key — see weekStart().
        sql: `SELECT ${PLAYER_SELECT}
              FROM step_weeks sw
              JOIN users u ON u.id = sw.user_id
              LEFT JOIN pets p ON p.user_id = u.id
              WHERE sw.week_start = ? AND sw.steps > 0
              ORDER BY sw.steps DESC, u.id ASC
              LIMIT ${LEADERBOARD_LIMIT}`,
        args: [week],
      },
      {
        // Position even when the player is far outside the visible top.
        sql: `SELECT COUNT(*) AS ahead,
                     (SELECT COALESCE(steps, 0) FROM step_weeks WHERE user_id = ? AND week_start = ?) AS mine
              FROM step_weeks
              WHERE week_start = ?
                AND steps > (SELECT COALESCE(steps, 0) FROM step_weeks WHERE user_id = ? AND week_start = ?)`,
        args: [userId, week, week, userId, week],
      },
    ],
    "read",
  );

  const rankRow = rankRes.rows[0] as unknown as { ahead: number; mine: number } | undefined;
  const myWeekSteps = Number(rankRow?.mine ?? 0);

  return {
    weekStart: week,
    friends: friendsRes.rows.map((row) => toPlayer(row as Record<string, unknown>, userId)),
    top: topRes.rows.map((row) => toPlayer(row as Record<string, unknown>, userId)),
    // A player with no steps this week has no meaningful position yet.
    myRank: myWeekSteps > 0 ? Number(rankRow?.ahead ?? 0) + 1 : null,
    myWeekSteps,
  };
}
