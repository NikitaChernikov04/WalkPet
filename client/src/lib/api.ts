export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface Pet {
  id: number;
  user_id: number;
  stage: "egg" | "cracking" | "hatched";
  species: string;
  rarity: Rarity;
  level: number;
  xp: number;
  name: string | null;
  lifetime_steps: number;
  health: number;
  happiness: number;
  intellect: number;
  strength: number;
  streak_days: number;
  last_active_date: string | null;
  hatched_at: string | null;
  created_at: string;
  avatar_url: string | null;
  avatar_status: "none" | "pending" | "completed" | "failed";
  avatar_generation_id: string | null;
  avatar_description: string | null;
  avatar_seed: number | null;
  avatar_source_url: string | null;
  avatar_stage: string | null;
  avatar_target_stage: string | null;
  /** Steps granted as rewards rather than walked — excluded from the level baseline. */
  bonus_steps: number;
  /** Free evolution tiers earned by inviting players. */
  evolution_bonus_tiers: number;
}

export interface PetState {
  pet: Pet;
  todaySteps: number;
}

/** A sync response deliberately leaves out `avatar_url` — it's a ~200KB base64 PNG and shipping
 *  it three times a minute was the single biggest cost in the sync. The key is absent rather
 *  than null, so merging the payload over the current pet keeps the image on screen; a new one
 *  arrives through the avatar poll. Reset does send an explicit null, which correctly clears it. */
export type PetSync = Omit<Pet, "avatar_url"> & { avatar_url?: string | null };

export interface SyncState {
  pet: PetSync;
  todaySteps: number;
}

/** The device's current UTC offset in minutes east of UTC (Moscow → 180). Sent on every request
 *  so the server runs the player's day — step ring, milestones, streaks — on their local
 *  midnight. Recomputed per request, so DST changes and travel are handled without any setup. */
export function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

function initDataHeader(): Record<string, string> {
  const initData = window.Telegram?.WebApp?.initData;
  const headers: Record<string, string> = { "x-tz-offset": String(tzOffsetMinutes()) };
  if (initData) headers["x-telegram-init-data"] = initData;
  return headers;
}

export async function fetchPet(): Promise<PetState & { googleFitConnected: boolean }> {
  const res = await fetch("/api/pet", { headers: { ...initDataHeader() } });
  if (!res.ok) throw new Error(`GET /api/pet failed: ${res.status}`);
  return res.json();
}

/** Every action on your own pet goes through POST /api/pet with an `action` discriminator —
 *  they all authenticate the same way and all answer with the same pet object, so they share
 *  one route (see api/pet.ts for why the endpoint count matters). */
async function petAction<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/pet", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...initDataHeader() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST /api/pet (${body.action}) failed: ${res.status}`);
  return res.json();
}

export function requestAvatar(description: string): Promise<{ pet: Pet }> {
  return petAction({ action: "avatar", description });
}

/** Omitting the name asks the server to come up with one. */
export function generateAiPetName(): Promise<{ pet: Pet }> {
  return petAction({ action: "name" });
}

export function setCustomPetName(name: string): Promise<{ pet: Pet }> {
  return petAction({ action: "name", name });
}

export async function pollAvatar(): Promise<{ pet: Pet }> {
  const res = await fetch("/api/pet?action=avatar-poll", { headers: { ...initDataHeader() } });
  if (!res.ok) throw new Error(`GET /api/pet?action=avatar-poll failed: ${res.status}`);
  return res.json();
}

export async function getGoogleFitStatus(): Promise<{ connected: boolean }> {
  const res = await fetch("/api/google-fit", { headers: { ...initDataHeader() } });
  if (!res.ok) throw new Error(`GET /api/google-fit failed: ${res.status}`);
  return res.json();
}

export async function startGoogleFitAuth(): Promise<{ url: string }> {
  const res = await fetch("/api/auth/google/start", { headers: { ...initDataHeader() } });
  if (!res.ok) throw new Error(`GET /api/auth/google/start failed: ${res.status}`);
  return res.json();
}

export async function syncGoogleFit(): Promise<SyncState> {
  const res = await fetch("/api/google-fit", { method: "POST", headers: { ...initDataHeader() } });
  if (!res.ok) throw new Error(`POST /api/google-fit failed: ${res.status}`);
  return res.json();
}

export interface StepHistoryDay {
  date: string;
  steps: number;
}

export async function getStepHistory(params: { range?: 7 | 30; month?: string }): Promise<{ history: StepHistoryDay[] }> {
  const qs = params.month ? `month=${params.month}` : `range=${params.range ?? 7}`;
  const res = await fetch(`/api/stats?${qs}`, { headers: { ...initDataHeader() } });
  if (!res.ok) throw new Error(`GET /api/stats failed: ${res.status}`);
  return res.json();
}

/** Irreversible: wipes the pet back to a fresh egg and clears its step history. Google Fit
 *  stays connected and simply starts contributing to the new pet from zero. */
export function resetPet(): Promise<PetState> {
  return petAction({ action: "reset" });
}

export interface InvitedFriend {
  userId: number;
  username: string | null;
  petName: string | null;
  species: string;
  level: number;
  hatched: boolean;
  rewardGranted: boolean;
  avatarGenerationId: string | null;
}

export interface ReferralSummary {
  code: string;
  link: string;
  invitedCount: number;
  confirmedCount: number;
  bonusTiers: number;
  maxBonusTiers: number;
  invited: InvitedFriend[];
  invitedByUsername: string | null;
}

export async function fetchReferrals(): Promise<ReferralSummary> {
  const res = await fetch("/api/referrals", { headers: { ...initDataHeader() } });
  if (!res.ok) throw new Error(`GET /api/referrals failed: ${res.status}`);
  return res.json();
}

export interface PlayerRow {
  userId: number;
  username: string | null;
  petName: string | null;
  species: string;
  rarity: Rarity;
  level: number;
  hatched: boolean;
  avatarGenerationId: string | null;
  weekSteps: number;
  isMe: boolean;
}

export interface SocialSnapshot {
  weekStart: string;
  friends: PlayerRow[];
  top: PlayerRow[];
  myRank: number | null;
  myWeekSteps: number;
}

export async function fetchSocial(): Promise<SocialSnapshot> {
  const res = await fetch("/api/social", { headers: { ...initDataHeader() } });
  if (!res.ok) throw new Error(`GET /api/social failed: ${res.status}`);
  return res.json();
}

/** Pet artwork as a cacheable image URL rather than an inlined data URL — see api/pet-image.ts.
 *  Used for lists (invited friends, leaderboard) where inlining would mean megabytes. */
export function petImageUrl(userId: number, version: string | null): string {
  return `/api/pet-image?u=${userId}&v=${encodeURIComponent(version ?? "0")}`;
}

/** Absolute URL of the shareable pet card PNG — absolute because shareToStory hands it to
 *  Telegram, which fetches it from its own servers and cannot resolve a relative path. The Mini
 *  App is served from the same origin as the API, so the client can compose this itself.
 *
 *  `v` covers everything the card draws, so a pet that has just levelled up is never shared as
 *  its older self out of a cache. Kept in step with petCardUrl in api/_lib/share.ts. */
export function petCardUrl(pet: Pet | PetSync, format: "square" | "story" = "square"): string {
  const version = `${pet.level}.${pet.streak_days}.${pet.lifetime_steps}.${pet.avatar_generation_id ?? "0"}`;
  const query = new URLSearchParams({ v: version });
  if (format === "story") query.set("f", "story");
  return `${window.location.origin}/card/${pet.user_id}.png?${query.toString()}`;
}

/** Stages the card as an inline message for Telegram's own share sheet. */
export function preparePetCardShare(): Promise<{ preparedMessageId: string }> {
  return petAction({ action: "share", target: "sheet" });
}

/** Sends the card to the player's own chat with the bot — the fallback where the share sheet
 *  isn't available. */
export function sendPetCardToChat(): Promise<{ sent: boolean }> {
  return petAction({ action: "share", target: "chat" });
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready: () => void;
        expand: () => void;
        openLink?: (url: string) => void;
        openTelegramLink?: (url: string) => void;
        isVersionAtLeast?: (version: string) => boolean;
        /** Bot API 8.0. Opens the native chat picker for a message staged server-side with
         *  savePreparedInlineMessage. */
        shareMessage?: (preparedMessageId: string, callback?: (sent: boolean) => void) => void;
        /** Bot API 7.8. Opens the story editor with the given image already placed. */
        shareToStory?: (mediaUrl: string, params?: { text?: string; widget_link?: { url: string; name?: string } }) => void;
      };
    };
  }
}
