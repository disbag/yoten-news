import "dotenv/config";
import Parser from "rss-parser";
import { pool, toVectorLiteral } from "../lib/db.js";
import { embed } from "../lib/embeddings.js";
import { summarizeWithFallback } from "../lib/summarizer.js";
import { DETAILED_SUMMARY_PROMPT } from "../lib/prompt.js";
import { fetchOgTags } from "../lib/ogTags.js";
import { findAndAssignGroup } from "../lib/grouping.js";
import { SOURCES } from "../config/sources.js";
import { GeminiQuotaExhaustedError } from "../lib/gemini.js";
import { acquireLock, releaseLock, heartbeat } from "../lib/fetchLock.js";

// dc:content/content:encoded — некоторые издания (Wallpaper — Future plc,
// Lifehacker — Ziff Davis) кладут туда ПОЛНЫЙ, уже чистый текст статьи прямо
// в фид — без похода на саму страницу. Полезно, когда страница слишком
// тяжёлая для fetchHtmlChunk (см. ogTags.ts, лимит 500КБ) и обычное
// извлечение абзацев ничего не находит (так было с Wallpaper). content:encoded
// — стандартный тег из RSS content-модуля, rss-parser его видит, но не
// подставляет в item.content (там короткий item.description) — читаем
// напрямую по ключу, как и нестандартный dc:content.
type FeedItem = { "dc:content"?: string; "content:encoded"?: string };
const parser = new Parser<Record<string, never>, FeedItem>({
  customFields: { item: ["dc:content", "content:encoded"] },
});
const DEDUPE_THRESHOLD = Number(process.env.DEDUPE_THRESHOLD ?? 0.75);
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 7);
// По умолчанию лента показывает только сегодняшние новости — RSS-фиды изданий
// часто отдают материалы за последние несколько дней (особенно если давно не
// забирали). FETCH_SINCE_DAYS=1 расширяет окно до "вчера и сегодня" — удобно
// для разовой докатки после перерыва, без изменения дефолтного поведения.
const FETCH_SINCE_DAYS = Number(process.env.FETCH_SINCE_DAYS ?? 0);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Свободный тариф Gemini ограничивает "-lite" модели 15 запросами в минуту
// НА КЛЮЧ — 4 секунды между запросами держит нас точно на этой границе.
// Раньше пауза была 1с (~60 запросов/мин, вчетверо больше лимита), из-за
// чего каждый ключ мгновенно упирался в 429 и ключи/модели (см. ротацию в
// src/lib/gemini.ts) перебирались почти на каждой статье — само по себе не
// ломалось (429 не считается за фатальную ошибку, пока не исчерпаны все
// ключи и все модели разом), но это шумно и означает, что мы искусственно
// жжём дневную квоту retry'ями быстрее, чем нужно.
const REQUEST_INTERVAL_MS = 4000;

// Wired (и потенциально другие издания) подмешивают в общий RSS свою
// партнёрскую рубрику купонов/промокодов — это не редакционный контент, а
// affiliate-листинги ("50% Off DoorDash Promo Code"), не новости. Отсекаем по
// заголовку до любых сетевых запросов/саммаризации — не тратим на них квоту.
const PROMO_TITLE_PATTERN = /\b(promo codes?|coupons?|discount codes?)\b/i;

// Guardian (и, вероятно, другие издания с тем же форматом) ведёт "live"-блоги
// — одна страница на весь день, куда постоянно дописываются апдейты сразу по
// НЕСКОЛЬКИМ разным темам (реальный случай: заголовок "Victoria police
// officer charged with assault...; embattled builders Bathla given 12-month
// lifeline" — две никак не связанные истории в одном URL). Это не единичный
// инфоповод, а скорее дайджест: наш скрапер честно вытаскивает текст
// страницы, но раз она затрагивает сразу несколько тем, эмбеддинг оказывается
// похож на КАЖДУЮ из них по отдельности — из-за чего live-блог ложно
// склеивался с отдельной статьёй ровно про одну из своих многих тем. Формат
// URL у Guardian стабильный (/live/YYYY/mon/DD/...) — проще и надёжнее
// отсечь такие страницы совсем, чем пытаться разделить их на отдельные
// новости или чинить кластеризацию под этот формат.
const LIVE_BLOG_LINK_PATTERN = /\/live\/\d{4}\/\w{3}\/\d{2}\//;

// Сравниваем по UTC-дате (тот же принцип, что и в getFeed.ts/published_at) —
// само сравнение дат, а не времени, поэтому не зависит от часового пояса
// запуска пайплайна. FETCH_SINCE_DAYS=0 (дефолт) — только сегодня;
// FETCH_SINCE_DAYS=1 — вчера и сегодня, и т.д.
function isWithinFetchWindow(isoDate: string | undefined): boolean {
  if (!isoDate) return false;
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return false;
  const articleDay = parsed.toISOString().slice(0, 10);
  for (let daysAgo = 0; daysAgo <= FETCH_SINCE_DAYS; daysAgo++) {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - daysAgo);
    if (day.toISOString().slice(0, 10) === articleDay) return true;
  }
  return false;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Некоторые издания (напр. Telegraph) блокируют запросы node:http/https по
// TLS-отпечатку, но пропускают fetch() с браузерным User-Agent — поэтому
// забираем текст сами, а не через parser.parseURL().
//
// Ретраи — реальный случай: Variety стабильно проходит через curl (свежий
// DNS-резолв на каждый запрос), но у Node/undici иногда (не всегда — из 5
// подряд попыток упала только 1) ловит ConnectTimeoutError на TLS-хендшейке
// (10с) к их CDN — судя по всему, отдельные edge-ноды у них периодически
// подвисают, а не блокировка/смена доступа. Один короткий повтор перекрывает
// такие разовые сбои, не тратя много времени на источник, который в
// остальном доступен.
async function fetchFeedText(rssUrl: string, attempts = 3): Promise<string> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(rssUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/rss+xml, application/xml, text/xml, */*",
        },
      });
      if (!res.ok) throw new Error(`Status code ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === attempts) throw err;
      await sleep(1000 * attempt);
    }
  }
  throw new Error("unreachable"); // для TypeScript — цикл выше либо вернёт, либо бросит
}

async function processSource(
  source: { id: number; name: string; rss_url: string },
  remaining: { count: number }
) {
  console.log(`→ ${source.name}`);
  // Ручной override контент-селектора для этого издания, если задан в
  // конфиге (см. contentSelector в src/config/sources.ts) — источники
  // синхронизируются в БД через db:init, но сам селектор там не хранится
  // (это dev-time настройка парсинга, не пользовательские данные), поэтому
  // ищем его в конфиге по имени.
  const contentSelector = SOURCES.find((s) => s.name === source.name)?.contentSelector;
  let feed;
  try {
    const xml = await fetchFeedText(source.rss_url);
    feed = await parser.parseString(xml);
  } catch (err) {
    console.error(`  не удалось получить RSS: ${(err as Error).message}`);
    return;
  }

  for (const item of feed.items) {
    heartbeat(); // "я жив и продвигаюсь" — см. src/lib/fetchLock.ts
    if (remaining.count <= 0) {
      console.log(`  лимит статей достигнут, пропускаем остальное`);
      return;
    }
    if (!item.link || !item.title) continue;
    if (PROMO_TITLE_PATTERN.test(item.title)) continue; // партнёрский купон/промокод, не новость
    if (LIVE_BLOG_LINK_PATTERN.test(item.link)) continue; // live-блог на несколько разных тем сразу, не единичная новость
    if (!isWithinFetchWindow(item.isoDate)) continue; // вне окна FETCH_SINCE_DAYS — не берём в ленту

    const exists = await pool.query("SELECT 1 FROM articles WHERE link = $1", [item.link]);
    if (exists.rowCount) continue; // уже обработана раньше

    const rawSummary = item.contentSnippet ?? item.content ?? item.title;
    const feedFullHtml = item["dc:content"] ?? item["content:encoded"];
    const feedContent = feedFullHtml ? stripHtml(feedFullHtml).slice(0, 4000) : undefined;

    // Best-effort: некоторые издания (NYT, Telegraph) блокируют такие запросы
    // (Cloudflare-челлендж / собственная anti-bot защита) — тогда просто
    // остаёмся с сниппетом из RSS и без картинки, без ошибки для всей статьи.
    let fullDescription: string | undefined;
    let imageUrl: string | undefined;
    let excerpt: string | undefined;
    try {
      const og = await fetchOgTags(item.link, contentSelector);
      fullDescription = og.description;
      imageUrl = og.image;
      // Берём более длинный из двух источников контента, а не всегда
      // feedContent — у Wallpaper/Lifehacker/IGN content:encoded из RSS
      // содержит ПОЛНУЮ статью (страница слишком тяжёлая или не отдаёт
      // больше, см. Wallpaper — 1.6МБ, реальный текст был за пределами
      // считанного куска fetchHtmlChunk), но у Polygon (и потенциально
      // других WordPress-изданий) в content:encoded лежит только первый
      // общий абзац на пару сотен символов, а весь остальной текст — уже на
      // самой странице. Раньше жёсткий приоритет feedContent в таком случае
      // резал эмбеддинг до общей фразы без единого специфичного факта — из-за
      // этого две статьи об одном и том же кроссовере Kingdom Hearts x
      // Fortnite (GameSpot и Polygon) не склеились, хотя должны были.
      excerpt =
        (feedContent?.length ?? 0) >= (og.excerpt?.length ?? 0) ? feedContent ?? og.excerpt : og.excerpt;
    } catch {
      // страница недоступна боту — это ожидаемо для части источников
      excerpt = feedContent;
    }

    // Приоритет контекста для саммаризации: реальные абзацы статьи > og:description
    // (часто просто тизер без фактов) > сниппет из RSS — с автоматическим откатом
    // на более простой источник, если модель сигналит NO_CONTENT (см.
    // summarizeWithFallback). excerpt нигде не хранится — только временный
    // контекст для генерации, не для показа пользователю.
    let aiSummary: string;
    let category: string[] | null;
    try {
      ({ summary: aiSummary, category } = await summarizeWithFallback(item.title, {
        excerpt,
        description: fullDescription,
        rawSummary,
      }));
    } catch (err) {
      // Лимиты исчерпаны везде (все ключи, все модели, см. gemini.ts) — дальше
      // пропускать статьи по одной бессмысленно, каждая следующая упрётся в ту
      // же стену. Останавливаем весь пайплайн, а не долбим исчерпанный лимит
      // до конца списка источников.
      if (err instanceof GeminiQuotaExhaustedError) throw err;
      console.error(`  ошибка саммаризации: ${(err as Error).message}`);
      continue;
    }

    // Спортивные новости решили не показывать в ленте вообще — определить
    // это заранее по одному заголовку ненадёжно (в отличие от промокодов),
    // поэтому проверяем уже после того, как модель разметила тему в рамках
    // обычной саммаризации (не отдельный запрос, квота не тратится зря).
    if (category?.includes("sport")) {
      console.log(`  – "${item.title.slice(0, 60)}..." → спорт, пропущена`);
      continue;
    }

    // summarizeWithFallback возвращает title как есть только в одном случае —
    // когда ни один источник контекста (текст статьи, og:description, RSS-
    // сниппет) не дал ни одного факта (см. return title в src/lib/summarizer.ts).
    // На практике это не столько ошибка саммаризации, сколько признак, что
    // самой статьи нет — картинка/карикатура без текста (характерно для
    // рубрики "Daily Cartoon" у The New Yorker) или сплошной live-блог без
    // связного текста. Такое не показываем — это не новость с картинкой, а
    // просто картинка.
    if (aiSummary === item.title) {
      console.log(`  – "${item.title.slice(0, 60)}..." → нет текста статьи, пропущена`);
      continue;
    }

    // Пауза между вызовами под лимит Gemini — см. REQUEST_INTERVAL_MS.
    await sleep(REQUEST_INTERVAL_MS);

    // Подробная версия для модального окна — своими словами, но заметно
    // подробнее короткой. Best-effort: если не получилось, лента всё равно
    // работает на короткой версии. Требует реального текста статьи (excerpt
    // или fullDescription) — на одном тизере из RSS (rawSummary) модель
    // регулярно "дописывала" 5-8 предложений за счёт общих знаний вместо
    // текста (выдуманные цифры, статусы вроде "бывший президент", несуществующие
    // детали) — см. аудит статей NYT/Telegraph/FT/Bloomberg/WSJ. Без реального
    // текста просто оставляем null, а модалка откатывается на короткое summary.
    let aiSummaryLong: string | null = null;
    if (excerpt || fullDescription) {
      try {
        ({ summary: aiSummaryLong } = await summarizeWithFallback(
          item.title,
          { excerpt, description: fullDescription, rawSummary },
          DETAILED_SUMMARY_PROMPT
        ));
        // summarizeWithFallback возвращает title как есть, если ВСЕ источники
        // контекста дали NO_CONTENT (см. коммент у этого случая для aiSummary
        // выше) — для подробной версии это происходит чаще, чем для короткой:
        // тот же контекст, которого хватает на 2-3 честных предложения, может
        // быть недостаточен для 5-8 без домысливания, и модель (следуя
        // NO_FABRICATION_INSTRUCTIONS) вместо этого сдаётся. Без этой проверки
        // необработанный английский заголовок сохранялся в базу как будто это
        // и есть подробное саммари (реальный случай — сразу 5 из 10 статей
        // Polygon). Просто оставляем null — модалка и так корректно
        // откатывается на короткую версию.
        if (aiSummaryLong === item.title) aiSummaryLong = null;
        await sleep(REQUEST_INTERVAL_MS);
      } catch (err) {
        if (err instanceof GeminiQuotaExhaustedError) throw err;
        console.error(`  ошибка подробной саммаризации: ${(err as Error).message}`);
      }
    }

    // Эмбеддим оригинальный текст статьи (excerpt/fullDescription/rawSummary
    // по убыванию качества, тот же приоритет, что и при саммаризации), а не
    // сгенерированное русское саммари. Проверено эмпирически на реальных
    // парах статей: по саммари разрыв между настоящими дублями (0.81-0.88) и
    // разными новостями на одну тему (0.76-0.76) был почти нулевым — короткий
    // пересказ теряет специфику, из-за чего разные новости об одной теме
    // (ИИ, Трамп, Ближний Восток) звучат похоже. По оригинальному тексту
    // разрыв кристально чистый: дубли 0.79-0.85, разные новости 0.53-0.67 —
    // короткое саммари для эмбеддинга больше не используем.
    const embedding = await embed(`${item.title}. ${excerpt ?? fullDescription ?? rawSummary}`);
    const vectorLiteral = toVectorLiteral(embedding);

    // ON CONFLICT DO NOTHING — не только защита от повторной обработки внутри
    // одного прогона (это уже покрыто проверкой exists выше), а именно от
    // гонки МЕЖДУ параллельными прогонами: если случайно запущены два
    // npm run fetch одновременно (реальный случай — один упал с
    // 23505/unique_violation на articles_link_key, когда второй успел
    // вставить ту же ссылку first), без ON CONFLICT это валит весь процесс
    // с необработанным исключением вместо того, чтобы просто пропустить уже
    // занятую кем-то статью.
    const insert = await pool.query(
      `INSERT INTO articles (source_id, title, link, published_at, raw_summary, full_description, image_url, ai_summary, ai_summary_long, category, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector)
       ON CONFLICT (link) DO NOTHING
       RETURNING id`,
      [
        source.id,
        item.title,
        item.link,
        item.isoDate ?? null,
        rawSummary,
        fullDescription ?? null,
        imageUrl ?? null,
        aiSummary,
        aiSummaryLong,
        category,
        vectorLiteral,
      ]
    );
    if (insert.rowCount === 0) continue; // параллельный прогон уже вставил эту ссылку
    const newId = insert.rows[0].id;

    // Тот же инфоповод: строгий порог, короткое окно. Источник может быть
    // любым, включая тот же самый (напр. апдейт той же новости от одного
    // издания) — единственное, что важно, это что статьи описывают одно и то
    // же событие. windowHours фильтрует АНКЕР по его собственному created_at
    // относительно now() (а не относительно новой статьи) — то есть якорь
    // остаётся "открытым" для примагничивания новых статей все windowHours
    // часов после своего создания, при каждом отдельном прогоне фетча. С 48ч
    // получился реальный случай: статья The New Yorker "The Long Doomsday of
    // A.I." (кластер #461) собрала 13 совершенно разных статей за почти сутки
    // (Фукуяма, атаки на судей, архитектура и музыка — просто оказались
    // сравнимо "похожи" на эту конкретную статью по эмбеддингу, хотя тема
    // другая). Сократили окно до 12ч — этого достаточно, чтобы разные издания
    // склеились при отражении одного и того же события в течение дня, но
    // старый якорь перестаёт быть кандидатом для склейки с тем, что появилось
    // на следующий день.
    const { groupId: clusterId, matched: clusterMatched } = await findAndAssignGroup(
      "cluster_id",
      newId,
      vectorLiteral,
      { excludeSourceId: null, windowHours: 12, threshold: DEDUPE_THRESHOLD }
    );

    console.log(
      clusterMatched
        ? `  + "${item.title.slice(0, 60)}..." → склеена с кластером #${clusterId}`
        : `  + "${item.title.slice(0, 60)}..." → новый кластер #${clusterId}`
    );
    remaining.count -= 1;
  }
}

async function cleanupOld() {
  const res = await pool.query(
    `DELETE FROM articles WHERE created_at < now() - interval '${RETENTION_DAYS} days'`
  );
  if (res.rowCount) console.log(`Удалено старых записей: ${res.rowCount}`);
}

async function main() {
  // Проверка на уже запущенный прогон — см. src/lib/fetchLock.ts. Ждёт
  // завершения, если тот прогресс идёт нормально, либо останавливает его и
  // продолжает сама, если он завис (не подавал признаков жизни).
  await acquireLock();
  try {
    const sources = await pool.query("SELECT id, name, rss_url FROM sources");
    const remaining = { count: Number(process.env.FETCH_LIMIT ?? Infinity) };
    for (const source of sources.rows) {
      if (remaining.count <= 0) break;
      await processSource(source, remaining);
    }
    await cleanupOld();
    await pool.end();
  } finally {
    releaseLock();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
