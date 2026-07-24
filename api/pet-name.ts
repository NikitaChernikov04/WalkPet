import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { getOrCreatePet, setPetName, upsertUser } from "./_lib/pet-logic.js";
import { resolveTelegramUser } from "./_lib/telegram.js";
import { generatePetName } from "./_lib/groq.js";

const bodySchema = z.union([
  z.object({ mode: z.literal("ai") }),
  z.object({ mode: z.literal("custom"), name: z.string().trim().min(1).max(24) }),
]);

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
  const pet = await getOrCreatePet(userId);
  if (pet.stage !== "hatched") {
    return res.status(400).json({ error: "pet must be hatched before it can be named" });
  }

  const name =
    parsed.data.mode === "custom" ? parsed.data.name : await generatePetName(pet.species, pet.avatar_description);

  await setPetName(userId, name);
  return res.status(200).json({ pet: await getOrCreatePet(userId) });
}
