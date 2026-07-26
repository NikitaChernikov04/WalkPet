import crypto from "node:crypto";
import { localDayStartMs } from "./tz.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FITNESS_AGGREGATE_URL = "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate";
const SCOPE = "https://www.googleapis.com/auth/fitness.activity.read";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

/** Signs our internal numeric user id into an opaque `state` value using BOT_TOKEN as the
 *  HMAC key, so the OAuth callback (which gets no Telegram initData) can trust which DB
 *  user a Google account belongs to without a separate secret or server-side session store. */
export function signState(userId: number): string {
  const payload = `${userId}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", process.env.BOT_TOKEN!).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyState(state: string): number | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf-8");
    const [userIdStr, tsStr, sig] = decoded.split(".");
    const expectedSig = crypto.createHmac("sha256", process.env.BOT_TOKEN!).update(`${userIdStr}.${tsStr}`).digest("hex");
    if (sig !== expectedSig) return null;
    if (Date.now() - Number(tsStr) > STATE_MAX_AGE_MS) return null;
    return Number(userIdStr);
  } catch {
    return null;
  }
}

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    // Forces the consent screen (and a fresh refresh_token) on every connect/reconnect,
    // instead of Google silently omitting it because the user consented once before.
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`google token refresh failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

interface AggregateResponse {
  bucket?: { dataset?: { point?: { value?: { intVal?: number }[] }[] }[] }[];
}

/** Total step count for the player's *local* calendar day `dateISO`, where `tzOffset` is their
 *  UTC offset in minutes east of UTC — so the count resets at their own 00:00, matching the
 *  day boundary pet-logic stores step_logs rows under. */
export async function fetchStepsForDate(accessToken: string, dateISO: string, tzOffset: number): Promise<number> {
  const startTimeMillis = localDayStartMs(dateISO, tzOffset);
  const dayMillis = 24 * 60 * 60 * 1000;
  const endTimeMillis = startTimeMillis + dayMillis;

  const res = await fetch(FITNESS_AGGREGATE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      // Pinning the merged/estimated data source is required: aggregating by dataTypeName
      // alone sums every contributing raw stream (phone sensor + phone estimate + any other
      // connected device) instead of one deduplicated count, wildly inflating the total.
      aggregateBy: [
        {
          dataTypeName: "com.google.step_count.delta",
          dataSourceId: "derived:com.google.step_count.delta:com.google.android.gms:estimated_steps",
        },
      ],
      bucketByTime: { durationMillis: dayMillis },
      startTimeMillis,
      endTimeMillis,
    }),
  });
  if (!res.ok) throw new Error(`google fit aggregate failed: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as AggregateResponse;
  let total = 0;
  for (const bucket of data.bucket ?? []) {
    for (const dataset of bucket.dataset ?? []) {
      for (const point of dataset.point ?? []) {
        for (const value of point.value ?? []) {
          total += value.intVal ?? 0;
        }
      }
    }
  }
  return total;
}
