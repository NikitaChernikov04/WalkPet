import { createClient } from "@libsql/client";

// Connection only — every table definition and dialect-specific statement lives in schema.ts,
// which is the single file that has to change when this moves to Supabase/Postgres.
export const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});
