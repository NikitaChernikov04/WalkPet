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
}

export interface PetState {
  pet: Pet;
  todaySteps: number;
}

function initDataHeader(): Record<string, string> {
  const initData = window.Telegram?.WebApp?.initData;
  return initData ? { "x-telegram-init-data": initData } : {};
}

export async function fetchPet(): Promise<PetState> {
  const res = await fetch("/api/pet", { headers: { ...initDataHeader() } });
  if (!res.ok) throw new Error(`GET /api/pet failed: ${res.status}`);
  return res.json();
}

export async function requestAvatar(description: string): Promise<{ pet: Pet }> {
  const res = await fetch("/api/avatar", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...initDataHeader() },
    body: JSON.stringify({ description }),
  });
  if (!res.ok) throw new Error(`POST /api/avatar failed: ${res.status}`);
  return res.json();
}

export async function generateAiPetName(): Promise<{ pet: Pet }> {
  const res = await fetch("/api/pet-name", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...initDataHeader() },
    body: JSON.stringify({ mode: "ai" }),
  });
  if (!res.ok) throw new Error(`POST /api/pet-name failed: ${res.status}`);
  return res.json();
}

export async function setCustomPetName(name: string): Promise<{ pet: Pet }> {
  const res = await fetch("/api/pet-name", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...initDataHeader() },
    body: JSON.stringify({ mode: "custom", name }),
  });
  if (!res.ok) throw new Error(`POST /api/pet-name failed: ${res.status}`);
  return res.json();
}

export async function pollAvatar(): Promise<{ pet: Pet }> {
  const res = await fetch("/api/avatar", { headers: { ...initDataHeader() } });
  if (!res.ok) throw new Error(`GET /api/avatar failed: ${res.status}`);
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

export async function syncGoogleFit(): Promise<PetState> {
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
export async function resetPet(): Promise<PetState> {
  const res = await fetch("/api/pet-reset", {
    method: "POST",
    headers: { ...initDataHeader() },
  });
  if (!res.ok) throw new Error(`POST /api/pet-reset failed: ${res.status}`);
  return res.json();
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: { initData: string; ready: () => void; expand: () => void; openLink?: (url: string) => void };
    };
  }
}
