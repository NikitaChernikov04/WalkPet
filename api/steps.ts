import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { getTodaySteps, recordSteps, upsertUser } from "./_lib/pet-logic.js";
import { resolveTelegramUser } from "./_lib/telegram.js";

const stepsSchema = z.object({ stepsToday: z.number().int().min(0).max(200000) });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const tgUser = resolveTelegramUser(
    req.headers["x-telegram-init-data"] as string | undefined,
    process.env.BOT_TOKEN,
  );
  if (!tgUser) return res.status(401).json({ error: "invalid initData" });

  const parsed = stepsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const userId = await upsertUser(String(tgUser.id), tgUser.username ?? null);
  const pet = await recordSteps(userId, parsed.data.stepsToday);
  const todaySteps = await getTodaySteps(userId);
  res.status(200).json({ pet, todaySteps });
}
