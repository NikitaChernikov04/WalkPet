import type { CardFormat } from "./card.js";
import type { Pet } from "./pet-logic.js";
import { buildInviteLink } from "./telegram.js";
import { getOrCreateReferralCode } from "./referrals.js";

/** Sharing a pet card, in the two shapes Telegram offers.
 *
 *  Both hand Telegram a URL rather than an upload, which is why the card is rendered server-side
 *  and served publicly (see api/pet-card.ts). */

const origin = () => (process.env.MINI_APP_URL ?? "").replace(/\/+$/, "");

/** Versioned by everything the card actually draws, so a freshly levelled pet is never shared as
 *  its older self out of a cache. */
export function petCardUrl(userId: number, pet: Pet, format: CardFormat = "square"): string {
  const version = `${pet.level}.${pet.streak_days}.${pet.lifetime_steps}.${pet.avatar_generation_id ?? "0"}`;
  const query = new URLSearchParams({ v: version });
  if (format === "story") query.set("f", "story");
  return `${origin()}/card/${userId}.png?${query.toString()}`;
}

/** The card alone is a dead end for whoever receives it, so the caption carries the sender's own
 *  invite link: a shared pet is also a recruitment, and the referral reward follows the normal
 *  rules from there. Plain text, not HTML — Telegram links bare URLs by itself, and a pet name is
 *  player-supplied text that would otherwise have to be escaped correctly every time. */
async function buildCaption(userId: number, pet: Pet): Promise<string> {
  const name = pet.name ?? "Мой питомец";
  const link = await buildInviteLink(await getOrCreateReferralCode(userId));
  return `${name} — ${pet.species}, уровень ${pet.level}. Растёт от моих реальных шагов в WalkPet.\n${link}`;
}

async function telegram(method: string, body: unknown): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!data.ok) throw new Error(`telegram ${method} failed: ${data.description ?? res.status}`);
  return data.result;
}

/** Stages the card as an inline message the player can then place in any chat through Telegram's
 *  own share sheet (WebApp.shareMessage). Needs Bot API 8.0 on both sides; callers fall back to
 *  sendPhoto when the client is older. */
export async function prepareCardMessage(telegramUserId: string, userId: number, pet: Pet): Promise<string> {
  const url = petCardUrl(userId, pet);
  const result = (await telegram("savePreparedInlineMessage", {
    user_id: Number(telegramUserId),
    result: {
      type: "photo",
      id: `card-${userId}-${Date.now()}`,
      photo_url: url,
      thumbnail_url: url,
      caption: await buildCaption(userId, pet),
    },
    allow_user_chats: true,
    allow_group_chats: true,
    allow_channel_chats: true,
  })) as { id: string };
  return result.id;
}

/** Sends the card straight to the player's own chat with the bot, from where they can forward it.
 *  The fallback for clients too old for the share sheet — it asks nothing of the client at all. */
export async function sendCardToSelf(telegramUserId: string, userId: number, pet: Pet): Promise<void> {
  await telegram("sendPhoto", {
    chat_id: telegramUserId,
    photo: petCardUrl(userId, pet),
    caption: await buildCaption(userId, pet),
  });
}
