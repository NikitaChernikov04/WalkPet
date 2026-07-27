import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Telegraf, Markup } from "telegraf";
import { getUserContext } from "./_lib/pet-logic.js";
import { attributeReferral, parseReferralCode } from "./_lib/referrals.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL;

let bot: Telegraf | null = null;
function getBot(): Telegraf {
  if (bot) return bot;
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN not configured");
  bot = new Telegraf(BOT_TOKEN);

  bot.start(async (ctx) => {
    // Invite links of the form t.me/<bot>?start=ref_<code> are attributed right here rather than
    // in the Mini App: the payload reaches the bot but not the app that a button then opens, so
    // this is the only place it exists. The direct-app link (?startapp=) is handled in
    // getUserContext instead. Both funnel into the same attributeReferral, and both rely on the
    // account being brand new for the referral to count.
    const code = parseReferralCode(ctx.startPayload);
    let welcome = "🥚 У тебя появилось загадочное яйцо! Ходи, и оно начнёт трескаться.";

    if (code) {
      try {
        const { userId, created } = await getUserContext(String(ctx.from.id), ctx.from.username ?? null, null);
        if (created) {
          const { attributed } = await attributeReferral(userId, code);
          if (attributed) {
            welcome =
              "🎁 Ты пришёл по приглашению друга — твоё яйцо уже трескается!\n\n" +
              "Осталось немного пройтись, и питомец вылупится.";
          }
        }
      } catch (err) {
        // A referral that can't be credited must never block the welcome message.
        console.error("referral attribution from /start failed", err);
      }
    }

    await ctx.reply(
      welcome,
      MINI_APP_URL ? Markup.inlineKeyboard([Markup.button.webApp("Открыть WalkPet", MINI_APP_URL)]) : undefined,
    );
  });

  return bot;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(200).json({ ok: true });
  await getBot().handleUpdate(req.body, res);
  if (!res.writableEnded) res.status(200).json({ ok: true });
}
