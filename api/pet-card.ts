import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "./_lib/db.js";
import { ensureSchema } from "./_lib/schema.js";
import { cardVersion, renderPetCard, type CardFormat } from "./_lib/card.js";
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
 *  with photo URLs that look like image files. `f=story` renders the 9:16 variant and `f=thumb`
 *  the small preview; `v` is a CDN cache-buster the caller composes with cardVersion.
 *
 *  Serves a stored render whenever one matches the pet's current state. That matters because the
 *  client here is a fetcher on someone else's timeout, not a browser: rendering costs seconds on
 *  a cold instance, and Telegram's answer to a slow response is to keep whatever arrived before
 *  it gave up, which reaches the chat as a card drawn halfway down and grey below. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const userId = Number(first(req.query.u));
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "bad user id" });

  const requested = first(req.query.f);
  const format: CardFormat = requested === "story" ? "story" : requested === "thumb" ? "thumb" : "square";

  await ensureSchema();
  const [petRes, cachedRes] = await db.batch(
    [
      { sql: "SELECT * FROM pets WHERE user_id = ?", args: [userId] },
      { sql: "SELECT version, image FROM pet_cards WHERE user_id = ? AND format = ?", args: [userId, format] },
    ],
    "read",
  );

  const pet = petRes.rows[0] as unknown as Pet | undefined;
  if (!pet) return res.status(404).json({ error: "no pet" });
  if (pet.stage !== "hatched") return res.status(409).json({ error: "pet has not hatched" });

  const version = cardVersion(pet);
  const cached = cachedRes.rows[0] as unknown as { version: string; image: string } | undefined;

  let jpeg: Buffer;
  if (cached?.version === version) {
    jpeg = Buffer.from(cached.image, "base64");
  } else {
    jpeg = await renderPetCard(pet, format);
    // Best effort: a card that renders but fails to store is still a card.
    try {
      await db.execute({
        sql: `INSERT INTO pet_cards (user_id, format, version, image) VALUES (?, ?, ?, ?)
              ON CONFLICT(user_id, format) DO UPDATE SET version = excluded.version, image = excluded.image,
              created_at = CURRENT_TIMESTAMP`,
        args: [userId, format, version, jpeg.toString("base64")],
      });
    } catch (err) {
      console.error(`storing card for user ${userId} failed`, err);
    }
  }

  res.setHeader("Content-Type", "image/jpeg");
  // Content-Length is left to the runtime. Setting it by hand only invites it to disagree with
  // whatever the platform actually puts on the wire, and a fetcher that trusts the header over
  // the body is exactly the kind of client this endpoint exists to serve.
  res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600");
  res.status(200).send(jpeg);
}
