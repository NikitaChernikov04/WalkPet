import { db } from "./db.js";
import { ensureSchema } from "./schema.js";
import { EGG_HATCH_STEPS, EVOLUTION_ORDER } from "./leveling.js";
import { pickRandomSpecies } from "./species.js";

/** Steps handed to a newly invited player the moment their referral is attributed. Exactly the
 *  hatching threshold, so the egg doesn't merely crack — it hatches on the spot and the invited
 *  player meets a real creature, with a species and a rarity, on their very first launch. The
 *  earlier 3000 left them staring at a progress bar 4000 steps from the reveal, which is a poor
 *  thing to hand someone as a welcome.
 *
 *  Banked in pets.bonus_steps as well as lifetime_steps, so the head start never inflates the
 *  level counter — XP subtracts bonus_steps precisely so levels stay a 1:1 mirror of steps
 *  actually walked. An invited player therefore starts at level 0 like everyone else; what they
 *  are given is the pet, not a shortcut past the levelling. */
export const INVITEE_BONUS_STEPS = EGG_HATCH_STEPS;

/** Free evolution tiers the inviter earns, one per confirmed referral, capped so the image
 *  generation each one triggers can't run away with the API budget. */
export const MAX_EVOLUTION_BONUS_TIERS = 3;

// Ambiguous glyphs (0/O, 1/I/l) left out so a code read off a screen can't be mistyped.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Both link formats carry the same code; `ref_` is the prefix the bot deep link uses because a
 *  bare code is indistinguishable from any other /start payload. */
export function parseReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.startsWith("ref_") ? raw.slice(4) : raw;
  return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4,16}$/.test(code) ? code : null;
}

/** Returns the user's invite code, creating one on first use. Existing players predate the
 *  column, so this backfills lazily rather than needing a migration pass over every row. */
export async function getOrCreateReferralCode(userId: number): Promise<string> {
  await ensureSchema();
  const existing = await db.execute({ sql: "SELECT referral_code FROM users WHERE id = ?", args: [userId] });
  const current = (existing.rows[0] as unknown as { referral_code: string | null } | undefined)?.referral_code;
  if (current) return current;

  // The unique index is the real guard; retry on the (vanishingly rare) collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      await db.execute({ sql: "UPDATE users SET referral_code = ? WHERE id = ?", args: [code, userId] });
      return code;
    } catch (err) {
      if (attempt === 4) throw err;
    }
  }
  throw new Error("could not allocate referral code");
}

export interface AttributionResult {
  attributed: boolean;
  bonusSteps: number;
}

/** Credits `inviteeUserId` to whoever owns `code`, and pays the invitee's half of the reward.
 *
 *  Call this ONLY for a user row that was just created — being brand new is what makes the
 *  attribution trustworthy. Everything else is enforced here: an unknown code, a self-referral,
 *  or an invitee who already has a referral row is silently ignored. The invitee primary key on
 *  `referrals` makes the last of those impossible to race, too.
 *
 *  The inviter's half is deliberately NOT paid here — see grantInviterReward. */
export async function attributeReferral(inviteeUserId: number, code: string): Promise<AttributionResult> {
  await ensureSchema();
  const none = { attributed: false, bonusSteps: 0 };

  const inviterRes = await db.execute({ sql: "SELECT id FROM users WHERE referral_code = ?", args: [code] });
  const inviterUserId = Number((inviterRes.rows[0] as unknown as { id: number } | undefined)?.id ?? 0);
  if (!inviterUserId || inviterUserId === inviteeUserId) return none;

  const { species, rarity } = pickRandomSpecies();

  try {
    await db.batch(
      [
        {
          sql: `INSERT INTO referrals (invitee_user_id, inviter_user_id, code) VALUES (?, ?, ?)
                ON CONFLICT (invitee_user_id) DO NOTHING`,
          args: [inviteeUserId, inviterUserId, code],
        },
        // Pre-creates the pet already hatched. Species and rarity are rolled here for the same
        // reason recordSteps rolls them at the hatching moment — once, never reshuffled — and
        // the artwork follows on the first sync, which is what syncAvatarToStage reconciles.
        // ON CONFLICT DO NOTHING keeps this safe if the pet already exists: in that case the
        // player isn't new and gets no bonus, which is the intended outcome rather than a bug.
        {
          sql: `INSERT INTO pets (user_id, stage, species, rarity, lifetime_steps, bonus_steps, hatched_at)
                VALUES (?, 'hatched', ?, ?, ?, ?, ?)
                ON CONFLICT (user_id) DO NOTHING`,
          args: [inviteeUserId, species, rarity, INVITEE_BONUS_STEPS, INVITEE_BONUS_STEPS, new Date().toISOString()],
        },
      ],
      "write",
    );
  } catch (err) {
    console.error(`referral attribution failed for invitee ${inviteeUserId}`, err);
    return none;
  }

  return { attributed: true, bonusSteps: INVITEE_BONUS_STEPS };
}

/** Pays the inviter once their invitee has *walked* EGG_HATCH_STEPS of their own — the bar an
 *  uninvited player has to clear to hatch anything at all.
 *
 *  Deferring it this far is the anti-farming measure: registering throwaway accounts earns
 *  nothing, because only genuine walking releases the reward. It used to hang off the invitee's
 *  hatching moment, which was the same bar expressed differently — but invited players now start
 *  hatched, so that moment no longer happens for them and hanging the payout on it would have
 *  meant inviters were never paid again. recordSteps therefore triggers on the invitee's XP
 *  leaving zero instead, XP being defined as steps walked beyond the hatch threshold with the
 *  granted head start subtracted out. Same bar, still 7000 steps of real walking.
 *
 *  A no-op for anyone who wasn't referred. */
export async function grantInviterReward(inviteeUserId: number): Promise<void> {
  await ensureSchema();
  const res = await db.execute({
    sql: "SELECT inviter_user_id FROM referrals WHERE invitee_user_id = ? AND inviter_reward_state = 'pending'",
    args: [inviteeUserId],
  });
  const inviterUserId = Number((res.rows[0] as unknown as { inviter_user_id: number } | undefined)?.inviter_user_id ?? 0);
  if (!inviterUserId) return;

  await db.batch(
    [
      {
        // Guarded by the same 'pending' predicate so a concurrent hatch can't pay twice.
        sql: "UPDATE referrals SET inviter_reward_state = 'granted' WHERE invitee_user_id = ? AND inviter_reward_state = 'pending'",
        args: [inviteeUserId],
      },
      // The inviter will normally have a pet already — opening the app at all creates one, and
      // they had to open it to get a code. But if they somehow don't, the UPDATE below would
      // match nothing while the row above still records the reward as paid, quietly swallowing
      // it. Creating the egg first makes the payout land no matter what.
      { sql: "INSERT INTO pets (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING", args: [inviterUserId] },
      {
        sql: `UPDATE pets SET evolution_bonus_tiers = evolution_bonus_tiers + 1
              WHERE user_id = ? AND evolution_bonus_tiers < ?`,
        args: [inviterUserId, MAX_EVOLUTION_BONUS_TIERS],
      },
    ],
    "write",
  );
}

export interface InvitedFriend {
  userId: number;
  username: string | null;
  petName: string | null;
  species: string;
  level: number;
  hatched: boolean;
  rewardGranted: boolean;
  avatarGenerationId: string | null;
}

export interface ReferralSummary {
  code: string;
  invitedCount: number;
  confirmedCount: number;
  bonusTiers: number;
  maxBonusTiers: number;
  invited: InvitedFriend[];
  invitedByUsername: string | null;
}

export async function getReferralSummary(userId: number): Promise<ReferralSummary> {
  const code = await getOrCreateReferralCode(userId);

  const [invitedRes, inviterRes, petRes] = await db.batch(
    [
      {
        sql: `SELECT u.id, u.username, p.name AS pet_name, p.species, p.level, p.stage,
                     p.avatar_generation_id, r.inviter_reward_state
              FROM referrals r
              JOIN users u ON u.id = r.invitee_user_id
              LEFT JOIN pets p ON p.user_id = u.id
              WHERE r.inviter_user_id = ?
              ORDER BY r.created_at DESC`,
        args: [userId],
      },
      {
        sql: `SELECT u.username FROM referrals r JOIN users u ON u.id = r.inviter_user_id
              WHERE r.invitee_user_id = ?`,
        args: [userId],
      },
      { sql: "SELECT evolution_bonus_tiers FROM pets WHERE user_id = ?", args: [userId] },
    ],
    "read",
  );

  const invited: InvitedFriend[] = (
    invitedRes.rows as unknown as {
      id: number;
      username: string | null;
      pet_name: string | null;
      species: string | null;
      level: number | null;
      stage: string | null;
      avatar_generation_id: string | null;
      inviter_reward_state: string;
    }[]
  ).map((row) => ({
    userId: Number(row.id),
    username: row.username,
    petName: row.pet_name,
    species: row.species ?? "unknown",
    level: Number(row.level ?? 0),
    hatched: row.stage === "hatched",
    rewardGranted: row.inviter_reward_state === "granted",
    avatarGenerationId: row.avatar_generation_id,
  }));

  return {
    code,
    invitedCount: invited.length,
    confirmedCount: invited.filter((i) => i.rewardGranted).length,
    bonusTiers: Number((petRes.rows[0] as unknown as { evolution_bonus_tiers: number } | undefined)?.evolution_bonus_tiers ?? 0),
    maxBonusTiers: Math.min(MAX_EVOLUTION_BONUS_TIERS, EVOLUTION_ORDER.length - 1),
    invited,
    invitedByUsername:
      (inviterRes.rows[0] as unknown as { username: string | null } | undefined)?.username ?? null,
  };
}
