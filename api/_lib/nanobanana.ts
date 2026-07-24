const POLZA_BASE = "https://polza.ai/api/v1";
// gpt-image-1.5 renders noticeably more polished, coherent character art than
// gemini-2.5-flash-image and — critically — actually respects a solid chroma-key
// background instruction cleanly (tested directly against the API), which the
// flash model didn't reliably do. "medium" quality keeps the per-generation cost
// the same as the old model; "high" costs ~5x more for extra detail.
const MODEL = "openai/gpt-image-1.5";

export interface MediaGeneration {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  data?: { url: string }[] | null;
  error?: { code: string; message: string } | null;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.POLZA_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export function avatarUrlFrom(gen: MediaGeneration): string | undefined {
  return gen.data?.[0]?.url;
}

export function buildPetPrompt(species: string, userDescription: string): string {
  return (
    `Cute stylized mobile-game pet character, ${species}, full body visible from head to feet, ` +
    `either standing upright on two legs like a game mascot or posed naturally on all four legs like ` +
    `a real animal — pick whichever suits the description best. Dynamic walking pose, flat illustration ` +
    `style, vibrant colors, centered composition. Background: solid flat single-color chroma-key screen, ` +
    `pure uniform magenta color rgb(255,0,255), no gradient, no pattern, no texture, no shadow, no other ` +
    `colors anywhere in the background. Player's custom flavor: ${userDescription}. No text, no watermark.`
  );
}

// `async: true` is required to get a trackable job id ("gen_...") back. Without it,
// a generation that doesn't finish within the request returns a plain UUID id that
// GET /media/{id} can never resolve (always 404s), so polling would be pointless.
export async function startAvatarGeneration(prompt: string): Promise<MediaGeneration> {
  const res = await fetch(`${POLZA_BASE}/media`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ model: MODEL, input: { prompt, aspect_ratio: "1:1", quality: "medium" }, async: true }),
  });
  if (!res.ok) throw new Error(`polza /media failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<MediaGeneration>;
}

export async function getAvatarGeneration(id: string): Promise<MediaGeneration> {
  const res = await fetch(`${POLZA_BASE}/media/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`polza /media/${id} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<MediaGeneration>;
}
