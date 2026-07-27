import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "./_lib/db.js";
import { ensureSchema } from "./_lib/schema.js";
import { renderPetCard, type CardFormat } from "./_lib/card.js";
import type { Pet } from "./_lib/pet-logic.js";

/** A shareable JPEG of a player's pet.
 *
 *  Unauthenticated for the same reason /api/pet-image is: this URL exists precisely so that
 *  Telegram's servers can fetch it — a prepared inline message references it as `photo_url` and
 *  a story as `media_url`, neither of which can carry an initData header. The card shows a pet
 *  name, species, level and step count and nothing that identifies the person behind it; the
 *  Telegram username is deliberately left off.
 *
 *  Reachable as /card/<userId>.jpg (see the rewrite in vercel.json) because Telegram is happier
 *  with photo URLs that look like image files. `v` is a cache-buster the caller composes from the
 *  pet's mutable fields; `f=story` renders the 9:16 variant. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const userId = Number(first(req.query.u));
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "bad user id" });

  const format: CardFormat = first(req.query.f) === "story" ? "story" : "square";

  await ensureSchema();
  const result = await db.execute({ sql: "SELECT * FROM pets WHERE user_id = ?", args: [userId] });
  const pet = result.rows[0] as unknown as Pet | undefined;
  if (!pet) return res.status(404).json({ error: "no pet" });
  if (pet.stage !== "hatched") return res.status(409).json({ error: "pet has not hatched" });

  const jpeg = await renderPetCard(pet, format);
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Content-Length", String(jpeg.length));
  // Short rather than immutable: level, streak and step count all move, and `v` is only as good
  // as the caller's guess at them. Long enough that a share flow renders once, not three times.
  res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600");
  res.status(200).send(jpeg);
}
