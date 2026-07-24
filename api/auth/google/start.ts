import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resolveTelegramUser } from "../../_lib/telegram.js";
import { upsertUser } from "../../_lib/pet-logic.js";
import { buildGoogleAuthUrl, signState } from "../../_lib/googleFit.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tgUser = resolveTelegramUser(
    req.headers["x-telegram-init-data"] as string | undefined,
    process.env.BOT_TOKEN,
  );
  if (!tgUser) return res.status(401).json({ error: "invalid initData" });

  const userId = await upsertUser(String(tgUser.id), tgUser.username ?? null);
  res.status(200).json({ url: buildGoogleAuthUrl(signState(userId)) });
}
