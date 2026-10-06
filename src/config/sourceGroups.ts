// Группы изданий на странице настроек ленты (app/settings) — по макету в
// Figma (DIS-28). Это группировка ИЗДАНИЙ по их профилю, а не темы новостей
// (CATEGORIES в categories.ts размечаются моделью у каждой статьи и живут
// своей жизнью): Wired пишет и про политику, но в настройках он в
// "Технологиях". Имена — как в sources.ts / таблице sources. Издания, которых
// здесь нет (например, новое, добавленное позже), страница покажет в группе
// "Другие" в конце — чтобы его всё равно можно было выключить.
//
// Группа "Искусство" из макета разделена вслед за рубриками ленты (см.
// categories.ts): на кино, музыку и дизайн.
export const SOURCE_GROUPS: { label: string; sources: string[] }[] = [
  { label: "Технологии", sources: ["Wired", "The Verge", "TechCrunch", "9to5Mac"] },
  { label: "Наука", sources: ["Scientific American", "Popular Mechanics"] },
  {
    label: "Политика",
    sources: [
      "The NY Times",
      "The Telegraph",
      "TIME",
      "The New Yorker",
      "The Washington Post",
      "NY Magazine",
      "The Wall Street Journal",
      "Bloomberg",
      "The Economist",
      "The Guardian",
      "BBC",
    ],
  },
  { label: "Лайфстайл", sources: ["Lifehacker", "GQ", "Esquire", "Maxim", "Condé Nast Traveler"] },
  { label: "Игры", sources: ["IGN", "GameSpot", "Kotaku", "Polygon", "Eurogamer"] },
  { label: "Кино и сериалы", sources: ["The Hollywood Reporter", "Variety"] },
  { label: "Музыка", sources: ["Pitchfork", "Rolling Stone"] },
  // Creative Bloq в макете нет (добавлен позже) — по профилю это дизайн.
  {
    label: "Дизайн",
    sources: [
      "Wallpaper",
      "Creative Bloq",
      "Dezeen",
      "designboom",
      "The Art Newspaper",
      "It's Nice That",
      "Monocle",
      "Creative Boom",
      "Hyperallergic",
      "Colossal",
      "Design Week",
      "Design Milk",
      "ArchitectureAU",
      "DesignWanted",
      "Fast Company",
      "Abduzeedo",
    ],
  },
  // Motor1 в макете нет (добавлен позже).
  { label: "Авто", sources: ["Car and Driver", "Motor Trend", "InsideEVs", "Motor1"] },
];

export const OTHER_SOURCES_LABEL = "Другие";
