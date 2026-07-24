import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { getTodaySteps, restorePetSnapshot, upsertUser } from "./_lib/pet-logic.js";
import { resolveTelegramUser } from "./_lib/telegram.js";
import { RARITY_ORDER, type Rarity } from "./_lib/species.js";

const petSnapshotSchema = z.object({
  stage: z.enum(["egg", "cracking", "hatched"]),
  species: z.string(),
  rarity: z.enum(RARITY_ORDER as [Rarity, ...Rarity[]]),
  lifetime_steps: z.number().int().min(0),
  health: z.number().int().min(0).max(100),
  happiness: z.number().int().min(0).max(100),
  intellect: z.number().int().min(0).max(100),
  strength: z.number().int().min(0).max(100),
  streak_days: z.number().int().min(0),
  last_active_date: z.string().nullable(),
  hatched_at: z.string().nullable(),
  avatar_url: z.string().nullable(),
  avatar_status: z.enum(["none", "pending", "completed", "failed"]),
  avatar_generation_id: z.string().nullable(),
  avatar_description: z.string().nullable(),
});
const bodySchema = z.object({ pet: petSnapshotSchema, todaySteps: z.number().int().min(0) });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const tgUser = resolveTelegramUser(
    req.headers["x-telegram-init-data"] as string | undefined,
    process.env.BOT_TOKEN,
  );
  if (!tgUser) return res.status(401).json({ error: "invalid initData" });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const userId = await upsertUser(String(tgUser.id), tgUser.username ?? null);
  const pet = await restorePetSnapshot(userId, parsed.data.pet, parsed.data.todaySteps);
  const todaySteps = await getTodaySteps(userId);
  res.status(200).json({ pet, todaySteps });
}
