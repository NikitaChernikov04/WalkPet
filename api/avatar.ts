import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { completeAvatar, failAvatar, getOrCreatePet, setAvatarPending, upsertUser } from "./_lib/pet-logic.js";
import { resolveTelegramUser } from "./_lib/telegram.js";
import { avatarUrlFrom, getAvatarGeneration, startAvatarGeneration } from "./_lib/nanobanana.js";
import { processAvatarImage } from "./_lib/imageProcessing.js";
import { buildPetPrompt } from "./_lib/species.js";
import { evolutionStageForLevel } from "./_lib/leveling.js";

// Description is optional: an empty one means "resync to the canonical look for my current
// rarity/evolution stage" (used by the "Обновить экипировку" action once status is already
// "completed" — buildPetPrompt falls back to the stage's default outfit when there's no
// custom flavor, see EVOLUTION_OUTFIT_PROMPT in leveling.ts).
const bodySchema = z.object({ description: z.string().trim().max(300).optional() });

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

    const description = parsed.data.description ?? "";
    // A resync (no description, already has a completed avatar) rolls a fresh seed —
    // the point is to break away from whatever pre-existing look (e.g. a costume from
    // before evolution-based gear existed) the old seed was tied to.
    const seed =
      !description && pet.avatar_status === "completed"
        ? Math.floor(Math.random() * 2 ** 31)
        : (pet.avatar_seed ?? Math.floor(Math.random() * 2 ** 31));
    const prompt = buildPetPrompt(pet.species, description, pet.rarity, evolutionStageForLevel(pet.level));
    const gen = await startAvatarGeneration(prompt, { seed });
    const url = avatarUrlFrom(gen);

    if (gen.status === "completed" && url) {
      await setAvatarPending(userId, gen.id, description, seed);
      try {
        const { display, source } = await processAvatarImage(url);
        await completeAvatar(userId, display, source);
      } catch {
        await failAvatar(userId);
      }
    } else if (gen.status === "failed" || gen.status === "cancelled") {
      await setAvatarPending(userId, gen.id, description, seed);
      await failAvatar(userId);
    } else {
      // pending/processing: client will poll GET /api/avatar for the result.
      await setAvatarPending(userId, gen.id, description, seed);
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
          const { display, source } = await processAvatarImage(url);
          await completeAvatar(userId, display, source);
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
