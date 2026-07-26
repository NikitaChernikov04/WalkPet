import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getStepHistory, getUserContext } from "./_lib/pet-logic.js";
import { resolveTelegramUser } from "./_lib/telegram.js";
import { localDate, parseTzOffset, shiftDate } from "./_lib/tz.js";

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

  const month = req.query.month as string | undefined;
  let startDate: string;
  let endDate: string;

  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    startDate = `${month}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    endDate = `${month}-${String(lastDay).padStart(2, "0")}`;
  } else {
    // Ranges end on the player's own "today", not UTC's — otherwise someone east of UTC sees
    // their current day missing from the chart for part of the evening.
    const days = req.query.range === "30" ? 30 : 7;
    endDate = localDate(tzOffset);
    startDate = shiftDate(endDate, -(days - 1));
  }

  const history = await getStepHistory(userId, startDate, endDate);
  res.status(200).json({ history });
}
