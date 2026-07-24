import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { completeAvatar, failAvatar, getOrCreatePet, setAvatarPending, upsertUser } from "./_lib/pet-logic.js";
import { resolveTelegramUser } from "./_lib/telegram.js";
import { avatarUrlFrom, buildPetPrompt, getAvatarGeneration, startAvatarGeneration } from "./_lib/nanobanana.js";
import { fetchAndCutoutBackground } from "./_lib/imageProcessing.js";

const bodySchema = z.object({ description: z.string().trim().min(1).max(300) });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tgUser = resolveTelegramUser(
    req.headers["x-telegram-init-data"] as string | undefined,
    process.env.BOT_TOKEN,
  );
  if (!tgUser) return res.status(401).json({ error: "invalid initData" });

  const userId = await upsertUser(String(tgUser.id), tgUser.username ?? null);

  if (req.method === "POST") {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const pet = await getOrCreatePet(userId);
    if (pet.stage !== "hatched") {
      return res.status(400).json({ error: "pet must be hatched before generating an avatar" });
    }

    const prompt = buildPetPrompt(pet.species, parsed.data.description);
    const gen = await startAvatarGeneration(prompt);
    const url = avatarUrlFrom(gen);

    if (gen.status === "completed" && url) {
      await setAvatarPending(userId, gen.id, parsed.data.description);
      try {
        await completeAvatar(userId, await fetchAndCutoutBackground(url));
      } catch {
        await failAvatar(userId);
      }
    } else if (gen.status === "failed" || gen.status === "cancelled") {
      await setAvatarPending(userId, gen.id, parsed.data.description);
      await failAvatar(userId);
    } else {
      // pending/processing: client will poll GET /api/avatar for the result.
      await setAvatarPending(userId, gen.id, parsed.data.description);
    }

    return res.status(200).json({ pet: await getOrCreatePet(userId) });
  }

  if (req.method === "GET") {
    let pet = await getOrCreatePet(userId);
    if (pet.avatar_status === "pending" && pet.avatar_generation_id) {
      try {
        const gen = await getAvatarGeneration(pet.avatar_generation_id);
        const url = avatarUrlFrom(gen);
        if (gen.status === "completed" && url) {
          await completeAvatar(userId, await fetchAndCutoutBackground(url));
          pet = await getOrCreatePet(userId);
        } else if (gen.status === "failed" || gen.status === "cancelled") {
          await failAvatar(userId);
          pet = await getOrCreatePet(userId);
        }
      } catch {
        // Polza has no record of this generation (e.g. a stale/untrackable id) —
        // surface it as a failure instead of erroring out the poll forever.
        await failAvatar(userId);
        pet = await getOrCreatePet(userId);
      }
    }
    return res.status(200).json({ pet });
  }

  res.status(405).json({ error: "method not allowed" });
}
