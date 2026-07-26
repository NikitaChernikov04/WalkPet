import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resolveTelegramUser } from "./_lib/telegram.js";
import { getUserContext, getValidGoogleAccessToken, recordSteps } from "./_lib/pet-logic.js";
import { fetchStepsForDate } from "./_lib/googleFit.js";
import { localDate, parseTzOffset } from "./_lib/tz.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tgUser = resolveTelegramUser(
    req.headers["x-telegram-init-data"] as string | undefined,
    process.env.BOT_TOKEN,
  );
  if (!tgUser) return res.status(401).json({ error: "invalid initData" });

  // One query resolves the user id, their day-boundary timezone and their Google tokens.
  const { userId, tzOffset, tokens } = await getUserContext(
    String(tgUser.id),
    tgUser.username ?? null,
    parseTzOffset(req.headers["x-tz-offset"]),
  );

  if (req.method === "GET") {
    return res.status(200).json({ connected: tokens !== null });
  }

  if (req.method === "POST") {
    const accessToken = await getValidGoogleAccessToken(userId, tokens);
    if (!accessToken) return res.status(400).json({ error: "google fit not connected" });

    const steps = await fetchStepsForDate(accessToken, localDate(tzOffset), tzOffset);
    // recordSteps already knows the resulting total — no follow-up read needed.
    const { pet, todaySteps } = await recordSteps(userId, steps, tzOffset);
    return res.status(200).json({ pet, todaySteps });
  }

  res.status(405).json({ error: "method not allowed" });
}
