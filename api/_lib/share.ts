import { CARD_SIZE, cardVersion, type CardFormat } from "./card.js";
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
  const query = new URLSearchParams({ v: cardVersion(pet) });
  if (format !== "square") query.set("f", format);
  return `${origin()}/card/${userId}.jpg?${query.toString()}`;
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

/** Fetches the card, which also renders and stores it if this is the first ask for this version.
 *  Returns null rather than throwing: a share that cannot get the bytes falls back to handing
 *  Telegram the URL, which is worse but not nothing. */
async function fetchCard(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`card fetch ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error("card fetch failed", err);
    return null;
  }
}

/** Puts the card on Telegram's own servers and returns its file_id.
 *
 *  This is what makes the share reliable. Handing Telegram a `photo_url` leaves the download to
 *  Telegram, and the result kept arriving in chats half-drawn with grey beneath — the signature of
 *  a fetcher that stopped early. Notably `sendPhoto` with the identical URL always worked, so the
 *  URL and the file were never the problem; the inline path simply fetches under a budget we do
 *  not control. Uploading the bytes ourselves removes that fetch from the picture entirely, and
 *  the recipient then loads the photo from Telegram's CDN like any other.
 *
 *  Telegram has no upload-only endpoint, so the file is created by sending it silently to the
 *  player's own chat with the bot and deleting it immediately; a file_id outlives the message it
 *  arrived in. */
async function uploadCard(telegramUserId: string, jpeg: Buffer): Promise<string> {
  const form = new FormData();
  form.set("chat_id", telegramUserId);
  form.set("disable_notification", "true");
  form.set("photo", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "card.jpg");

  const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: { message_id: number; photo: { file_id: string }[] };
  };
  if (!data.ok || !data.result?.photo?.length) throw new Error(`upload failed: ${data.description ?? res.status}`);

  // Largest size last. Deleting the carrier message does not invalidate the file.
  const fileId = data.result.photo[data.result.photo.length - 1].file_id;
  try {
    await telegram("deleteMessage", { chat_id: telegramUserId, message_id: data.result.message_id });
  } catch (err) {
    console.error("could not remove the upload carrier message", err);
  }
  return fileId;
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
  const [caption, jpeg] = await Promise.all([buildCaption(userId, pet), fetchCard(url)]);

  // Preferred: a file Telegram already holds, so nothing has to be downloaded from us when the
  // message lands. The URL form stays as a fallback for the case where we could not produce or
  // upload the bytes — it renders unreliably, but an unreliable share beats a failed one.
  let photo: Record<string, unknown>;
  try {
    if (!jpeg) throw new Error("no card bytes");
    photo = { photo_file_id: await uploadCard(telegramUserId, jpeg) };
  } catch (err) {
    console.error("falling back to sharing the card by URL", err);
    photo = {
      photo_url: url,
      thumbnail_url: petCardUrl(userId, pet, "thumb"),
      // Without these Telegram has to download the image before it knows what shape the bubble
      // should be, and lays out a tall portrait placeholder for a square card in the meantime.
      photo_width: CARD_SIZE.square.width,
      photo_height: CARD_SIZE.square.height,
    };
  }

  const result = (await telegram("savePreparedInlineMessage", {
    user_id: Number(telegramUserId),
    result: { type: "photo", id: `card-${userId}-${Date.now()}`, ...photo, caption },
    allow_user_chats: true,
    allow_group_chats: true,
    allow_channel_chats: true,
  })) as { id: string };
  return result.id;
}

/** Sends the card straight to the player's own chat with the bot, from where they can forward it.
 *  The fallback for clients too old for the share sheet — it asks nothing of the client at all. */
export async function sendCardToSelf(telegramUserId: string, userId: number, pet: Pet): Promise<void> {
  const url = petCardUrl(userId, pet);
  const [caption] = await Promise.all([buildCaption(userId, pet), fetchCard(url)]);
  // By URL here on purpose: sendPhoto has Telegram fetch it server-side, which has always worked
  // and saves shipping the bytes twice. The card is already rendered and stored by now.
  await telegram("sendPhoto", { chat_id: telegramUserId, photo: url, caption });
}
