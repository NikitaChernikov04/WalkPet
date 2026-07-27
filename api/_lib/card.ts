import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "@vercel/og";
import type { Pet } from "./pet-logic.js";
import type { Rarity } from "./species.js";

/** Renders a shareable pet card to PNG.
 *
 *  Server-side rather than on the client, because both destinations need a URL Telegram itself
 *  can fetch: a prepared inline message carries `photo_url`, and story sharing takes `media_url`.
 *  A canvas render in the Mini App would produce a blob with nowhere to live, so it would have to
 *  be uploaded and stored somewhere before either of those could use it. */

const PALETTE = {
  canvas: "#1b1b4e",
  canvasDeep: "#101036",
  panel: "rgba(255, 255, 255, 0.07)",
  hairline: "rgba(255, 255, 255, 0.16)",
  ink: "#ffffff",
  inkSoft: "rgba(255, 255, 255, 0.62)",
  gold: "#ffc94a",
  lime: "#b6ff3d",
};

// Mirrors .rarity-* in client/src/App.css, so a card looks like the pet the player is looking at.
const RARITY_COLOR: Record<Rarity, string> = {
  common: "#9ba3b4",
  uncommon: "#b6ff3d",
  rare: "#4cc2ff",
  epic: "#9b6bff",
  legendary: "#ffc94a",
};

const RARITY_LABEL: Record<Rarity, string> = {
  common: "Обычный",
  uncommon: "Необычный",
  rare: "Редкий",
  epic: "Эпический",
  legendary: "Легендарный",
};

export type CardFormat = "square" | "story";

/** Story canvases are 9:16. Rendering that size here rather than letting Telegram letterbox a
 *  square means the card fills the screen instead of floating in bars. */
export const CARD_SIZE: Record<CardFormat, { width: number; height: number; art: number; name: number }> = {
  square: { width: 1080, height: 1080, art: 460, name: 88 },
  story: { width: 1080, height: 1920, art: 620, name: 104 },
};

/** Keeps only what the two bundled faces can actually draw: Latin, Cyrillic, digits and a little
 *  punctuation.
 *
 *  This is not cosmetic tidying. Satori's answer to a glyph it has no font for is to fetch one
 *  from Google Fonts in the middle of the render, so a single unexpected character turns every
 *  card into a call to a third party — and an unreachable one into a failed card. A thin space in
 *  the digit grouping below did exactly that here before it was caught. Pet names come from a
 *  language model or from the player, so "nothing unexpected will appear" is not an assumption
 *  this can make: an emoji in a name is dropped from the card rather than being allowed to take
 *  the renderer down with it. */
function renderable(text: string): string {
  return text.replace(/[^ -~ -ÿЀ-ӿ–—•·]/gu, "").trim();
}

/** Grouped by hand rather than through toLocaleString, which produces a narrow no-break space on
 *  some ICU builds and a plain one on others. The separator is U+0020 and deliberately nothing
 *  more exotic — see renderable() above. */
function groupDigits(n: number): string {
  return String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Satori takes React elements; building them by hand keeps this a plain .ts module, with no JSX
// pragma or React dependency added to the API side for one image.
type Element = { type: string; props: Record<string, unknown>; key: null };
const h = (type: string, props: Record<string, unknown>): Element => ({ type, props, key: null });

let fonts: { name: string; data: Buffer; weight: 500 | 700; style: "normal" }[] | null = null;

/** Manrope is one of the app's own three faces and the only one of them that carries Cyrillic —
 *  Baloo 2 and Space Grotesk are Latin-only, and @vercel/og's built-in face is Latin too, so a
 *  Russian pet name would have rendered as blank boxes. Static weights, not the variable file:
 *  satori's font parser trips over an `fvar` table. Read once per warm instance. */
function loadFonts() {
  if (!fonts) {
    const dir = path.join(process.cwd(), "api", "_lib", "fonts");
    fonts = [
      { name: "Manrope", data: fs.readFileSync(path.join(dir, "Manrope-Bold.ttf")), weight: 700, style: "normal" },
      { name: "Manrope", data: fs.readFileSync(path.join(dir, "Manrope-Medium.ttf")), weight: 500, style: "normal" },
    ];
  }
  return fonts;
}

function statBlock(value: string, label: string, color: string, scale: number): Element {
  return h("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      flex: 1,
    },
    children: [
      h("div", { style: { fontSize: 56 * scale, fontWeight: 700, color }, children: value }),
      h("div", {
        style: { fontSize: 26 * scale, fontWeight: 500, color: PALETTE.inkSoft, marginTop: 6 },
        children: label,
      }),
    ],
  });
}

/** The artwork, or a rarity-tinted disc when the pet has none yet — a card with an empty hole
 *  where the pet should be is worse than one that simply leads with the name. */
function artwork(pet: Pet, size: number, accent: string): Element {
  const src = pet.avatar_url?.startsWith("data:image/") ? pet.avatar_url : null;
  return h("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: size,
      height: size,
      borderRadius: size / 2,
      background: PALETTE.panel,
      border: `4px solid ${accent}`,
    },
    children: src
      ? [h("img", { src, width: Math.round(size * 0.82), height: Math.round(size * 0.82) })]
      : [
          h("div", {
            style: { fontSize: size * 0.3, fontWeight: 700, color: accent },
            children: renderable(pet.species).slice(0, 1) || "?",
          }),
        ],
  });
}

export async function renderPetCard(pet: Pet, format: CardFormat = "square"): Promise<Buffer> {
  const { width, height, art, name } = CARD_SIZE[format];
  const scale = format === "story" ? 1.15 : 1;
  const accent = RARITY_COLOR[pet.rarity] ?? RARITY_COLOR.common;
  const walked = Math.max(0, pet.lifetime_steps - pet.bonus_steps);

  // A flex item does not wrap and satori has no ellipsis, so a long name simply ran off both
  // edges of the canvas. The app caps names at 24 characters, but the card is rendered from
  // whatever is in the row, so it clamps rather than trusting that. Long names also step down a
  // size, which keeps the common short ones as big as they deserve to be.
  const full = renderable(pet.name ?? "") || "Питомец";
  const petName = full.length > 22 ? `${full.slice(0, 21)}...` : full;
  const nameSize = petName.length > 14 ? Math.round(name * 0.68) : name;

  const card = h("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      height: "100%",
      padding: format === "story" ? "120px 80px" : "72px 64px",
      backgroundImage: `linear-gradient(160deg, ${PALETTE.canvas} 0%, ${PALETTE.canvasDeep} 100%)`,
      fontFamily: "Manrope",
      color: PALETTE.ink,
    },
    children: [
      artwork(pet, art, accent),

      h("div", {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: nameSize,
          fontWeight: 700,
          marginTop: 48,
          textAlign: "center",
          // Roomy on purpose: at 1.1 the line box came out shorter than Cyrillic ascenders and
          // descenders actually draw, and the badge below was laid out straight over the name.
          lineHeight: 1.35,
        },
        children: petName,
      }),

      h("div", {
        style: {
          display: "flex",
          alignItems: "center",
          marginTop: 18,
          padding: "12px 28px",
          borderRadius: 999,
          background: PALETTE.panel,
          border: `2px solid ${PALETTE.hairline}`,
          fontSize: 32 * scale,
          fontWeight: 500,
          color: accent,
        },
        children: `${renderable(pet.species)} · ${RARITY_LABEL[pet.rarity] ?? ""}`,
      }),

      h("div", {
        style: {
          display: "flex",
          width: "100%",
          marginTop: format === "story" ? 96 : 64,
          paddingTop: 40,
          borderTop: `2px solid ${PALETTE.hairline}`,
        },
        children: [
          statBlock(String(pet.level), "уровень", PALETTE.ink, scale),
          statBlock(
            String(pet.streak_days),
            plural(pet.streak_days, "день подряд", "дня подряд", "дней подряд"),
            PALETTE.gold,
            scale,
          ),
          statBlock(groupDigits(walked), "шагов", PALETTE.lime, scale),
        ],
      }),

      h("div", {
        style: {
          display: "flex",
          marginTop: format === "story" ? 90 : 56,
          fontSize: 28 * scale,
          fontWeight: 700,
          letterSpacing: 4,
          color: PALETTE.inkSoft,
        },
        children: "WALKPET",
      }),
    ],
  });

  const response = new ImageResponse(card as never, { width, height, fonts: loadFonts() });
  return Buffer.from(await response.arrayBuffer());
}
