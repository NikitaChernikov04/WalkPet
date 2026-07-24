import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getOrCreatePet, getTodaySteps, upsertUser } from "./_lib/pet-logic.js";
import { resolveTelegramUser } from "./_lib/telegram.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tgUser = resolveTelegramUser(
    req.headers["x-telegram-init-data"] as string | undefined,
    process.env.BOT_TOKEN,
  );
  if (!tgUser) return res.status(401).json({ error: "invalid initData" });

  const userId = await upsertUser(String(tgUser.id), tgUser.username ?? null);
  const pet = await getOrCreatePet(userId);
  const todaySteps = await getTodaySteps(userId);
  res.status(200).json({ pet, todaySteps });
}
