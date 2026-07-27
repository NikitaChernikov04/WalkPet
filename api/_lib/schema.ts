import { db } from "./db.js";

/** All DDL and every dialect-specific scrap of SQL lives here, so the planned move to Supabase
 *  (Postgres) is a change to this one file rather than an archaeology dig through the codebase.
 *  Everything outside this module sticks to SQL both engines accept — notably `ON CONFLICT …
 *  DO UPDATE SET … excluded.x` and `INSERT … RETURNING id` (libSQL supports RETURNING, so we
 *  never depend on SQLite's `lastInsertRowid`, which has no Postgres equivalent). */
export type Dialect = "sqlite" | "postgres";

export const DIALECT: Dialect = process.env.DB_DIALECT === "postgres" ? "postgres" : "sqlite";
const pg = DIALECT === "postgres";

// SQLite's two-argument MAX()/MIN() are scalar; Postgres spells those GREATEST/LEAST and treats
// MAX as an aggregate only. Anything comparing two values must go through these.
export const greatest = (a: string, b: string) => (pg ? `GREATEST(${a}, ${b})` : `MAX(${a}, ${b})`);
export const least = (a: string, b: string) => (pg ? `LEAST(${a}, ${b})` : `MIN(${a}, ${b})`);

// `INTEGER PRIMARY KEY AUTOINCREMENT` is SQLite's rowid alias and is a syntax error in Postgres.
const PK = pg ? "BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
// Declared BIGINT rather than INTEGER: Postgres-native, and SQLite gives it INTEGER affinity.
const FK = "BIGINT";
// TIMESTAMP + CURRENT_TIMESTAMP is the one date default both engines accept unchanged.
const TS = "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP";
// Local calendar days stay TEXT 'YYYY-MM-DD' — matches the existing step_logs rows, sorts and
// compares correctly in both engines, and sidesteps every timezone-casting difference between
// them. See _lib/tz.ts for why days are computed in the player's zone rather than UTC.
const DAY = "TEXT";

let migrated: Promise<void> | null = null;

const TABLES: [name: string, ddl: string][] = [
  [
    "users",
    `CREATE TABLE IF NOT EXISTS users (
      id ${PK},
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT,
      created_at ${TS}
    )`,
  ],
  [
    "pets",
    `CREATE TABLE IF NOT EXISTS pets (
      id ${PK},
      user_id ${FK} UNIQUE NOT NULL REFERENCES users(id),
      stage TEXT NOT NULL DEFAULT 'egg',
      species TEXT NOT NULL DEFAULT 'unknown',
      lifetime_steps INTEGER NOT NULL DEFAULT 0,
      health INTEGER NOT NULL DEFAULT 50,
      happiness INTEGER NOT NULL DEFAULT 50,
      intellect INTEGER NOT NULL DEFAULT 10,
      strength INTEGER NOT NULL DEFAULT 10,
      streak_days INTEGER NOT NULL DEFAULT 0,
      last_active_date ${DAY},
      hatched_at TEXT,
      created_at ${TS}
    )`,
  ],
  [
    "step_logs",
    `CREATE TABLE IF NOT EXISTS step_logs (
      id ${PK},
      user_id ${FK} NOT NULL REFERENCES users(id),
      date ${DAY} NOT NULL,
      steps INTEGER NOT NULL DEFAULT 0,
      milestones_applied TEXT NOT NULL DEFAULT '',
      UNIQUE(user_id, date)
    )`,
  ],
  [
    // One row per *referred* user. invitee_user_id is the primary key on purpose: that single
    // constraint is the anti-abuse rule — a Telegram account can be credited as someone's
    // referral exactly once, ever, and there is no code path that could re-attribute it.
    "referrals",
    `CREATE TABLE IF NOT EXISTS referrals (
      invitee_user_id ${FK} PRIMARY KEY REFERENCES users(id),
      inviter_user_id ${FK} NOT NULL REFERENCES users(id),
      code TEXT NOT NULL,
      inviter_reward_state TEXT NOT NULL DEFAULT 'pending',
      created_at ${TS}
    )`,
  ],
  [
    // Mutual friendship, kept separate from `referrals` on purpose: that table asserts who
    // recruited whom and drives reward payouts, so it must never be written to just to make two
    // people visible to each other. Rows are stored canonically with user_a < user_b, which is
    // what makes the pair a primary key and the relationship symmetric by construction.
    "friendships",
    `CREATE TABLE IF NOT EXISTS friendships (
      user_a ${FK} NOT NULL REFERENCES users(id),
      user_b ${FK} NOT NULL REFERENCES users(id),
      created_at ${TS},
      PRIMARY KEY (user_a, user_b)
    )`,
  ],
  [
    // Weekly step totals, kept up to date incrementally by recordSteps rather than by a nightly
    // job, so the friends leaderboard is always live and costs no extra round trip.
    "step_weeks",
    `CREATE TABLE IF NOT EXISTS step_weeks (
      user_id ${FK} NOT NULL REFERENCES users(id),
      week_start ${DAY} NOT NULL,
      steps INTEGER NOT NULL DEFAULT 0,
      updated_at ${TS},
      PRIMARY KEY (user_id, week_start)
    )`,
  ],
  [
    // Idempotency ledger for pushes: the primary key is what guarantees at most one message of
    // a given kind per player per local day, however often the scheduler fires.
    "notifications_sent",
    `CREATE TABLE IF NOT EXISTS notifications_sent (
      user_id ${FK} NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL,
      date ${DAY} NOT NULL,
      created_at ${TS},
      PRIMARY KEY (user_id, kind, date)
    )`,
  ],
];

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals (inviter_user_id)",
  "CREATE INDEX IF NOT EXISTS idx_step_weeks_week ON step_weeks (week_start, steps)",
  // The primary key already covers lookups by user_a; friendship is symmetric, so the reverse
  // direction needs its own index.
  "CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships (user_b)",
];

// Columns added after a table first shipped, as [table, column, definition]. Applied only when
// genuinely missing — SQLite has no "ADD COLUMN IF NOT EXISTS", and blindly replaying every
// ALTER cost one network round trip each on every cold start.
const ADDED_COLUMNS: [table: string, column: string, definition: string][] = [
  ["pets", "avatar_url", "TEXT"],
  ["pets", "avatar_status", "TEXT NOT NULL DEFAULT 'none'"],
  ["pets", "avatar_generation_id", "TEXT"],
  ["pets", "avatar_description", "TEXT"],
  ["users", "google_access_token", "TEXT"],
  ["users", "google_refresh_token", "TEXT"],
  ["users", "google_token_expiry", "BIGINT"],
  ["pets", "rarity", "TEXT NOT NULL DEFAULT 'common'"],
  ["pets", "level", "INTEGER NOT NULL DEFAULT 0"],
  ["pets", "name", "TEXT"],
  ["pets", "avatar_seed", "BIGINT"],
  ["pets", "avatar_source_url", "TEXT"],
  ["pets", "xp", "INTEGER NOT NULL DEFAULT 0"],
  // Which evolution stage the pet's current artwork depicts, and which one an in-flight
  // generation is producing — see syncAvatarToStage in pet-logic.ts.
  ["pets", "avatar_stage", "TEXT"],
  ["pets", "avatar_target_stage", "TEXT"],
  ["users", "tz_offset", "INTEGER NOT NULL DEFAULT 0"],
  // Short opaque invite code; the raw user id would be trivially enumerable.
  ["users", "referral_code", "TEXT"],
  // Steps granted as a reward rather than actually walked. Excluded from the XP baseline below
  // so a bonus can speed up hatching without ever inflating the level counter, which is
  // deliberately a 1:1 mirror of real steps.
  ["pets", "bonus_steps", "INTEGER NOT NULL DEFAULT 0"],
  // Free evolution tiers earned by inviting players — added on top of the level-derived stage.
  ["pets", "evolution_bonus_tiers", "INTEGER NOT NULL DEFAULT 0"],
  // Last local day whose steps reached the daily goal. The streak is built from this rather than
  // from last_active_date, which merely opening the app moved forward — see recordSteps.
  ["pets", "last_goal_date", `${DAY}`],
];

const UNIQUE_INDEXES_AFTER_COLUMNS = [
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users (referral_code)",
];

// `xp` is defined to always equal max(0, lifetime_steps - bonus_steps - 7000) — recordSteps
// derives it fresh on every update rather than accumulating it, so it can never drift.
// 7000 mirrors EGG_HATCH_STEPS in pet-logic.ts — keep in sync.
const XP_FORMULA = greatest("0", "lifetime_steps - bonus_steps - 7000");
const XP_RESYNC_SQL = `UPDATE pets SET xp = ${XP_FORMULA} WHERE xp != ${XP_FORMULA}`;

// avatar_source_url is handed to the image API as an evolution reference, but an older build
// stored a ~380KB base64 `data:` URI there, which that API rejects outright. Clearing them keeps
// the sync path light and routes those pets through the redraw fallback.
const STRIP_DATA_URI_SQL = "UPDATE pets SET avatar_source_url = NULL WHERE avatar_source_url LIKE 'data:%'";

async function columnsByTable(): Promise<Map<string, Set<string>>> {
  const names = TABLES.map(([name]) => name);
  const probes = await db.batch(
    names.map((table) =>
      pg
        ? `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}'`
        : // Table-valued form rather than a bare PRAGMA, so these are ordinary SELECTs that are
          // safe inside a batched read transaction. A missing table simply yields zero rows.
          `SELECT name FROM pragma_table_info('${table}')`,
    ),
    "read",
  );
  return new Map(names.map((table, i) => [table, new Set(probes[i].rows.map((row) => String(row.name)))]));
}

/** Serverless cold starts call this on every fresh instance and every request awaits it, so its
 *  cost sits directly on the critical path. It probes the existing shape in one round trip and
 *  issues DDL only for what is genuinely missing. */
export function ensureSchema(): Promise<void> {
  if (!migrated) {
    migrated = (async () => {
      let columns = await columnsByTable();

      const missingTables = TABLES.filter(([name]) => columns.get(name)!.size === 0);
      if (missingTables.length > 0) {
        await db.batch(
          missingTables.map(([, ddl]) => ddl),
          "write",
        );
        columns = await columnsByTable();
      }

      const missingColumns = ADDED_COLUMNS.filter(([table, column]) => !columns.get(table)?.has(column));
      // One statement per ALTER is unavoidable, but only for columns this database really lacks —
      // which on an up-to-date deployment is none at all.
      for (const [table, column, definition] of missingColumns) {
        try {
          await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        } catch (err) {
          if (!(err instanceof Error) || !/duplicate column|already exists/i.test(err.message)) throw err;
        }
      }

      // Indexes are IF NOT EXISTS, and both UPDATEs are no-ops once their rows are correct, so
      // batching them keeps the steady-state cost to a single round trip while still letting a
      // stale row self-heal on the next cold start.
      await db.batch(
        [...INDEXES, ...UNIQUE_INDEXES_AFTER_COLUMNS, XP_RESYNC_SQL, STRIP_DATA_URI_SQL],
        "write",
      );
    })();
  }
  return migrated;
}
