// Группы изданий на странице настроек ленты (app/settings) — по макету в
// Figma (DIS-28). Это группировка ИЗДАНИЙ по их профилю, а не темы новостей
// (CATEGORIES в categories.ts размечаются моделью у каждой статьи и живут
// своей жизнью): Wired пишет и про политику, но в настройках он в
// "Технологиях". Имена — как в sources.ts / таблице sources. Издания, которых
// здесь нет (например, новое, добавленное позже), страница покажет в группе
// "Другие" в конце — чтобы его всё равно можно было выключить.
export const SOURCE_GROUPS: { label: string; sources: string[] }[] = [
  { label: "Технологии", sources: ["Wired", "The Verge", "TechCrunch", "9to5Mac"] },
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
  { label: "Лайфстайл", sources: ["Lifehacker", "GQ", "Condé Nast Traveler"] },
  { label: "Игры", sources: ["IGN", "GameSpot", "Kotaku", "Polygon", "Eurogamer"] },
  // Creative Bloq в макете нет (добавлен позже) — по профилю это дизайн.
  {
    label: "Искусство",
    sources: ["Pitchfork", "The Hollywood Reporter", "Variety", "Rolling Stone", "Wallpaper", "Creative Bloq"],
  },
  // Motor1 в макете нет (добавлен позже).
  { label: "Авто", sources: ["Car and Driver", "Motor Trend", "InsideEVs", "Motor1"] },
];

export const OTHER_SOURCES_LABEL = "Другие";
