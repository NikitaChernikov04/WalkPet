import {
  EVOLUTION_BODY_PROMPT,
  EVOLUTION_GEAR_DELTA_PROMPT,
  EVOLUTION_OUTFIT_PROMPT,
  type EvolutionStage,
} from "./leveling.js";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export const RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

export const RARITY_LABELS: Record<Rarity, string> = {
  common: "Обычный",
  uncommon: "Необычный",
  rare: "Редкий",
  epic: "Эпический",
  legendary: "Легендарный",
};

// Weighted odds for the tier a freshly-hatched pet rolls into. Common dominates so rarer
// tiers stay meaningful; legendary is intentionally a near-jackpot.
const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 55,
  uncommon: 26,
  rare: 13,
  epic: 5,
  legendary: 1,
};

// Rarity isn't just cosmetic: it permanently raises how high a pet's stats can ever go
// (added on top of the level-based cap, see statCapForLevel in leveling.ts)...
export const RARITY_STAT_CAP_BONUS: Record<Rarity, number> = {
  common: 0,
  uncommon: 5,
  rare: 12,
  epic: 22,
  legendary: 40,
};

// ...and makes a pet hardier — inactivity decay is scaled down by this factor, so a
// legendary pet fades much more slowly than a common one when neglected.
export const RARITY_DECAY_RESISTANCE: Record<Rarity, number> = {
  common: 1,
  uncommon: 0.85,
  rare: 0.7,
  epic: 0.55,
  legendary: 0.35,
};

// Every real-world (and, for the top two tiers, mythical) animal a pet can hatch as, grouped
// by the rarity tier it belongs to. Picked uniformly at random within the rolled tier.
const SPECIES_BY_RARITY: Record<Rarity, string[]> = {
  common: [
    "Кот", "Ленивый кот", "Пёс", "Кролик", "Хомяк", "Морская свинка", "Мышь", "Крыса",
    "Ёж", "Белка", "Бобр", "Крот", "Летучая мышь", "Заяц", "Овца", "Коза", "Корова",
    "Свинья", "Осёл", "Лошадь", "Пони", "Курица", "Петух", "Утка", "Гусь", "Индюк",
    "Голубь", "Воробей", "Ворона", "Сорока", "Синица", "Снегирь", "Дятел", "Черепаха",
    "Лягушка", "Жаба", "Улитка", "Божья коровка", "Бабочка", "Пчела",
  ],
  uncommon: [
    "Волк", "Лиса", "Енот", "Барсук", "Скунс", "Опоссум", "Дикобраз", "Куница",
    "Горностай", "Ласка", "Рысь", "Пума", "Койот", "Шакал", "Олень", "Лось", "Косуля",
    "Кабан", "Лама", "Альпака", "Верблюд", "Сова", "Филин", "Орёл", "Сокол", "Ястреб",
    "Ворон", "Цапля", "Фламинго", "Пеликан", "Лебедь", "Павлин", "Попугай", "Тукан",
    "Игуана", "Хамелеон", "Геккон", "Варан", "Змея", "Тритон", "Саламандра", "Аксолотль",
    "Краб", "Морская звезда", "Осьминог", "Кальмар", "Скат", "Богомол", "Стрекоза",
    "Скорпион", "Паук",
  ],
  rare: [
    "Тигр", "Лев", "Леопард", "Гепард", "Пантера", "Снежный барс", "Медведь",
    "Бурый медведь", "Белый медведь", "Панда", "Красная панда", "Росомаха", "Выдра",
    "Броненосец", "Муравьед", "Ленивец", "Кенгуру", "Валлаби", "Коала", "Вомбат",
    "Тасманийский дьявол", "Утконос", "Ехидна", "Слон", "Носорог", "Бегемот", "Жираф",
    "Зебра", "Антилопа", "Буйвол", "Як", "Горилла", "Шимпанзе", "Орангутан", "Гиббон",
    "Бабуин", "Лемур", "Тюлень", "Морж", "Дельфин", "Акула", "Крокодил", "Аллигатор",
    "Кобра", "Питон", "Страус", "Эму", "Казуар", "Пингвин", "Альбатрос",
  ],
  epic: [
    "Дракон", "Феникс", "Единорог", "Грифон", "Пегас", "Кицунэ", "Химера", "Сфинкс",
    "Морской дракон", "Ледяной волк", "Огненный тигр", "Звёздный олень", "Кит", "Косатка",
    "Нарвал",
  ],
  legendary: [
    "Космический Дракон", "Небесный Феникс", "Левиафан", "Королевский Грифон",
    "Астральный Единорог", "Владыка Бурь", "Хранитель Галактики", "Изумрудный Кракен",
  ],
};

function weightedRandomRarity(): Rarity {
  const total = RARITY_ORDER.reduce((sum, r) => sum + RARITY_WEIGHTS[r], 0);
  let roll = Math.random() * total;
  for (const rarity of RARITY_ORDER) {
    roll -= RARITY_WEIGHTS[rarity];
    if (roll <= 0) return rarity;
  }
  return "common";
}

export function pickRandomSpecies(): { species: string; rarity: Rarity } {
  const rarity = weightedRandomRarity();
  const pool = SPECIES_BY_RARITY[rarity];
  const species = pool[Math.floor(Math.random() * pool.length)];
  return { species, rarity };
}

// Visual embellishment that scales with rarity so higher-tier pets actually *look* more
// special in the generated artwork, not just in a text label. Deliberately body/color effects
// only (glow, particles, saturation) — never clothing or worn items, since those are earned
// through leveling (see EVOLUTION_OUTFIT_PROMPT), not rolled at birth via rarity.
const RARITY_PROMPT_MODIFIERS: Record<Rarity, string> = {
  common: "Simple, friendly, approachable design.",
  uncommon: "Slightly richer, more saturated colors.",
  rare: "Vivid saturated colors and a subtle magical glow around the character's body.",
  epic: "Radiant magical aura and glowing particles floating around its body.",
  legendary:
    "Majestic legendary presence, shimmering ethereal aura around its body, glowing runes or star-like sparkles in the air around it, awe-inspiring god-tier design.",
};

export function buildPetPrompt(
  species: string,
  userDescription: string,
  rarity: Rarity,
  evolutionStage: EvolutionStage = "baby",
): string {
  const hasCustomFlavor = userDescription.trim().length > 0;
  const flavorSentence = hasCustomFlavor ? `Player's custom flavor: ${userDescription}. ` : "";
  // The default per-stage outfit (e.g. "completely bare" for a baby) only applies when the
  // player hasn't described their own look — an explicit custom flavor always wins instead of
  // fighting it (e.g. someone describing "a knight in armor" for their brand-new hatchling).
  const outfitSentence = hasCustomFlavor ? "" : `${EVOLUTION_OUTFIT_PROMPT[evolutionStage]} `;
  return (
    `Cute stylized mobile-game pet character, ${species}, full body visible from head to feet, ` +
    `either standing upright on two legs like a game mascot or posed naturally on all four legs like ` +
    `a real animal — pick whichever suits the description best. Dynamic walking pose, flat illustration ` +
    `style, vibrant colors, centered composition. Rarity tier: ${rarity}. ${RARITY_PROMPT_MODIFIERS[rarity]} ` +
    `${EVOLUTION_BODY_PROMPT[evolutionStage]} ${outfitSentence}` +
    `Background: solid flat single-color chroma-key screen, pure uniform magenta color rgb(255,0,255), ` +
    `no gradient, no pattern, no texture, no shadow, no other colors anywhere in the background. ` +
    `${flavorSentence}No text, no watermark.`
  );
}

// Image-to-image edit prompt for an evolution level-up: describes ONLY the new clothing/gear
// to add on top of the pet's current (reference) image, explicitly preserving everything else
// so the same-looking creature just gets progressively more dressed up as it levels.
export function buildEvolutionEditPrompt(species: string, rarity: Rarity, evolutionStage: EvolutionStage): string {
  const gearDelta = EVOLUTION_GEAR_DELTA_PROMPT[evolutionStage];
  return (
    `This is the same ${species} pet character (rarity: ${rarity}) shown in the reference image — ` +
    `keep it recognizably the same creature. ${gearDelta ?? ""} Keep the exact same solid magenta ` +
    `chroma-key background (rgb(255,0,255)), the same flat illustration art style, and the same ` +
    `centered composition. No text, no watermark.`
  );
}
