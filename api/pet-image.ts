import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "./_lib/db.js";
import { ensureSchema } from "./_lib/schema.js";

/** Serves a pet's artwork as a real image response instead of a ~200KB base64 data URL embedded
 *  in JSON. Friends lists and the leaderboard show many pets at once, where inlining would mean
 *  megabytes per request; as URLs the browser caches them and the payload stays tiny.
 *
 *  Deliberately unauthenticated: these have to be loadable from plain <img> tags (which can't
 *  send the initData header) and, later, fetchable by Telegram itself for story sharing. A game
 *  pet's picture carries nothing private, and the id space is not enumerable to anything else.
 *
 *  `v` should be the pet's avatar_generation_id: it changes on every new generation, so the
 *  immutable cache entry is replaced exactly when the artwork actually changes. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = Number(Array.isArray(req.query.u) ? req.query.u[0] : req.query.u);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "bad user id" });

  await ensureSchema();
  const result = await db.execute({ sql: "SELECT avatar_url FROM pets WHERE user_id = ?", args: [userId] });
  const dataUrl = (result.rows[0] as unknown as { avatar_url: string | null } | undefined)?.avatar_url;

  const base64 = dataUrl?.startsWith("data:image/png;base64,") ? dataUrl.slice("data:image/png;base64,".length) : null;
  if (!base64) return res.status(404).json({ error: "no avatar" });

  const png = Buffer.from(base64, "base64");
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", String(png.length));
  // Versioned by `v`, so this can be cached hard at the CDN and in the browser.
  res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
  res.status(200).send(png);
}
