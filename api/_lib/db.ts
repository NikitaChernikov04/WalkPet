import { createClient } from "@libsql/client";

export const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

let migrated: Promise<void> | null = null;

const ALTER_STATEMENTS = [
  "ALTER TABLE pets ADD COLUMN avatar_url TEXT",
  "ALTER TABLE pets ADD COLUMN avatar_status TEXT NOT NULL DEFAULT 'none'",
  "ALTER TABLE pets ADD COLUMN avatar_generation_id TEXT",
  "ALTER TABLE pets ADD COLUMN avatar_description TEXT",
  "ALTER TABLE users ADD COLUMN google_access_token TEXT",
  "ALTER TABLE users ADD COLUMN google_refresh_token TEXT",
  "ALTER TABLE users ADD COLUMN google_token_expiry INTEGER",
  "ALTER TABLE pets ADD COLUMN rarity TEXT NOT NULL DEFAULT 'common'",
];

// Serverless cold starts call this on every fresh instance; cheap and idempotent.
export function ensureSchema(): Promise<void> {
  if (!migrated) {
    migrated = (async () => {
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

      // SQLite has no "ADD COLUMN IF NOT EXISTS"; ignore duplicate-column errors
      // so this stays idempotent across cold starts once columns already exist.
      for (const sql of ALTER_STATEMENTS) {
        try {
          await db.execute(sql);
        } catch (err) {
          if (!(err instanceof Error) || !/duplicate column/i.test(err.message)) throw err;
        }
      }
    })();
  }
  return migrated;
}
