import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getTodaySteps, resetPet, upsertUser } from "./_lib/pet-logic.js";
import { resolveTelegramUser } from "./_lib/telegram.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const tgUser = resolveTelegramUser(
    req.headers["x-telegram-init-data"] as string | undefined,
    process.env.BOT_TOKEN,
  );
  if (!tgUser) return res.status(401).json({ error: "invalid initData" });

  const userId = await upsertUser(String(tgUser.id), tgUser.username ?? null);
  const pet = await resetPet(userId);
  const todaySteps = await getTodaySteps(userId);
  res.status(200).json({ pet, todaySteps });
}
