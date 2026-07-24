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

// A large pool of flavor descriptions layered onto the base species when auto-generating an
// avatar right at hatch time (the player can still describe their own afterwards).
const AVATAR_FLAVORS = [
  "космический исследователь в скафандре",
  "маленький рыцарь в блестящих доспехах",
  "диджей в неоновых наушниках",
  "искатель приключений с картой и биноклем",
  "супергерой в развевающемся плаще",
  "путешественник во времени в стимпанк-очках",
  "пиратский капитан в треуголке",
  "детектив в плаще со шляпой и лупой",
  "рок-звезда с электрогитарой",
  "волшебник в мантии со звёздами",
  "самурай с катаной и в лёгкой броне",
  "шеф-повар в белом колпаке с половником",
  "профессор в твидовом пиджаке и с книгой",
  "сноубордист в яркой куртке и очках",
  "диджей-робот с мигающими огоньками",
  "художник с палитрой и в берете",
  "садовник в соломенной шляпе с лейкой",
  "гонщик в шлеме и кожаной куртке",
  "звёздный ди-джей в блестящем костюме",
  "исследователь джунглей в хаки-форме",
  "снежный альпинист с ледорубом и в тёплой куртке",
  "уличный музыкант с гитарой и в шляпе",
  "король/королева в маленькой короне и мантии",
  "инопланетный гость с антеннами и в скафандре",
  "ниндзя в чёрном облачении с капюшоном",
  "цирковой акробат в блестящем костюме",
  "почтальон с сумкой и в форменной кепке",
  "капитан подводной лодки с биноклем",
  "фермер в комбинезоне и соломенной шляпе",
  "зимний олимпиец с медалью на шее",
  "стимпанк-изобретатель с механическими шестерёнками",
  "маленький бог грома с молнией в лапе",
  "воздухоплаватель в корзине воздушного шара",
  "детский супергерой в маске и с плащом-пелёнкой",
  "джазовый саксофонист в костюме",
  "лыжник в горнолыжном костюме и с очками",
  "археолог со шляпой-федорой и кистью",
  "весёлый клоун с воздушными шариками",
  "звездочёт с телескопом и картой созвездий",
  "рыцарь-дракон в чешуйчатых доспехах",
  "снежная фея в ледяном наряде",
  "мультяшный шпион в тёмных очках и плаще",
  "мастер боевых искусств в кимоно с чёрным поясом",
  "путешественник по пустыне в бедуинском наряде",
  "капитан космического корабля с лазерным бластером",
  "маленький пекарь с испачканным мукой фартуком",
  "летний сёрфер с доской и в гавайской рубашке",
  "рождественский эльф в колпаке с бубенчиком",
  "рыцарь света с сияющим щитом",
  "хипстер в очках и с чашкой кофе",
  "викинг в рогатом шлеме и с топором",
];

export function randomAvatarFlavor(): string {
  return AVATAR_FLAVORS[Math.floor(Math.random() * AVATAR_FLAVORS.length)];
}

// Visual embellishment that scales with rarity so higher-tier pets actually *look* more
// special in the generated artwork, not just in a text label.
const RARITY_PROMPT_MODIFIERS: Record<Rarity, string> = {
  common: "Simple, friendly, approachable design.",
  uncommon: "Slightly richer colors and one small unique accessory.",
  rare: "Vivid saturated colors, a subtle magical glow around the character, an eye-catching accessory.",
  epic: "Radiant magical aura, glowing particles floating around it, ornate fantasy-style accessories and markings.",
  legendary:
    "Majestic legendary presence, shimmering ethereal aura, intricate ornate details, glowing runes or star-like sparkles, a crown or majestic markings, awe-inspiring god-tier design.",
};

export function buildPetPrompt(species: string, userDescription: string, rarity: Rarity): string {
  return (
    `Cute stylized mobile-game pet character, ${species}, full body visible from head to feet, ` +
    `either standing upright on two legs like a game mascot or posed naturally on all four legs like ` +
    `a real animal — pick whichever suits the description best. Dynamic walking pose, flat illustration ` +
    `style, vibrant colors, centered composition. Rarity tier: ${rarity}. ${RARITY_PROMPT_MODIFIERS[rarity]} ` +
    `Background: solid flat single-color chroma-key screen, pure uniform magenta color rgb(255,0,255), ` +
    `no gradient, no pattern, no texture, no shadow, no other colors anywhere in the background. ` +
    `Player's custom flavor: ${userDescription}. No text, no watermark.`
  );
}
