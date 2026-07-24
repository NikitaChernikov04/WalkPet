import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getStepHistory, upsertUser } from "./_lib/pet-logic.js";
import { resolveTelegramUser } from "./_lib/telegram.js";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tgUser = resolveTelegramUser(
    req.headers["x-telegram-init-data"] as string | undefined,
    process.env.BOT_TOKEN,
  );
  if (!tgUser) return res.status(401).json({ error: "invalid initData" });

  const userId = await upsertUser(String(tgUser.id), tgUser.username ?? null);

  const month = req.query.month as string | undefined;
  let startDate: string;
  let endDate: string;

  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    startDate = `${month}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    endDate = `${month}-${String(lastDay).padStart(2, "0")}`;
  } else {
    const days = req.query.range === "30" ? 30 : 7;
    const end = new Date();
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - (days - 1));
    startDate = isoDate(start);
    endDate = isoDate(end);
  }

  const history = await getStepHistory(userId, startDate, endDate);
  res.status(200).json({ history });
}
