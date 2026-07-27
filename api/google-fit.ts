import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resolveTelegramUser } from "./_lib/telegram.js";
import { getUserContext, getValidGoogleAccessToken, recordSteps } from "./_lib/pet-logic.js";
import { fetchDailySteps } from "./_lib/googleFit.js";
import { localDate, parseTzOffset, shiftDate } from "./_lib/tz.js";

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

    // Yesterday comes along in the same aggregate request — one call, two buckets — so the first
    // sync after a day ends can still pick up whatever was walked after the last sync of that day
    // and whatever Google Fit revised upward afterwards. Fetching only today left those stranded.
    const today = localDate(tzOffset);
    const yesterday = shiftDate(today, -1);
    const steps = await fetchDailySteps(accessToken, yesterday, today, tzOffset);
    // recordSteps already knows the resulting total — no follow-up read needed.
    const { pet, todaySteps } = await recordSteps(userId, steps.get(today) ?? 0, tzOffset, steps.get(yesterday));
    return res.status(200).json({ pet, todaySteps });
  }

  res.status(405).json({ error: "method not allowed" });
}
