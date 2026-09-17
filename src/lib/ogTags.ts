import * as cheerio from "cheerio";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

// og-теги в <head>, но реальный текст статьи — уже в <body>, поэтому читаем
// заметно больше, чем раньше (когда останавливались на </head>). Всё ещё со
// стримингом и лимитом байт, чтобы не тащить целиком тяжёлые страницы с кучей
// встроенного JS.
async function fetchHtmlChunk(url: string, maxBytes = 500_000): Promise<string> {
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok || !res.body) throw new Error(`Status ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;

  while (bytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    html += decoder.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return html;
}

function extractMetaContent(html: string, name: string): string | undefined {
  // Атрибуты property/content в meta-тегах идут в произвольном порядке —
  // пробуем оба варианта.
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match) return decodeHtmlEntities(match[1]);
  }
  return undefined;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

// Многие сайты (Wired, The New Yorker, The Verge — похоже, общий шаблон у
// Condé Nast/Vox Media) кладут ПОЛНЫЙ чистый текст статьи в JSON-LD-разметку
// (schema.org NewsArticle) — без единого тега и без навигационного мусора.
// Это надёжнее, чем парсить <p>, если поле есть — проверяем в первую очередь.
function extractArticleBodyFromJsonLd(html: string): string | undefined {
  const match = html.match(/"articleBody":"((?:[^"\\]|\\.)*)"/);
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    // Обрезали HTML по лимиту байт посреди JSON-строки — просто пропускаем.
    return undefined;
  }
}

// HTML5 <article> — семантическая разметка самого тела статьи, отдельно от
// шапки/сайдбара/футера сайта (проверено на Eurogamer: единственный <article>
// на странице содержит ровно текст статьи, без общего меню и виджета
// "похожие статьи", которые сидят СНАРУЖИ этого тега). Не универсально: у
// некоторых сайтов (Polygon, 9to5Mac — оба проверены) <article> используется
// ещё и для карточек анонсов в списках похожих статей, поэтому тегов
// несколько и не любой из них — тело текущей статьи. Берём самый длинный по
// сырой разметке (эвристика: карточка-анонс в разы короче полноценной
// статьи) — это не идеально для таких сайтов, но не хуже, чем просто
// игнорировать <article> совсем: extractArticleExcerpt ниже всё равно
// фильтрует результат теми же правилами длины/плотности пробелов, а если
// внутри выбранного блока ничего не прошло фильтр (как для 9to5Mac, где
// самый длинный <article> — это всё равно чужая карточка на пару строк),
// вызывающий код просто откатывается на поиск по всей странице.
function extractLargestArticleScope(html: string): string | undefined {
  const matches = [...html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g)];
  if (matches.length === 0) return undefined;
  return matches.map((m) => m[1]).sort((a, b) => b.length - a.length)[0];
}

// Запасной вариант, если JSON-LD с текстом статьи не нашёлся (напр. TIME,
// WaPo, NYMag). Не для показа пользователю — только как более богатый
// контекст для AI-саммари: RSS/og:description часто дают лишь маркетинговый
// тизер без единого факта (см. README).
//
// Эвристика фильтрации мусора (меню, "Subscribe", хлебные крошки, пустые
// заглушки для комментариев и т.п., которые тоже сидят в <p>):
// 1. Схлопываем повторяющиеся пробелы/переносы в один — в неминифицированной
//    вёрстке пустые блоки-заглушки (напр. "Comment" с horizontal-отступами)
//    раздуты десятками символов чистого whitespace и без этого шага могли бы
//    пройти порог длины, притворяясь содержательным абзацем.
// 2. Настоящая проза — это склеенные без пробелов куски текста в навигации
//    отличаются заметно меньшей плотностью пробелов (проверено на реальных
//    страницах: реальный абзац — ~0.15 пробелов на символ, навигационный
//    мусор — ~0.09).
// 3. Верхний предел длины: почти на каждом сайте (9to5Mac, Eurogamer — оба
//    проверены на реальных страницах) шапка сайта — это ОДИН гигантский <p>
//    на 1400-1750+ символов, куда вёрстка склеивает всё меню и сайдбар
//    "похожие статьи"/"latest news" целиком (теги внутри превращаются в
//    пробелы при снятии разметки, так что по остальным двум фильтрам такой
//    блок выглядит как совершенно нормальный длинный абзац). Настоящие
//    абзацы статьи почти всегда укладываются в 150-700 символов на тех же
//    страницах — граница в 900 отсекает эту "шапку" с запасом, не трогая
//    реальный текст. Без этого фильтра эмбеддинг статьи наполовину состоял
//    из чужих заголовков сайдбара — из-за этого реальные дубли одной новости
//    с разных изданий не долетали до порога похожести, а разные статьи с
//    ОДНОГО издания (общий сайдбар) ложно склеивались между собой.
function extractArticleExcerpt(html: string, maxParagraphs = 10): string | undefined {
  const paragraphs = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gs)]
    .map((m) =>
      decodeHtmlEntities(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()
    )
    .filter((text) => {
      if (text.length < 80 || text.length > 900) return false;
      const spaceRatio = (text.match(/ /g)?.length ?? 0) / text.length;
      return spaceRatio > 0.12;
    })
    .slice(0, maxParagraphs);

  if (paragraphs.length === 0) return undefined;
  return paragraphs.join(" ").slice(0, 4000);
}

// Ручной override на конкретное издание (см. contentSelector в
// src/config/sources.ts) — использует настоящий DOM-парсер (cheerio), а не
// regex-эвристики ниже, поэтому не подвержен их слабым местам (вложенные
// теги, несколько кандидатов на странице и т.п.). Выбирает первый элемент по
// селектору и берёт его текст целиком — источник добавляет это в конфиг,
// только когда уже вручную проверил, что селектор однозначно ведёт к телу
// статьи на этом сайте.
function extractBySelector(html: string, selector: string): string | undefined {
  try {
    const $ = cheerio.load(html);
    const text = $(selector).first().text().replace(/\s+/g, " ").trim();
    return text.length >= 80 ? text.slice(0, 4000) : undefined;
  } catch {
    return undefined;
  }
}

export type OgTags = { description?: string; image?: string; excerpt?: string };

export async function fetchOgTags(url: string, contentSelector?: string): Promise<OgTags> {
  const html = await fetchHtmlChunk(url);
  const articleScope = extractLargestArticleScope(html);
  // Порядок: ручной селектор источника (если задан и сработал) > JSON-LD
  // (самый чистый общий вариант, когда есть) > абзацы внутри <article>
  // (исключает общий сайдбар/меню сайта, если тег размечен как в Eurogamer) >
  // абзацы по всей странице (запасной вариант — для сайтов, где <article>
  // либо отсутствует, либо указывает не туда, см. коммент у
  // extractLargestArticleScope).
  const excerpt =
    (contentSelector && extractBySelector(html, contentSelector)) ??
    extractArticleBodyFromJsonLd(html)?.slice(0, 4000) ??
    (articleScope && extractArticleExcerpt(articleScope)) ??
    extractArticleExcerpt(html);
  return {
    description: extractMetaContent(html, "og:description"),
    image: extractMetaContent(html, "og:image"),
    excerpt,
  };
}
