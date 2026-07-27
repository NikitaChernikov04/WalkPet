import crypto from "node:crypto";

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

/** Validates Telegram Web App initData per the official HMAC scheme.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
export function validateInitData(initData: string, botToken: string): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computedHash !== hash) return null;

  const userJson = params.get("user");
  if (!userJson) return null;
  return JSON.parse(userJson) as TelegramUser;
}

/** Returns the caller's identity, or null when a real bot token is configured
 * but the request has no valid initData (reject in that case). Falls back to a
 * fixed dev user only when no bot token is configured at all. */
export function resolveTelegramUser(initData: string | undefined, botToken: string | undefined): TelegramUser | null {
  if (!botToken) return { id: 1, username: "dev" };
  if (!initData) return null;
  return validateInitData(initData, botToken);
}

/** The payload from a `t.me/<bot>/<app>?startapp=<value>` launch, which Telegram delivers inside
 *  initData as `start_param`. Read only after resolveTelegramUser has validated the signature —
 *  initData is attacker-supplied until that HMAC check passes, and this value grants a reward.
 *  Returns null for a normal launch. */
export function startParamFrom(initData: string | undefined): string | null {
  if (!initData) return null;
  return new URLSearchParams(initData).get("start_param");
}

let botUsername: Promise<string | null> | null = null;

/** The bot's @username, needed to build invite links. Cached for the life of the instance —
 *  it can't change without a redeploy-worthy event. Returns null if the call fails, and callers
 *  fall back to the configured mini-app link. */
export function getBotUsername(): Promise<string | null> {
  if (!botUsername) {
    botUsername = (async () => {
      if (!process.env.BOT_TOKEN) return null;
      try {
        const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getMe`);
        if (!res.ok) return null;
        const data = (await res.json()) as { ok: boolean; result?: { username?: string } };
        return data.result?.username ?? null;
      } catch {
        return null;
      }
    })();
  }
  return botUsername;
}

/** Invite link for a code.
 *
 *  Prefers a direct Mini App link (`?startapp=`), which drops the invitee straight into the game
 *  and delivers the code in initData — no bot round trip, so attribution happens in the very
 *  same request that creates their account. That form needs the app's short name, which is
 *  configured once in @BotFather; without it we fall back to the bot deep link (`?start=ref_…`),
 *  which always works and is attributed by the bot webhook instead. */
export async function buildInviteLink(code: string): Promise<string> {
  const username = await getBotUsername();
  const shortName = process.env.TELEGRAM_APP_SHORT_NAME;
  if (username && shortName) return `https://t.me/${username}/${shortName}?startapp=${code}`;
  if (username) return `https://t.me/${username}?start=ref_${code}`;
  return `${process.env.MINI_APP_URL ?? ""}`;
}
