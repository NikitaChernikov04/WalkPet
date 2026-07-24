import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Telegraf, Markup } from "telegraf";

const BOT_TOKEN = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL;

let bot: Telegraf | null = null;
function getBot(): Telegraf {
  if (bot) return bot;
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN not configured");
  bot = new Telegraf(BOT_TOKEN);
  bot.start((ctx) =>
    ctx.reply(
      "🥚 У тебя появилось загадочное яйцо! Ходи, и оно начнёт трескаться.",
      MINI_APP_URL ? Markup.inlineKeyboard([Markup.button.webApp("Открыть WalkPet", MINI_APP_URL)]) : undefined,
    ),
  );
  return bot;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(200).json({ ok: true });
  await getBot().handleUpdate(req.body, res);
  if (!res.writableEnded) res.status(200).json({ ok: true });
}
