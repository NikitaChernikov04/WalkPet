import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserContext } from "./_lib/pet-logic.js";
import { getReferralSummary } from "./_lib/referrals.js";
import { buildInviteLink, resolveTelegramUser, startParamFrom } from "./_lib/telegram.js";
import { parseTzOffset } from "./_lib/tz.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const initData = req.headers["x-telegram-init-data"] as string | undefined;
  const tgUser = resolveTelegramUser(initData, process.env.BOT_TOKEN);
  if (!tgUser) return res.status(401).json({ error: "invalid initData" });

  const { userId } = await getUserContext(
    String(tgUser.id),
    tgUser.username ?? null,
    parseTzOffset(req.headers["x-tz-offset"]),
    startParamFrom(initData),
  );

  const summary = await getReferralSummary(userId);
  res.status(200).json({ ...summary, link: await buildInviteLink(summary.code) });
}
