import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPetState, getUserContext } from "./_lib/pet-logic.js";
import { resolveTelegramUser } from "./_lib/telegram.js";
import { parseTzOffset } from "./_lib/tz.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tgUser = resolveTelegramUser(
    req.headers["x-telegram-init-data"] as string | undefined,
    process.env.BOT_TOKEN,
  );
  if (!tgUser) return res.status(401).json({ error: "invalid initData" });

  const { userId, tzOffset, tokens } = await getUserContext(
    String(tgUser.id),
    tgUser.username ?? null,
    parseTzOffset(req.headers["x-tz-offset"]),
  );
  const { pet, todaySteps } = await getPetState(userId, tzOffset);
  // Connection status rides along on the first load so the client doesn't have to wait for a
  // second round trip before it can even start syncing Google Fit.
  res.status(200).json({ pet, todaySteps, googleFitConnected: tokens !== null });
}
