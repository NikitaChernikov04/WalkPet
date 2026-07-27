import crypto from "node:crypto";
import { localDate, localDayStartMs } from "./tz.js";

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
  bucket?: {
    startTimeMillis?: string | number;
    dataset?: { point?: { value?: { intVal?: number }[] }[] }[];
  }[];
}

/** Step totals per *local* calendar day for the inclusive range [startDateISO, endDateISO], where
 *  `tzOffset` is the player's UTC offset in minutes east of UTC — so each day's count resets at
 *  their own 00:00, matching the boundary pet-logic stores step_logs rows under.
 *
 *  Asking for several days costs exactly one request, which is what makes it practical to
 *  re-check a day that has already ended. Doing so matters: a player's last sync of the day
 *  almost never lands at 23:59, and Google Fit itself keeps revising a day's total for a while
 *  after the phone uploads, so the figure read while the day is still running is routinely short
 *  of the final one. Only fetching the current day left that difference stranded for good.
 *
 *  Days with no recorded activity are present in the map with 0. */
export async function fetchDailySteps(
  accessToken: string,
  startDateISO: string,
  endDateISO: string,
  tzOffset: number,
): Promise<Map<string, number>> {
  const dayMillis = 24 * 60 * 60 * 1000;
  const startTimeMillis = localDayStartMs(startDateISO, tzOffset);
  const endTimeMillis = localDayStartMs(endDateISO, tzOffset) + dayMillis;

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
  const byDate = new Map<string, number>();
  for (const bucket of data.bucket ?? []) {
    // Each bucket is keyed by the instant it starts, which is a local midnight by construction —
    // mapping it back through the same offset is what pins a bucket to the right calendar day,
    // rather than trusting the buckets to arrive in order and counting them off.
    const bucketStart = Number(bucket.startTimeMillis ?? NaN);
    if (!Number.isFinite(bucketStart)) continue;
    const date = localDate(tzOffset, bucketStart);

    let total = 0;
    for (const dataset of bucket.dataset ?? []) {
      for (const point of dataset.point ?? []) {
        for (const value of point.value ?? []) {
          total += value.intVal ?? 0;
        }
      }
    }
    byDate.set(date, total);
  }
  return byDate;
}
