import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserContext, resetPet } from "./_lib/pet-logic.js";
import { resolveTelegramUser } from "./_lib/telegram.js";
import { parseTzOffset } from "./_lib/tz.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const tgUser = resolveTelegramUser(
    req.headers["x-telegram-init-data"] as string | undefined,
    process.env.BOT_TOKEN,
  );
  if (!tgUser) return res.status(401).json({ error: "invalid initData" });

  const { userId } = await getUserContext(
    String(tgUser.id),
    tgUser.username ?? null,
    parseTzOffset(req.headers["x-tz-offset"]),
  );
  const pet = await resetPet(userId);
  // A reset wipes step_logs, so today's count is zero by construction — no query needed.
  res.status(200).json({ pet, todaySteps: 0 });
}
