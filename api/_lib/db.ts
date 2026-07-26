import { createClient } from "@libsql/client";

export const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

let migrated: Promise<void> | null = null;

// Columns added after the original CREATE TABLE shipped, as [table, column, definition].
// Applied only when actually missing (see ensureSchema) — SQLite has no
// "ADD COLUMN IF NOT EXISTS" and blindly retrying every ALTER cost one round trip each.
const ADDED_COLUMNS: [table: string, column: string, definition: string][] = [
  ["pets", "avatar_url", "TEXT"],
  ["pets", "avatar_status", "TEXT NOT NULL DEFAULT 'none'"],
  ["pets", "avatar_generation_id", "TEXT"],
  ["pets", "avatar_description", "TEXT"],
  ["users", "google_access_token", "TEXT"],
  ["users", "google_refresh_token", "TEXT"],
  ["users", "google_token_expiry", "INTEGER"],
  ["pets", "rarity", "TEXT NOT NULL DEFAULT 'common'"],
  ["pets", "level", "INTEGER NOT NULL DEFAULT 0"],
  ["pets", "name", "TEXT"],
  ["pets", "avatar_seed", "INTEGER"],
  ["pets", "avatar_source_url", "TEXT"],
  ["pets", "xp", "INTEGER NOT NULL DEFAULT 0"],
  // Which evolution stage the pet's *current* artwork actually depicts, and which one an
  // in-flight generation is producing. Without these, an evolution whose art job was skipped
  // (avatar still pending, or the image API erroring out) was lost forever, because the only
  // trigger was the single sync that crossed the level boundary. See recordSteps.
  ["pets", "avatar_stage", "TEXT"],
  ["pets", "avatar_target_stage", "TEXT"],
  // Last known UTC offset of the player, in minutes east of UTC — see _lib/tz.ts.
  ["users", "tz_offset", "INTEGER NOT NULL DEFAULT 0"],
];

const TABLES = ["users", "pets", "step_logs"];

// `xp` is defined to always equal max(0, lifetime_steps - 7000) — see recordSteps in
// pet-logic.ts, which derives it fresh every update rather than accumulating it. Running this
// resync on every cold start immediately corrects any row left stale by an older deploy
// (e.g. pets whose `xp` was thrown off by the now-removed care multiplier) instead of waiting
// for that pet's next step sync. 7000 mirrors EGG_HATCH_STEPS in pet-logic.ts — keep in sync.
const XP_RESYNC_SQL = "UPDATE pets SET xp = MAX(0, lifetime_steps - 7000) WHERE xp != MAX(0, lifetime_steps - 7000)";

// Serverless cold starts call this on every fresh instance, and every request awaits it before
// touching the DB — so its cost is directly on the critical path of a cold sync. It probes the
// existing shape in ONE round trip and issues DDL only when something is genuinely missing,
// instead of replaying a CREATE batch plus a dozen ALTERs (~15 sequential round trips to Turso)
// on every single cold start.
export function ensureSchema(): Promise<void> {
  if (!migrated) {
    migrated = (async () => {
      const probes = await db.batch(
        // Table-valued form rather than a bare `PRAGMA table_info(...)`, so these are ordinary
        // SELECTs that are safe to run inside a batched read transaction. A missing table
        // simply yields zero rows.
        TABLES.map((table) => `SELECT name FROM pragma_table_info('${table}')`),
        "read",
      );
      const columnsByTable = new Map<string, Set<string>>();
      TABLES.forEach((table, i) => {
        columnsByTable.set(table, new Set(probes[i].rows.map((row) => String(row.name))));
      });

      if (TABLES.some((table) => columnsByTable.get(table)!.size === 0)) {
        await createTables();
        // Re-probe so the ALTER pass below sees what the CREATEs already provided.
        const after = await db.batch(
          TABLES.map((table) => `PRAGMA table_info(${table})`),
          "read",
        );
        TABLES.forEach((table, i) => {
          columnsByTable.set(table, new Set(after[i].rows.map((row) => String(row.name))));
        });
      }

      const missing = ADDED_COLUMNS.filter(([table, column]) => !columnsByTable.get(table)?.has(column));
      // One statement per ALTER is unavoidable, but only for columns this DB really lacks —
      // which on an up-to-date deployment is none at all.
      for (const [table, column, definition] of missing) {
        try {
          await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        } catch (err) {
          if (!(err instanceof Error) || !/duplicate column/i.test(err.message)) throw err;
        }
      }

      if (missing.length > 0) await db.execute(XP_RESYNC_SQL);
    })();
  }
  return migrated;
}

async function createTables(): Promise<void> {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id TEXT UNIQUE NOT NULL,
            username TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS pets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
            stage TEXT NOT NULL DEFAULT 'egg',
            species TEXT NOT NULL DEFAULT 'unknown',
            rarity TEXT NOT NULL DEFAULT 'common',
            level INTEGER NOT NULL DEFAULT 0,
            xp INTEGER NOT NULL DEFAULT 0,
            name TEXT,
            avatar_seed INTEGER,
            avatar_source_url TEXT,
            lifetime_steps INTEGER NOT NULL DEFAULT 0,
            health INTEGER NOT NULL DEFAULT 50,
            happiness INTEGER NOT NULL DEFAULT 50,
            energy INTEGER NOT NULL DEFAULT 50,
            intellect INTEGER NOT NULL DEFAULT 10,
            strength INTEGER NOT NULL DEFAULT 10,
            streak_days INTEGER NOT NULL DEFAULT 0,
            last_active_date TEXT,
            hatched_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS step_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            date TEXT NOT NULL,
            steps INTEGER NOT NULL DEFAULT 0,
            milestones_applied TEXT NOT NULL DEFAULT '',
            UNIQUE(user_id, date)
      )`,
    ],
    "write",
  );
}
