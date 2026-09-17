import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";

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

// Раньше вся эта логика была на regex по сырой HTML-строке — оказалось
// принципиально ненадёжно на реальных страницах: если где-то на странице
// встречается незакрытый/невалидно вложенный тег (частый случай в реальной
// вёрстке — сами браузеры и cheerio молча "чинят" это по правилам HTML5, а
// regex нет), совпадение может "съехать" и просто пропустить настоящий текст
// статьи, подставив вместо него мусор из другого места страницы. Конкретный
// случай: TIME100 Art — <p> с реальным текстом статьи никак не находился
// через regex `<p[^>]*>(.*?)<\/p>`, хотя текст был на странице (видно в
// браузере) — cheerio находит его с первого раза. Теперь везде работаем
// через нормальное дерево DOM.
function extractMetaContent($: CheerioAPI, name: string): string | undefined {
  const content =
    $(`meta[property="${name}"]`).attr("content") ?? $(`meta[name="${name}"]`).attr("content");
  return content?.trim() || undefined;
}

// Многие сайты (Wired, The New Yorker, The Verge — похоже, общий шаблон у
// Condé Nast/Vox Media) кладут ПОЛНЫЙ чистый текст статьи в JSON-LD-разметку
// (schema.org NewsArticle) — без единого тега и без навигационного мусора.
// Это надёжнее, чем парсить <p>, если поле есть — проверяем в первую очередь.
// На странице может быть несколько <script type="application/ld+json">
// (часто ещё Organization/BreadcrumbList рядом с NewsArticle) — проверяем
// все, берём первый, где реально нашлось articleBody.
function extractArticleBodyFromJsonLd($: CheerioAPI): string | undefined {
  const scripts = $('script[type="application/ld+json"]').toArray();
  for (const el of scripts) {
    const raw = $(el).contents().text();
    try {
      const parsed = JSON.parse(raw);
      const candidates = Array.isArray(parsed) ? parsed : [parsed, ...(parsed?.["@graph"] ?? [])];
      for (const node of candidates) {
        if (typeof node?.articleBody === "string" && node.articleBody.trim()) {
          return node.articleBody;
        }
      }
    } catch {
      // Не валидный/обрезанный по лимиту байт JSON — пропускаем этот блок.
    }
  }
  return undefined;
}

// HTML5 <article> — семантическая разметка самого тела статьи, отдельно от
// шапки/сайдбара/футера сайта (проверено на Eurogamer: единственный <article>
// на странице содержит ровно текст статьи, без общего меню и виджета
// "похожие статьи", которые сидят СНАРУЖИ этого тега). Не универсально: у
// некоторых сайтов (Polygon, 9to5Mac — оба проверены) <article> используется
// ещё и для карточек анонсов в списках похожих статей, поэтому тегов
// несколько и не любой из них — тело текущей статьи. Берём самый длинный по
// видимому тексту (эвристика: карточка-анонс в разы короче полноценной
// статьи) — это не идеально для таких сайтов, но не хуже, чем просто
// игнорировать <article> совсем: extractParagraphs ниже всё равно фильтрует
// результат теми же правилами длины/плотности пробелов, а если внутри
// выбранного блока ничего не прошло фильтр (как для 9to5Mac, где самый
// длинный <article> — это всё равно чужая карточка на пару строк), вызывающий
// код просто откатывается на поиск по всей странице.
function findLargestArticleScope($: CheerioAPI): Cheerio<AnyNode> | undefined {
  const articles = $("article").toArray();
  if (articles.length === 0) return undefined;
  const largest = articles
    .map((el) => $(el))
    .sort((a, b) => b.text().length - a.text().length)[0];
  return largest;
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
// Раньше здесь был ещё и верхний предел длины (900 символов) — вводился
// против "гигантских" <p> на 1400-1750+ символов, куда якобы вёрстка склеивала
// целиком меню и сайдбар. Убрали: то был артефакт СТАРОГО regex-парсинга
// (`html.matchAll(/<p[^>]*>(.*?)<\/p>/gs)`), а не реальная структура HTML —
// он "терял синхронизацию" на невалидно вложенных/незакрытых тегах где-то на
// странице и склеивал в один фиктивный "абзац" куски совершенно разных
// участков документа. С переходом на cheerio (настоящий DOM-парсер, разбирает
// вложенность по правилам HTML5) такого блока не находится ни на одном из
// проверенных сайтов — а лимит при этом резал настоящие длинные абзацы (TIME
// — 1245 символов, Polygon — 952), из-за чего для части статей терялся весь
// реальный текст.
function extractParagraphs(
  $: CheerioAPI,
  scope: Cheerio<AnyNode> | undefined,
  maxParagraphs = 10
): string | undefined {
  const paragraphs = (scope ? scope.find("p") : $("p"))
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, " ").trim())
    .filter((text) => {
      if (text.length < 80) return false;
      const spaceRatio = (text.match(/ /g)?.length ?? 0) / text.length;
      return spaceRatio > 0.12;
    })
    .slice(0, maxParagraphs);

  if (paragraphs.length === 0) return undefined;
  return paragraphs.join(" ").slice(0, 4000);
}

// Ручной override на конкретное издание (см. contentSelector в
// src/config/sources.ts) — источник добавляет это в конфиг, только когда уже
// вручную проверил, что селектор однозначно ведёт к телу статьи на этом
// сайте.
function extractBySelector($: CheerioAPI, selector: string): string | undefined {
  try {
    const text = $(selector).first().text().replace(/\s+/g, " ").trim();
    return text.length >= 80 ? text.slice(0, 4000) : undefined;
  } catch {
    return undefined;
  }
}

export type OgTags = { description?: string; image?: string; excerpt?: string };

export async function fetchOgTags(url: string, contentSelector?: string): Promise<OgTags> {
  const html = await fetchHtmlChunk(url);
  const $ = cheerio.load(html);
  const articleScope = findLargestArticleScope($);
  // Порядок: ручной селектор источника (если задан и сработал) > JSON-LD
  // (самый чистый общий вариант, когда есть) > абзацы внутри <article>
  // (исключает общий сайдбар/меню сайта, если тег размечен как в Eurogamer) >
  // абзацы по всей странице (запасной вариант — для сайтов, где <article>
  // либо отсутствует, либо указывает не туда, см. коммент у
  // findLargestArticleScope).
  const excerpt =
    (contentSelector && extractBySelector($, contentSelector)) ??
    extractArticleBodyFromJsonLd($)?.slice(0, 4000) ??
    (articleScope && extractParagraphs($, articleScope)) ??
    extractParagraphs($, undefined);
  return {
    description: extractMetaContent($, "og:description"),
    image: extractMetaContent($, "og:image"),
    excerpt,
  };
}
