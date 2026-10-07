import type { GallerySite } from "../lib/ogTags.js";

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
  // Фиды других разделов того же издания: у крупных изданий раздел — отдельный
  // фид ("Мир", "Книги", "Путешествия"). В базе у каждого фида своя строка
  // sources с тем же названием; в ленте и в настройках это одно издание.
  extraFeeds?: string[];
  homepageUrl: string;
  contentSelector?: string;
  // "hearst" — ссылка(и) на подгалерею /photos с несколькими кадрами
  // (Motor Trend, Car and Driver). "futureplc" (Wallpaper, Creative Bloq —
  // издатель Future plc, общий движок) — фото-вставки в теле статьи плюс
  // виджет-слайдер .inline-gallery, если он есть. "condenast" (Wired,
  // New Yorker, Pitchfork, GQ, CN Traveler) и "time" — фото-вставки <figure>
  // в теле статьи. "motor1" (InsideEVs, Motor1) — виджет превью фотогалереи статьи
  // "polygon" — фото в теле статьи; "gamespot" — фото из самого RSS (страница
  // закрыта от бота). У остальных — свой тип на каждое издание, по его
  // названию. См. GALLERY_SITES в src/lib/ogTags.ts. Другие сайты
  // вёрстают галереи иначе, включать им эти флаги нельзя без отдельной
  // проверки их разметки.
  gallery?: GallerySite;
  // Текст статьи брать из RSS (dc:content/content:encoded), а не более
  // длинный из RSS и страницы. Для сайтов, где RSS отдаёт статью целиком и
  // чисто, а парсер страницы захватывает лишнее — у Future plc это дисклеймер
  // о партнёрских ссылках, биография автора и служебное сообщение
  // комментариев, которые иначе попадали в текст для модели и могли
  // просочиться в подробности под катом.
  preferFeedContent?: boolean;
  // Заголовки рекламных постов со скидками (подборки Amazon-скидок, Prime Day,
  // промо с кодом скидки) — такие статьи не берём в ленту вообще. Своё для
  // каждого издания: общий фильтр по слову "deal" резал бы и новости вроде
  // "Trump Revives Iran Deal Hopes" (Bloomberg). Сюда — только то, чего нет
  // в общем фильтре для всех изданий (src/lib/adFilter.ts): он уже ловит
  // Prime Day, "N% off", "$N off", "Save $N", купоны и шопинг-разделы.
  adTitlePattern?: RegExp;
  // То же по пути ссылки (без query) — у многих изданий рекламные посты
  // узнаются по адресу надёжнее, чем по заголовку: "…-deal-september-2026",
  // "…-deal-sale", раздел /ad/. Тоже своё для каждого издания.
  adLinkPattern?: RegExp;
  // Рубрики пункта RSS (<category>), с которыми статья в ленту не берётся:
  // рассылки-дайджесты сразу на несколько тем, оплаченные и партнёрские
  // материалы. Надёжнее заголовка — у таких постов он обычный.
  skipCategoryPattern?: RegExp;
  // Служебный хвост, который издание дописывает к тексту статьи в RSS
  // (призыв оформить подписку, блок "что почитать ещё") — срезается с конца
  // текста, чтобы не попадал ни в эмбеддинг, ни в пересказ. Стандартную
  // строку WordPress "The post … appeared first on …" срезает сам фетч.
  feedFooterPattern?: RegExp;
  // Отрезать от ссылок из фида всё после "?" — когда издание дописывает к
  // ним рекламные метки (utm_…), а сама статья открывается и без них.
  stripLinkQuery?: boolean;
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
    // Рекламные посты всегда оканчиваются на "-deal-sale". Просто слово
    // "deal" в адресе для The Verge не годится — он часто пишет о сделках
    // компаний ("…-activision-deal-…").
    adLinkPattern: /-deal-sale(?:\/|$)/i,
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
    // Future plc: RSS кладёт полный чистый текст статьи в нестандартный тег
    // dc:content — берём его (preferFeedContent), со страницы — только
    // картинки галереи (страница ~1-1.6МБ, фото в теле идут ближе к концу).
    name: "Wallpaper",
    rssUrl: "https://www.wallpaper.com/feeds.xml",
    homepageUrl: "https://www.wallpaper.com",
    gallery: "futureplc",
    preferFeedContent: true,
  },
  {
    // Тот же движок Future plc, что у Wallpaper: полный текст в dc:content
    // (проверено на 6 статьях — совпадает с телом статьи на странице, без
    // меню и подписок), фото тела статьи — галерея; товарные виджеты в
    // подборках лежат отдельными блоками и в галерею не попадают. Дизайн,
    // реклама, иллюстрация, 3D, креативная техника.
    name: "Creative Bloq",
    rssUrl: "https://www.creativebloq.com/feeds.xml",
    homepageUrl: "https://www.creativebloq.com",
    gallery: "futureplc",
    preferFeedContent: true,
    // Сверх общего фильтра: любые "deals" (только во множественном: "a deal
    // with …" бывает и новостью), "all-time low", "lowest price", "price drop"
    // — у издания о дизайне это всегда про товар, а не про рынки.
    adTitlePattern: /\b(?:deals|all-time low|lowest price|price drop)\b/i,
  },
  {
    // Полный чистый текст в стандартном content:encoded — используется тот
    // же feedContent-механизм, что и для Wallpaper (см. fetchAndProcess.ts).
    // Проверено на реальной статье: конкретные детали, не общие фразы.
    name: "Lifehacker",
    rssUrl: "https://lifehacker.com/feed/rss",
    homepageUrl: "https://lifehacker.com",
    // Около трети фида — "This … Is $180 Off Right Now" с адресом
    // "…-sale-september-2026"/"…-deal-…". "deal-with" — это "how to deal
    // with…", не реклама. Оплаченный раздел /ad/ ловит общий фильтр.
    adLinkPattern: /(?:^|[-/])(?:sales?|deals?)(?=[-/]|$)(?!-with)/i,
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
    // "…-deal-september-2026", "best-deals-for-…", "…-sale-…",
    // "…-new-low-price-at-amazon". Проверено на неделе статей: ни одной
    // обычной новости под шаблон не попало.
    adLinkPattern: /(?:^|[-/])(?:sales?|deals?)(?=[-/]|$)(?!-with)|low-price/i,
  },
  {
    // Страница статьи закрыта Cloudflare-проверкой от ботов (403), но RSS
    // сам несёт текст статьи и её фото в <description> — и текст, и галерея
    // берутся из него.
    name: "GameSpot",
    rssUrl: "https://www.gamespot.com/feeds/mashup/",
    homepageUrl: "https://www.gamespot.com",
    gallery: "gamespot",
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
    gallery: "motor1",
  },
  {
    // Та же сеть, что InsideEVs: RSS отдаёт только короткий анонс, полный
    // текст — в JSON-LD страницы (не блокирует бота; блок "More From …" с
    // чужими заголовками вырезается, см. stripLinkListLines в ogTags.ts).
    // Галерея — виджет превью фотогалереи статьи, есть у большинства новостей.
    name: "Motor1",
    rssUrl: "https://www.motor1.com/rss/articles/all/",
    homepageUrl: "https://www.motor1.com",
    gallery: "motor1",
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
  // подробного пересказа, из-за чего модель либо выдумывала факты
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
    gallery: "polygon",
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
    // WordPress (PMC), не блокирует бота. В JSON-LD страницы лежит не статья,
    // а обрезанный анонс на 300-400 знаков с "[…]" в конце — общий каскад
    // брал его и до полного текста не доходил: саммари выходили короткими и
    // без продолжения "Читать" у всех статей. Тело статьи — в блоке
    // .vy-cx-page-content (3-12 тыс. знаков, проверено на новости, заметке
    // и рецензии).
    name: "Variety",
    rssUrl: "https://variety.com/feed/",
    homepageUrl: "https://variety.com",
    contentSelector: ".vy-cx-page-content",
  },
  {
    // Не блокирует бота, страница отдаёт чистый текст статьи почти без
    // мусора в начале. RSS тоже с более длинным description, чем большинство.
    // Основной фид — раздел "Мир" (политика, происшествия); искусство и
    // дизайн, книги и путешествия — отдельными фидами.
    name: "The Guardian",
    rssUrl: "https://www.theguardian.com/world/rss",
    extraFeeds: [
      "https://www.theguardian.com/artanddesign/rss",
      "https://www.theguardian.com/books/rss",
      "https://www.theguardian.com/travel/rss",
    ],
    homepageUrl: "https://www.theguardian.com",
    gallery: "guardian",
  },
  {
    // Не блокирует бота, страница отдаёт чистый текст статьи без мусора в
    // начале — один из самых чистых источников. Основной фид — world-раздел
    // новостей; "Культура" и "Путешествия" — длинные очерки с bbc.com, около
    // статьи в день в каждом.
    name: "BBC",
    rssUrl: "https://feeds.bbci.co.uk/news/world/rss.xml",
    extraFeeds: ["https://www.bbc.com/culture/feed.rss", "https://www.bbc.com/travel/feed.rss"],
    homepageUrl: "https://www.bbc.com",
  },
  {
    // WordPress, не блокирует бота. Общий фид сайта — музыка, кино, ТВ,
    // политика.
    name: "Rolling Stone",
    rssUrl: "https://www.rollingstone.com/feed/",
    homepageUrl: "https://www.rollingstone.com",
  },
  {
    // Архитектура и дизайн. Полный чистый текст статьи в content:encoded;
    // страница длиннее только за счёт блоков "похожие проекты" и подписки —
    // берём текст из фида. Не блокирует бота.
    name: "Dezeen",
    rssUrl: "https://www.dezeen.com/feed/",
    homepageUrl: "https://www.dezeen.com",
    gallery: "dezeen",
    preferFeedContent: true,
  },
  {
    // Дизайн, архитектура, искусство (Италия, пишет по-английски). Полный
    // текст в content:encoded, как у Dezeen. Рекламные подборки собственного
    // магазина выходят как "designboom shop drop: …".
    name: "designboom",
    rssUrl: "https://www.designboom.com/feed/",
    homepageUrl: "https://www.designboom.com",
    gallery: "designboom",
    preferFeedContent: true,
    adTitlePattern: /\bshop drop\b/i,
  },
  {
    // Арт-рынок, музеи, выставки, аукционы. В RSS только заголовок, текст —
    // со страницы (не блокирует бота, ~3,5 тыс. знаков).
    name: "The Art Newspaper",
    rssUrl: "https://www.theartnewspaper.com/rss.xml",
    homepageUrl: "https://www.theartnewspaper.com",
    gallery: "artnewspaper",
  },
  {
    // Города, дизайн, международная повестка. Полный текст в content:encoded,
    // около двух материалов в день. Викторина для читателей с призами ("Are
    // you one of Monocle's brightest sparks?") — не новость.
    name: "Monocle",
    rssUrl: "https://monocle.com/feed/",
    homepageUrl: "https://monocle.com",
    gallery: "monocle",
    preferFeedContent: true,
    adTitlePattern: /\bbrightest sparks\b|\bmonocle quiz\b/i,
  },
  {
    // Графический дизайн и иллюстрация. Фид на FeedBurner (собственный /rss
    // сайта отдаёт битый XML), в нём только анонс — текст со страницы.
    name: "It's Nice That",
    rssUrl: "https://feeds2.feedburner.com/itsnicethat/SlXC",
    homepageUrl: "https://www.itsnicethat.com",
    gallery: "itsnicethat",
  },
  {
    // Наука: физика, космос, биология, климат. Официальный фид платформы
    // (старый rss.sciam.com по https не отвечает). В RSS анонс, статья
    // целиком в JSON-LD страницы. robots.txt просит crawl-delay 5 с — при
    // ~5 материалах в день и саммаризации между статьями это соблюдается
    // само собой.
    name: "Scientific American",
    rssUrl: "https://www.scientificamerican.com/platform/syndication/rss/",
    homepageUrl: "https://www.scientificamerican.com",
  },
  {
    // Hearst, как Car and Driver. Около половины фида — подборки покупок
    // ("The 8 Best Space Heaters…", "Solo Stove vs. Breeo…", Prime Day):
    // разделы /home/, /adventure/, /culture/ целиком торговые, галереи /g…/ —
    // всегда списки товаров. Новости — в /science/, /military/, /technology/.
    name: "Popular Mechanics",
    rssUrl: "https://www.popularmechanics.com/rss/all.xml/",
    homepageUrl: "https://www.popularmechanics.com",
    adLinkPattern:
      /^\/(?:home|adventure|culture|video)\/|\/g\d+\/|(?:^|[-/])(?:sales?|deals?)(?=[-/]|$)(?!-with)/i,
    adTitlePattern: /\b(?:best|deals?|gifts?)\b|\bvs\.?\s|\breview\b|\bsav(?:e|ing) up to\b/i,
  },
  {
    // Hearst. Политика, кино и сериалы, стиль. Около трети фида — шопинг:
    // раздел /style/ (одежда, часы, парфюм), техника в /lifestyle/tech/,
    // подарочные галереи /g…/ и Prime Day.
    name: "Esquire",
    rssUrl: "https://www.esquire.com/rss/all.xml/",
    homepageUrl: "https://www.esquire.com",
    adLinkPattern:
      /^\/style\/|^\/lifestyle\/tech\/|\/g\d+\/|(?:^|[-/])(?:sales?|deals?)(?=[-/]|$)(?!-with)/i,
    adTitlePattern: /\b(?:best|deals?|gifts?)\b/i,
  },
  {
    // Люкс: часы, авто, яхты, алкоголь, знаменитости. Полный текст в
    // content:encoded. "Maxim Models Competition" — промо их конкурса моделей.
    name: "Maxim",
    rssUrl: "https://www.maxim.com/feed/",
    homepageUrl: "https://www.maxim.com",
    gallery: "maxim",
    preferFeedContent: true,
    adTitlePattern: /\bmaxim models\b/i,
  },
  {
    // Графический дизайн, иллюстрация, брендинг (Великобритания). Полный
    // чистый текст в content:encoded; страница добавляет в начало рекламу
    // своего сообщества — берём текст из фида.
    name: "Creative Boom",
    rssUrl: "https://www.creativeboom.com/feed/",
    homepageUrl: "https://www.creativeboom.com",
    gallery: "creativeboom",
    preferFeedContent: true,
  },
  {
    // Новости искусства: выставки, музеи, арт-рынок (США, Ghost). Полный
    // текст в content:encoded; страница дописывает призыв завести аккаунт.
    // В том же фиде идут ежедневная и еженедельная рассылки (дайджест сразу
    // по нескольким статьям) и оплаченные объявления — их узнаём по рубрике.
    name: "Hyperallergic",
    rssUrl: "https://hyperallergic.com/rss/",
    homepageUrl: "https://hyperallergic.com",
    gallery: "hyperallergic",
    preferFeedContent: true,
    skipCategoryPattern: /\b(?:newsletter|sponsored|announcement|opportunities)\b/i,
  },
  {
    // Современное искусство, иллюстрация, фотография (США). Полный текст в
    // content:encoded, в конце каждого — призыв стать подписчиком.
    name: "Colossal",
    rssUrl: "https://www.thisiscolossal.com/feed/",
    homepageUrl: "https://www.thisiscolossal.com",
    gallery: "colossal",
    preferFeedContent: true,
    feedFooterPattern: /\s*Do stories and artists like this matter to you\?[\s\S]*$/i,
  },
  {
    // Интерьеры, мебель, архитектура, искусство (США). Полный чистый текст в
    // content:encoded; страница добавляет биографию автора и анонсы других
    // статей. Оплаченные материалы помечены рубрикой "Sponsor"/"sponsored".
    name: "Design Milk",
    rssUrl: "https://design-milk.com/feed/",
    homepageUrl: "https://design-milk.com",
    gallery: "designmilk",
    preferFeedContent: true,
    skipCategoryPattern: /^sponsor(?:ed)?$/i,
  },
  {
    // Новости архитектуры Австралии: конкурсы, проекты, градостроительство.
    // В RSS только анонс, текст — со страницы: абзацы прямо в #project (в нём
    // же лежат подписи к фото, реклама и "View gallery", а общий разбор
    // страницы цеплял ещё и анонсы соседних статей из блока "ещё по теме").
    name: "ArchitectureAU",
    rssUrl: "https://architectureau.com/rss.xml",
    homepageUrl: "https://architectureau.com",
    contentSelector: "#project > p",
    gallery: "architectureau",
  },
  {
    // Промышленный и предметный дизайн, выставки, интервью (Италия, пишет
    // по-английски). В RSS только анонс, текст — со страницы: абзацы статьи
    // без блока об авторе, который общий разбор захватывал в конец текста.
    name: "DesignWanted",
    rssUrl: "https://designwanted.com/feed/",
    homepageUrl: "https://designwanted.com",
    contentSelector: ".col-center > .container > p",
    gallery: "designwanted",
  },
  {
    // Раздел Co.Design: ребрендинги, дизайн продуктов, городов и интерфейсов
    // (США). Полный текст — в description фида; страницы статей временами
    // закрыты от бота (DataDome), тогда пересказ строится по тексту из фида.
    // К ссылкам в фиде дописаны метки ?partner=rss&utm_…
    name: "Fast Company",
    rssUrl: "https://www.fastcompany.com/co-design/rss",
    homepageUrl: "https://www.fastcompany.com/co-design",
    gallery: "fastcompany",
    stripLinkQuery: true,
  },
  {
    // Айдентика, типографика, упаковка, веб-дизайн: короткие заметки о
    // проектах студий (США/Бразилия). В RSS только обложка, текст — со
    // страницы; общий разбор добавлял к нему подпись из подвала сайта.
    name: "Abduzeedo",
    rssUrl: "https://abduzeedo.com/rss.xml",
    homepageUrl: "https://abduzeedo.com",
    contentSelector: ".article-body",
    gallery: "abduzeedo",
  },
  // Top Gear: официального публичного RSS не нашлось (проверено ~10
  // стандартных путей — везде 404, автообнаружение на главной тоже пусто).
  // Похоже, его убрали, как и у National Geographic. Если найдёшь рабочую
  // ссылку — добавь сюда.
  // National Geographic: официального публичного RSS не нашлось (проверено
  // ~15 вариантов путей — везде 404, feedburner-домен не резолвится). Похоже,
  // они его убрали. Если найдёшь рабочую ссылку — добавь сюда.
];
