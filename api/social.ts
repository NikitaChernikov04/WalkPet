import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserContext } from "./_lib/pet-logic.js";
import { getSocialSnapshot } from "./_lib/social.js";
import { resolveTelegramUser } from "./_lib/telegram.js";
import { parseTzOffset } from "./_lib/tz.js";

/** Friends and the global board come back together in one response: both are driven off the same
 *  week key and the same joined-player shape, they're read in a single batched round trip, and
 *  the screen shows them as two tabs the player flips between — so splitting them into separate
 *  endpoints would cost a second round trip to render the same screen. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tgUser = resolveTelegramUser(
    req.headers["x-telegram-init-data"] as string | undefined,
    process.env.BOT_TOKEN,
  );
  if (!tgUser) return res.status(401).json({ error: "invalid initData" });

  const { userId, tzOffset } = await getUserContext(
    String(tgUser.id),
    tgUser.username ?? null,
    parseTzOffset(req.headers["x-tz-offset"]),
  );

  res.status(200).json(await getSocialSnapshot(userId, tzOffset));
}
