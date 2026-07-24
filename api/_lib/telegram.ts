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
