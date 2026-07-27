import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { getPetState, getUserContext, resetPet } from "./_lib/pet-logic.js";
import { applyPetName, PetActionError, pollAvatarGeneration, requestAvatarGeneration } from "./_lib/pet-actions.js";
import { resolveTelegramUser, startParamFrom } from "./_lib/telegram.js";
import { parseTzOffset } from "./_lib/tz.js";

/** Everything a player does to their own pet, behind one route.
 *
 *  Vercel turns each file under api/ into a separate function and the Hobby plan caps how many
 *  a deployment may contain, so a file per verb is a budget we can't afford — these were four
 *  routes (pet, avatar, pet-name, pet-reset) that all authenticate identically and all answer
 *  with the same pet object. The actual work lives in _lib/pet-actions.ts; this is just
 *  dispatch.
 *
 *    GET  /api/pet                      → { pet, todaySteps, googleFitConnected }
 *    GET  /api/pet?action=avatar-poll   → { pet }
 *    POST /api/pet { action: "avatar" | "name" | "reset", … } → { pet, … }
 */
const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("avatar"), description: z.string().trim().max(300).optional() }),
  // name omitted entirely = "pick one for me" via the model.
  z.object({ action: z.literal("name"), name: z.string().trim().min(1).max(24).optional() }),
  z.object({ action: z.literal("reset") }),
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const initData = req.headers["x-telegram-init-data"] as string | undefined;
  const tgUser = resolveTelegramUser(initData, process.env.BOT_TOKEN);
  if (!tgUser) return res.status(401).json({ error: "invalid initData" });

  // This is the first call the Mini App makes, so it's where a `?startapp=<code>` launch gets
  // its referral credited — inside the same request that creates the account.
  const { userId, tzOffset, tokens } = await getUserContext(
    String(tgUser.id),
    tgUser.username ?? null,
    parseTzOffset(req.headers["x-tz-offset"]),
    startParamFrom(initData),
  );

  try {
    if (req.method === "GET") {
      if (req.query.action === "avatar-poll") {
        return res.status(200).json({ pet: await pollAvatarGeneration(userId) });
      }
      const { pet, todaySteps } = await getPetState(userId, tzOffset);
      // Connection status rides along on the first load so the client doesn't have to wait for a
      // second round trip before it can start syncing Google Fit.
      return res.status(200).json({ pet, todaySteps, googleFitConnected: tokens !== null });
    }

    if (req.method === "POST") {
      const parsed = postSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      switch (parsed.data.action) {
        case "avatar":
          return res.status(200).json({ pet: await requestAvatarGeneration(userId, parsed.data.description ?? "") });
        case "name":
          return res.status(200).json({ pet: await applyPetName(userId, parsed.data.name ?? null) });
        case "reset": {
          const pet = await resetPet(userId);
          // A reset wipes step_logs, so today's count is zero by construction — no query needed.
          return res.status(200).json({ pet, todaySteps: 0 });
        }
      }
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    if (err instanceof PetActionError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}
