// Стартовый список источников. Проверь актуальность RSS-ссылок на сайтах изданий —
// пути иногда меняются, National Geographic и Telegraph особенно любят их переносить.
//
// contentSelector (опционально) — CSS-селектор, который вручную проверен как
// однозначно указывающий на тело статьи именно на этом сайте (см. extractBySelector
// в src/lib/ogTags.ts). Компромисс между "свой парсер на каждое издание" (точнее,
// но 30+ источников на ручной поддержке — вёрстка сайтов меняется регулярно) и
// одной универсальной эвристикой на все сайты сразу (проще, но неизбежно менее
// точна там, где у конкретного сайта нестандартная структура, см. коммент у
// extractLargestArticleScope). Без селектора источник просто использует общий
// каскад JSON-LD → крупнейший <article> → вся страница — большинству изданий
// этого достаточно, override нужен только когда общий каскад демонстрирует
// проблему на конкретном сайте, которую нельзя исправить универсально.
type SourceConfig = {
  name: string;
  rssUrl: string;
  homepageUrl: string;
  contentSelector?: string;
  // "hearst" — ссылка(и) на подгалерею /photos с несколькими кадрами
  // (Motor Trend, Car and Driver). "wallpaper" — фото-вставки в теле статьи
  // плюс виджет-слайдер .inline-gallery, если он есть. "condenast" (Wired,
  // New Yorker, Pitchfork, GQ, CN Traveler) и "time" — фото-вставки <figure>
  // в теле статьи (см. GALLERY_SITES в src/lib/ogTags.ts). Другие сайты
  // вёрстают галереи иначе (у InsideEVs, например, картинки в теле — это
  // ссылки на другие статьи, а не фото сюжета), включать им
  // эти флаги нельзя без отдельной проверки их разметки.
  gallery?: "hearst" | "wallpaper" | "condenast" | "time";
};

export const SOURCES: SourceConfig[] = [
  {
    name: "The NY Times",
    rssUrl: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    homepageUrl: "https://www.nytimes.com",
  },
  {
    name: "The Washington Post",
    rssUrl: "https://feeds.washingtonpost.com/rss/national",
    homepageUrl: "https://www.washingtonpost.com",
  },
  {
    name: "Wired",
    rssUrl: "https://www.wired.com/feed/rss",
    homepageUrl: "https://www.wired.com",
    gallery: "condenast",
  },
  {
    name: "The Telegraph",
    rssUrl: "https://www.telegraph.co.uk/rss.xml",
    homepageUrl: "https://www.telegraph.co.uk",
  },
  {
    name: "The Verge",
    rssUrl: "https://www.theverge.com/rss/index.xml",
    homepageUrl: "https://www.theverge.com",
  },
  {
    name: "TIME",
    rssUrl: "https://time.com/feed/",
    homepageUrl: "https://time.com",
    gallery: "time",
  },
  {
    name: "The New Yorker",
    rssUrl: "https://www.newyorker.com/feed/everything",
    homepageUrl: "https://www.newyorker.com",
    gallery: "condenast",
  },
  {
    // У nymag.com нет единого RSS на весь сайт — только по разделам.
    // Intelligencer ближе всего к общему новостному профилю бренда.
    name: "NY Magazine",
    rssUrl: "https://feeds.feedburner.com/nymag/intelligencer",
    homepageUrl: "https://nymag.com/intelligencer",
  },
  {
    // RSS отдаёт лишь короткий тизер, но страницы статей не блокируют бота —
    // фильтрованные <p> дают полный текст (правда, вперемешку с навигацией
    // WordPress-шаблона сайта в начале — AI надёжно находит реальный текст
    // дальше, см. NOISE_HANDLING_INSTRUCTIONS в src/lib/prompt.ts).
    name: "9to5Mac",
    rssUrl: "https://9to5mac.com/feed/",
    homepageUrl: "https://9to5mac.com",
  },
  {
    // И RSS-описание, и страница статьи — не блокирует бота, минимум мусора
    // в начале текста (в отличие от 9to5Mac). Проверено на реальной статье.
    name: "TechCrunch",
    rssUrl: "https://techcrunch.com/feed/",
    homepageUrl: "https://techcrunch.com",
  },
  {
    // Страница статьи слишком тяжёлая (~1.6МБ инлайн-CSS) — реальный текст
    // не попадает в 500КБ-лимит fetchHtmlChunk. Но сам RSS кладёт полный
    // чистый текст статьи в нестандартный тег dc:content — используем его
    // напрямую (см. feedContent в fetchAndProcess.ts), без похода на страницу.
    name: "Wallpaper",
    rssUrl: "https://www.wallpaper.com/feeds.xml",
    homepageUrl: "https://www.wallpaper.com",
    gallery: "wallpaper",
  },
  {
    // Полный чистый текст в стандартном content:encoded — используется тот
    // же feedContent-механизм, что и для Wallpaper (см. fetchAndProcess.ts).
    // Проверено на реальной статье: конкретные детали, не общие фразы.
    name: "Lifehacker",
    rssUrl: "https://lifehacker.com/feed/rss",
    homepageUrl: "https://lifehacker.com",
  },
  {
    // Condé Nast (как Wired/New Yorker/Verge) — JSON-LD с полным текстом,
    // страница не блокирует бота. В основном рецензии на музыку.
    name: "Pitchfork",
    rssUrl: "https://pitchfork.com/feed/rss",
    homepageUrl: "https://pitchfork.com",
    gallery: "condenast",
  },
  {
    // Тоже Condé Nast — та же схема, что у Pitchfork/Wired. Стиль, культура,
    // иногда общество; много шопинг-листиклов, но проверенная статья дала
    // конкретные факты, а не общие фразы.
    name: "GQ",
    rssUrl: "https://www.gq.com/feed/rss",
    homepageUrl: "https://www.gq.com",
    gallery: "condenast",
  },
  {
    // Тоже Condé Nast. Путешествия, направления, отели.
    name: "Condé Nast Traveler",
    rssUrl: "https://www.cntraveler.com/feed/rss",
    homepageUrl: "https://www.cntraveler.com",
    gallery: "condenast",
  },
  {
    // WordPress (PMC), не блокирует бота. Страница отдаёт много paywall-
    // заглушек ("Subscribe for full access") ПЕРЕД реальным текстом — но он
    // есть, AI надёжно находит его дальше (проверено на реальной статье:
    // конкретные детали сюжета, не выдумка и не отказ).
    name: "The Hollywood Reporter",
    rssUrl: "https://www.hollywoodreporter.com/feed/",
    homepageUrl: "https://www.hollywoodreporter.com",
  },
  {
    // Ziff Davis (как Lifehacker) — полный чистый текст в content:encoded
    // прямо в RSS, тот же feedContent-механизм. Проверено: обзоры/новости
    // игр с реальными деталями.
    name: "IGN",
    rssUrl: "https://feeds.ign.com/ign/all",
    homepageUrl: "https://www.ign.com",
  },
  {
    // Страница статьи блокирует бота (403), но RSS-описание само по себе
    // достаточно содержательное (как у NYT/Telegraph) — работает на нём.
    name: "GameSpot",
    rssUrl: "https://www.gamespot.com/feeds/mashup/",
    homepageUrl: "https://www.gamespot.com",
  },
  {
    // Hearst, не блокирует бота. Проверено на реальной статье.
    name: "Car and Driver",
    rssUrl: "https://www.caranddriver.com/rss/all.xml/",
    homepageUrl: "https://www.caranddriver.com",
    gallery: "hearst",
  },
  {
    // Тоже Hearst — тот же паттерн, что у Car and Driver.
    name: "Motor Trend",
    rssUrl: "https://www.motortrend.com/rss/all.xml/",
    homepageUrl: "https://www.motortrend.com",
    gallery: "hearst",
  },
  {
    name: "InsideEVs",
    rssUrl: "https://insideevs.com/rss/articles/all/",
    homepageUrl: "https://insideevs.com",
  },
  {
    // Старый feeds.a.dj.com оказался мёртвым (застыл на январе 2025) —
    // рабочий фид сейчас на feeds.content.dowjones.io. Страница платная
    // (401) — работает на тизере из RSS, как NYT/Telegraph.
    name: "The Wall Street Journal",
    rssUrl: "https://feeds.content.dowjones.io/public/rss/RSSWorldNews",
    homepageUrl: "https://www.wsj.com",
  },
  // Financial Times: убран — тизера из RSS оказалось слишком мало для
  // DETAILED_SUMMARY_PROMPT, из-за чего модель либо выдумывала факты
  // (например, "бывший президент" про действующего Трампа), либо обрывала
  // текст на середине слова. Страница при этом платная (403), полный текст
  // недоступен, так что первопричину не исправить без отказа от подробного
  // саммари для этого источника.
  {
    // Единого RSS на весь сайт нет, только по разделам — markets ближе всего
    // к общему профилю издания. Страница платная (403) — работает на тизере.
    name: "Bloomberg",
    rssUrl: "https://feeds.bloomberg.com/markets/news.rss",
    homepageUrl: "https://www.bloomberg.com",
  },
  {
    // Тоже только по разделам — international ближе всего к общему профилю.
    // Еженедельный формат (не каждый день новые статьи, в отличие от
    // остальных источников) — с фильтром "только сегодня" будет давать
    // статьи гораздо реже остальных, это нормально. Страница платная (403).
    name: "The Economist",
    rssUrl: "https://www.economist.com/international/rss.xml",
    homepageUrl: "https://www.economist.com",
  },
  {
    // WordPress, не блокирует бота. Тизер из RSS короткий, но страница отдаёт
    // чистый текст статьи (после обычного минимума меню вначале).
    name: "Kotaku",
    rssUrl: "https://kotaku.com/feed",
    homepageUrl: "https://kotaku.com",
  },
  {
    // Vox Media, как The Verge — не блокирует бота, реальный текст статьи на
    // странице (после блока меню/виджета "AI-саммари" самого Polygon вначале).
    name: "Polygon",
    rssUrl: "https://www.polygon.com/feed/",
    homepageUrl: "https://www.polygon.com",
  },
  {
    // IGN Entertainment (как сам IGN), не блокирует бота. Заметный блок
    // "похожие статьи" вначале страницы перед реальным текстом — тот же
    // паттерн, что и у 9to5Mac/Hollywood Reporter, AI надёжно пропускает его.
    name: "Eurogamer",
    rssUrl: "https://www.eurogamer.net/feed",
    homepageUrl: "https://www.eurogamer.net",
  },
  {
    // WordPress, не блокирует бота. "Read Next" с чужим заголовком и меню
    // перед реальным текстом статьи — AI пропускает как обычный мусор.
    name: "Variety",
    rssUrl: "https://variety.com/feed/",
    homepageUrl: "https://variety.com",
  },
  {
    // Не блокирует бота, страница отдаёт чистый текст статьи почти без
    // мусора в начале. RSS тоже с более длинным description, чем большинство.
    name: "The Guardian",
    rssUrl: "https://www.theguardian.com/world/rss",
    homepageUrl: "https://www.theguardian.com",
  },
  {
    // Не блокирует бота, страница отдаёт чистый текст статьи без мусора в
    // начале — один из самых чистых источников. RSS — world-раздел.
    name: "BBC",
    rssUrl: "https://feeds.bbci.co.uk/news/world/rss.xml",
    homepageUrl: "https://www.bbc.com",
  },
  {
    // WordPress, не блокирует бота. Общий фид сайта — музыка, кино, ТВ,
    // политика.
    name: "Rolling Stone",
    rssUrl: "https://www.rollingstone.com/feed/",
    homepageUrl: "https://www.rollingstone.com",
  },
  // Top Gear: официального публичного RSS не нашлось (проверено ~10
  // стандартных путей — везде 404, автообнаружение на главной тоже пусто).
  // Похоже, его убрали, как и у National Geographic. Если найдёшь рабочую
  // ссылку — добавь сюда.
  // National Geographic: официального публичного RSS не нашлось (проверено
  // ~15 вариантов путей — везде 404, feedburner-домен не резолвится). Похоже,
  // они его убрали. Если найдёшь рабочую ссылку — добавь сюда.
];
