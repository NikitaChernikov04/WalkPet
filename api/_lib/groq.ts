const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-8b-instant";

// Local fallback so a Groq outage or missing key never blocks naming — small pool of
// generic, upbeat pet-name-shaped words that read fine for any species.
const FALLBACK_NAMES = [
  "Барсик", "Шустрик", "Искра", "Бублик", "Ветерок", "Уголёк", "Пушок", "Твистер",
  "Симба", "Рекс", "Соня", "Дымок", "Клякса", "Тень", "Ласка", "Гром", "Юки", "Смузи",
];

function randomFallbackName(): string {
  return FALLBACK_NAMES[Math.floor(Math.random() * FALLBACK_NAMES.length)];
}

// Strips quotes/punctuation/explanatory fluff the model might add despite instructions,
// and keeps only the first line so a chatty response can't leak into the pet's name.
function sanitizeName(raw: string): string | null {
  const firstLine = raw.split("\n")[0].trim();
  const cleaned = firstLine.replace(/^["'«»“”\-–—.\s]+|["'«»“”\-–—.\s]+$/g, "");
  if (!cleaned || cleaned.length > 24 || cleaned.split(/\s+/).length > 3) return null;
  return cleaned;
}

/** Best-effort AI pet name suggestion. Never throws — falls back to a local random name if
 *  GROQ_API_KEY is unset, the request fails, or the model's output doesn't look like a name. */
export async function generatePetName(species: string, description: string | null): Promise<string> {
  if (!process.env.GROQ_API_KEY) return randomFallbackName();

  try {
    const flavor = description?.trim() ? ` Дополнительный образ питомца: ${description.trim()}.` : "";
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content:
              `Придумай одну короткую, звучную кличку на русском языке (1-2 слова, до 24 символов) ` +
              `для питомца в мобильной игре — это ${species}.${flavor} ` +
              `Ответь СТРОГО одной кличкой, без кавычек, пояснений и знаков препинания.`,
          },
        ],
        max_tokens: 16,
        temperature: 1.1,
      }),
    });
    if (!res.ok) return randomFallbackName();

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? "";
    return sanitizeName(raw) ?? randomFallbackName();
  } catch {
    return randomFallbackName();
  }
}
