import { pool } from "./db.js";
import { summarize, GeminiQuotaExhaustedError } from "./gemini.js";
import { ensureImageHashes } from "./imageHash.js";

// Треды (DIS-36) — уровень над склейкой дублей: карточки об одной истории,
// её развитии или об одном информационном поводе (несколько версий систем
// Apple в один день). Решения пишутся в thread_posts при каждом прогоне сбора;
// показывает их лента с тредами (THREADS_VIEW в src/lib/feed.ts — на рабочем
// сайте включена 18 октября 2026).
//
// Как решается, что карточка — продолжение треда:
// 1. Кандидаты — карточки последних CANDIDATE_WINDOW_HOURS с похожим
//    заголовком (по векторам заголовков, порог CANDIDATE_TITLE_THRESHOLD).
//    Порог мягкий: по выборке 16 октября при сходстве заголовков 0,60–0,65
//    одна история только в половине пар — отбор окончательно делает модель.
//    Если тредов по заголовку меньше трёх, добавляются треды карточек с тем же
//    редким именем в пересказе: пять статей о нападении на депутата Хелен
//    Хейнс (20 октября) не нашли друг друга — «водитель задержан», «парикмахер
//    помог», «призывы снизить напряжённость», сходство заголовков 0,21.
//    Материалы об одном выходе фильма, игры или устройства (рецензии разных
//    изданий, интервью, места съёмок, саундтрек) — один тред: так решил
//    пользователь 16 октября по тредам «Разум и чувства», «Аватар: Семь
//    гаваней», Castlevania и «La Bola Negra». Гайды и подборки — нет.
//    Ежедневные рыночные сводки (Bloomberg: «медь падает третий день» и
//    «металлы отскакивают», нефтяные сводки за 15 и 16 октября) — тоже нет,
//    если у них нет общего конкретного события. Тред о поездке Зеленского в
//    Брюссель (16 октября) за три дня оброс другими новостями вокруг
//    Зеленского и Трампа — ограничение разведданных США, сделки Трампа с
//    Россией, колонка Rolling Stone; пользователь 20 октября их убрал: тред —
//    одно событие и его прямые последствия, а не всё вокруг одного человека.
//    Новости о госдолге и рынке
//    облигаций страны — не в треде о её протестах или политическом кризисе:
//    19 октября пользователь убрал из треда о беспорядках во Франции «France’s
//    Bonds Drop as Rioting…», «The French Political Crisis That's Turning Into
//    a Debt Crisis» (Bloomberg) и «French Contagion Less Virulent…» (WSJ).
// 2. Модель получает новую карточку и до MAX_CANDIDATE_THREADS тредов-
//    кандидатов (тред — это и одиночная карточка, к которой ещё никто не
//    присоединился) и отвечает, к какому треду она относится, и что в ней
//    нового по сравнению с тредом. Это «новое» и показывается в треде вместо
//    полного пересказа.
// 3. Тред, в который добавилась карточка, сверяется с похожими тредами (см.
//    mergeDuplicates): если модель считает их одной историей, они сливаются.
//    Иначе однажды разошедшиеся треды так и шли бы отдельно: к 18 октября по
//    два треда было у фильмов «Whalefall» и Street Fighter и у Apple HomeView.
//    Просьба назвать в ответе несколько тредов сразу не сработала: при выборе
//    треда для новой карточки модель всегда называла один.

const CANDIDATE_WINDOW_HOURS = 72;
const CANDIDATE_TITLE_THRESHOLD = 0.55;
// Карточка старше суток — кандидат только при сходстве заголовков или текстов
// не ниже OLD_CANDIDATE_THRESHOLD. Реальный случай 16 октября: статья NYT
// «Trump Squeezes Ukraine, Again» (13.10) попала в один тред с двумя
// репортажами BBC о Зеленском в Брюсселе (16.10) — общий фон, но разные
// события. Заголовки у всех трёх похожи одинаково (0,56–0,58), а тексты BBC
// между собой — 0,72, с NYT — 0,53, и между ними 60 часов.
const OLD_CANDIDATE_HOURS = 24;
const OLD_CANDIDATE_THRESHOLD = 0.65;
const MAX_CANDIDATES = 8;
const MAX_CANDIDATE_THREADS = 3;
// Сколько постов треда показывать модели — длинный тред не должен раздувать
// запрос. Первая карточка показывается всегда: у остальных в треде только
// короткое «что нового», и без начала модель не видела, о чём тред.
const MAX_POSTS_IN_PROMPT = 4;
// Пауза между запросами — тот же лимит Gemini, что и при сборе
// (REQUEST_INTERVAL_MS в fetchAndProcess.ts).
const REQUEST_INTERVAL_MS = 4000;
// Сколько кадров галереи одной карточки считать для отпечатков.
const MAX_FRAMES_PER_CARD = 8;
// Похожие треды для сверки: в обоих есть карточки не дальше 72 часов друг от
// друга со сходством заголовков не ниже MERGE_TITLE_THRESHOLD. По выборке 18
// октября при 0,62 и выше попадались все известные дубли (0,63–0,74), а
// разные истории отсеивала модель.
const MERGE_TITLE_THRESHOLD = 0.62;
// Кандидаты по общему имени (см. nameCandidates): имя из двух и больше слов с
// заглавной буквы в пересказе, которое за окно встречается не больше чем в
// MAX_NAME_CARDS карточках, — у частых имён (Трамп, Макрон) и так хватает
// кандидатов по заголовку.
const MAX_NAME_CARDS = 6;
const NAME_PATTERN = /[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?(?:\s+[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)+/g;
// Первое слово с окончанием прилагательного — география, а не имя: «Ближнем
// Востоке», «Северной Америке», «Южной Корее».
const ADJECTIVE_ENDING = /(?:ой|ей|ий|ый|ая|яя|ом|ем|ых|их|ую|юю|ое|ее)$/;
const MAX_MERGE_CHECKS = 3;

const THREAD_DEFINITION = `Тред — это одна история: одно событие, его продолжение и развитие (новые подробности, реакции, последствия, следующий этап) или один информационный повод (например, в один день вышли новые версии нескольких систем одной компании).`;

const THREAD_RULES = `НЕ относи новость к треду, если общее только у темы или фона, а события разные: одна компания, один человек, одна игра, одна страна, одна отрасль или один затяжной конфликт (война, отношения двух политиков) — ещё не одна история. Для одной истории нужен конкретный общий повод: то же событие, заявление, решение, встреча, сделка или происшествие. Сравнивай новость прежде всего с первой новостью треда: новая должна быть о том же событии или его прямом последствии (реакция на это событие, его результат, следующий шаг). Другое заявление, решение или действие того же человека или правительства — уже другая история, даже если оно о той же войне или тех же отношениях; аналитика и комментарии о политике человека или отношениях стран в целом — тоже не продолжение конкретного события. Выход фильма, сериала, игры или устройства — тоже один повод: рецензии разных изданий, интервью с создателями, рассказы о съёмках, новости о премьере, наградах и саундтреке одной картины относи к одному треду. Не относи к треду гайды, прохождения и советы по игре, а также подборки и списки. Ежедневные рыночные сводки (движение акций, валют, нефти, металлов за день) — разные истории, даже если рынок тот же и даже если обе объясняют движение одной причиной (данные по инфляции, заявление чиновника, общий обвал отрасли): реакция разных рынков или одного рынка в разные дни — не продолжение друг друга. Объединяй рыночные новости, только если обе — о самом событии (сделка, IPO, банкротство, решение регулятора по конкретной стране или компании), а не о движении цен. Новости о рынках и госдолге страны (облигации, доходности, риск долгового кризиса, «заражение» соседних стран) — отдельная история от самих протестов, беспорядков, войны или политического кризиса, даже если рынок реагирует именно на них: не относи такую новость к треду о самом событии и не объединяй такие треды. В скобках у каждой новости — дата: материалы, разделённые несколькими днями, относи к одному треду, только если новая прямо продолжает тот же повод.`;

export const THREAD_PROMPT = `Ты — редактор новостной ленты. Тебе дают НОВУЮ новость и пронумерованный список тредов. ${THREAD_DEFINITION}

${THREAD_RULES}

Ответь строго двумя строками, без пояснений:
ТРЕД: номер подходящего треда из списка или 0, если новость не продолжает ни один
НОВОЕ: если ТРЕД не 0 — 1–3 предложения на русском только с фактами новой новости, которых ещё нет в треде: без повторов уже сказанного, без вводных слов, без «также сообщается». Если нового нет или ТРЕД 0 — напиши «нет».`;

// Сверка двух тредов (см. mergeDuplicates) — те же правила, что при выборе
// треда для новой карточки.
export const MERGE_PROMPT = `Ты — редактор новостной ленты. Тебе дают два треда новостей. ${THREAD_DEFINITION} Реши, рассказывают ли оба треда одну и ту же историю, то есть их надо объединить в один. Правила те же, что для отнесения новости к треду:

${THREAD_RULES}

Ответь строго одним словом: ДА или НЕТ.`;

type CardText = { clusterId: number; title: string; summary: string; more: string | null; createdAt: Date };

// Заголовок первой статьи карточки и пересказ — той же парой, что в ленте
// (главное и продолжение с одной статьи, предпочтительно с продолжением).
async function loadCards(clusterIds: number[]): Promise<Map<number, CardText>> {
  if (!clusterIds.length) return new Map();
  const { rows } = await pool.query(
    `SELECT a.cluster_id,
       (array_agg(a.title ORDER BY a.created_at))[1] AS title,
       (array_agg(a.ai_summary ORDER BY a.ai_summary_more IS NULL, a.created_at))[1] AS summary,
       (array_agg(a.ai_summary_more ORDER BY a.ai_summary_more IS NULL, a.created_at))[1] AS more,
       min(a.created_at) AS created_at
     FROM articles a WHERE a.cluster_id = ANY($1) AND a.ai_summary IS NOT NULL
     GROUP BY a.cluster_id`,
    [clusterIds]
  );
  return new Map(
    rows.map((r) => [r.cluster_id, { clusterId: r.cluster_id, title: r.title, summary: r.summary, more: r.more, createdAt: r.created_at }])
  );
}

type Candidate = { threadId: number | null; clusterIds: number[]; similarity: number };

// Гайды не продолжают историю, а промпт их не всегда отсекает: «How to get
// the DLC weapons in Fire Emblem» модель присоединила к новости о DLC. Такие
// карточки в треды не берём — ни новыми постами, ни кандидатами. Только
// однозначные признаки: «the best …» и «… explained» бывают и у новостей.
const GUIDE_TITLE_PATTERN = String.raw`^(how to|where to (buy|watch|stream)) |\mwalkthrough\M|\mlocations in\M`;

// Карточки окна с тем же редким именем в пересказе (см. MAX_NAME_CARDS).
// Проверка 20 октября на 72 часах (1179 карточек): 65 новых пар, модель
// отнесла к треду 22, из них неверно 2 — материалы о Египте и светская
// хроника, — остальные действительно одна история (проверка Ильхан Омар,
// «Whalefall», документальный фильм «You Can See Everything», дело Бо
// Ламарра-Кондона).
async function nameCandidates(clusterId: number): Promise<Candidate[]> {
  const { rows: own } = await pool.query(
    `SELECT a.created_at, (SELECT s.ai_summary FROM articles s WHERE s.cluster_id = a.id AND s.ai_summary IS NOT NULL
       ORDER BY s.ai_summary_more IS NULL, s.created_at LIMIT 1) AS summary
     FROM articles a WHERE a.id = $1 AND a.title !~* $2`,
    [clusterId, GUIDE_TITLE_PATTERN]
  );
  if (!own[0]?.summary) return [];
  const names = new Set(
    [...(own[0].summary as string).matchAll(NAME_PATTERN)]
      .map((m) => m[0])
      .filter((n) => {
        const words = n.split(/\s+/);
        return words.every((w) => w.length >= 3) && !ADJECTIVE_ENDING.test(words[0]);
      })
  );
  const found = new Map<number, number | null>();
  for (const name of names) {
    const { rows } = await pool.query(
      `SELECT d.id, tp.thread_id FROM articles d
       LEFT JOIN thread_posts tp ON tp.cluster_id = d.id
       WHERE d.cluster_id = d.id AND d.id <> $1 AND d.visible_at IS NOT NULL AND d.title !~* $4
         AND NOT EXISTS (SELECT 1 FROM thread_exclusions x WHERE x.cluster_id = $1 AND x.thread_id = tp.thread_id)
         AND d.created_at < $2 AND d.created_at > $2::timestamptz - interval '${CANDIDATE_WINDOW_HOURS} hours'
         AND EXISTS (SELECT 1 FROM articles s WHERE s.cluster_id = d.id AND strpos(s.ai_summary, $3) > 0)
       ORDER BY d.created_at DESC
       LIMIT ${MAX_NAME_CARDS + 1}`,
      [clusterId, own[0].created_at, name, GUIDE_TITLE_PATTERN]
    );
    if (rows.length > MAX_NAME_CARDS) continue;
    for (const r of rows) found.set(r.id, r.thread_id);
  }
  return [...found].map(([id, threadId]) => ({ threadId, clusterIds: [id], similarity: 0 }));
}

async function findCandidates(clusterId: number): Promise<Candidate[]> {
  const { rows } = await pool.query(
    `SELECT d.id AS cluster_id, 1 - (d.title_embedding <=> c.title_embedding) AS similarity, tp.thread_id
     FROM articles c
     JOIN articles d ON d.cluster_id = d.id AND d.id <> c.id
       AND d.created_at < c.created_at AND d.created_at > c.created_at - interval '${CANDIDATE_WINDOW_HOURS} hours'
       AND d.title_embedding IS NOT NULL AND d.visible_at IS NOT NULL
     LEFT JOIN thread_posts tp ON tp.cluster_id = d.id
     WHERE c.id = $1 AND c.title_embedding IS NOT NULL
       AND c.title !~* $3 AND d.title !~* $3
       AND NOT EXISTS (SELECT 1 FROM thread_exclusions x WHERE x.cluster_id = c.id AND x.thread_id = tp.thread_id)
       AND 1 - (d.title_embedding <=> c.title_embedding) >= $2
       AND (d.created_at > c.created_at - interval '${OLD_CANDIDATE_HOURS} hours'
         OR 1 - (d.title_embedding <=> c.title_embedding) >= ${OLD_CANDIDATE_THRESHOLD}
         OR 1 - (d.embedding <=> c.embedding) >= ${OLD_CANDIDATE_THRESHOLD})
       AND EXISTS (SELECT 1 FROM articles s WHERE s.cluster_id = d.id AND s.ai_summary IS NOT NULL)
     ORDER BY similarity DESC
     LIMIT ${MAX_CANDIDATES}`,
    [clusterId, CANDIDATE_TITLE_THRESHOLD, GUIDE_TITLE_PATTERN]
  );
  const byThread = new Map<string, Candidate>();
  for (const r of rows) {
    const key = r.thread_id ? `t${r.thread_id}` : `c${r.cluster_id}`;
    const existing = byThread.get(key);
    if (existing) existing.similarity = Math.max(existing.similarity, r.similarity);
    else byThread.set(key, { threadId: r.thread_id, clusterIds: [r.cluster_id], similarity: r.similarity });
  }
  const candidates = [...byThread.values()].sort((a, b) => b.similarity - a.similarity).slice(0, MAX_CANDIDATE_THREADS);
  if (candidates.length < MAX_CANDIDATE_THREADS) {
    for (const extra of await nameCandidates(clusterId)) {
      const key = extra.threadId ? `t${extra.threadId}` : `c${extra.clusterIds[0]}`;
      if (byThread.has(key)) continue;
      byThread.set(key, extra);
      candidates.push(extra);
      if (candidates.length >= MAX_CANDIDATE_THREADS) break;
    }
  }
  // У существующего треда модели показываем его последние посты, а не только
  // ту карточку, что совпала по заголовку.
  for (const c of candidates) {
    if (!c.threadId) continue;
    const { rows: posts } = await pool.query(
      `SELECT tp.cluster_id, tp.new_details FROM thread_posts tp
       JOIN articles a ON a.id = tp.cluster_id AND a.cluster_id = a.id
       WHERE tp.thread_id = $1 ORDER BY a.created_at`,
      [c.threadId]
    );
    c.clusterIds = posts.map((p) => p.cluster_id);
  }
  return candidates;
}

function parseAnswer(raw: string, max: number): { thread: number; details: string | null } {
  const thread = Number(raw.match(/ТРЕД:\s*(\d+)/i)?.[1] ?? 0);
  let details: string | null = raw.match(/НОВОЕ:\s*([\s\S]+)/i)?.[1].trim() ?? null;
  if (details && /^нет\.?$/i.test(details)) details = null;
  return { thread: thread >= 1 && thread <= max ? thread : 0, details };
}

async function cardImages(clusterId: number): Promise<string[]> {
  const { rows } = await pool.query(
    "SELECT image_url, image_urls FROM articles WHERE cluster_id = $1 AND image_url IS NOT NULL",
    [clusterId]
  );
  return rows.flatMap((r) => [r.image_url, ...((r.image_urls as string[] | null) ?? []).slice(0, MAX_FRAMES_PER_CARD)]);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const day = (d: Date) => d.toISOString().slice(5, 10).split("-").reverse().join(".");

export type ThreadRunStats = {
  checked: number;
  joined: number;
  created: number;
  merged: number;
  noCandidates: number;
  stoppedByQuota: boolean;
};

// Проверяет непроверенные карточки последних sinceHours часов по порядку
// появления, чтобы треды росли в хронологии. Карточка, у которой нет
// кандидатов, отмечается проверенной без запроса к модели.
// clusterIds — проверить только эти карточки (ручная проверка конкретного случая).
export async function assignThreads(options: { sinceHours: number; limit?: number; clusterIds?: number[] }): Promise<ThreadRunStats> {
  const stats: ThreadRunStats = { checked: 0, joined: 0, created: 0, merged: 0, noCandidates: 0, stoppedByQuota: false };
  await cleanupThreads();
  const { rows: pending } = await pool.query(
    `SELECT a.id FROM articles a
     WHERE a.cluster_id = a.id AND a.visible_at IS NOT NULL
       AND a.created_at > now() - make_interval(hours => $1)
       AND EXISTS (SELECT 1 FROM articles s WHERE s.cluster_id = a.id AND s.ai_summary IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM thread_posts tp WHERE tp.cluster_id = a.id)
       AND ($3::int[] IS NULL OR a.id = ANY($3))
     ORDER BY a.created_at
     LIMIT $2`,
    [options.sinceHours, options.limit ?? 100_000, options.clusterIds ?? null]
  );

  for (const { id } of pending) {
    try {
      if (!(await assignOne(id, stats))) break;
    } catch (err) {
      // Карточку удалили, пока шла раскладка (список берётся один раз в
      // начале): запись решения нарушает внешний ключ. Пропускаем её.
      if ((err as { code?: string }).code !== FOREIGN_KEY_VIOLATION) throw err;
      console.error(`  тред для #${id}: карточка удалена во время раскладки, пропущена`);
    }
  }
  return stats;
}

const FOREIGN_KEY_VIOLATION = "23503";

// Решение по одной карточке. false — квота Gemini исчерпана, раскладку пора
// остановить.
async function assignOne(id: number, stats: ThreadRunStats): Promise<boolean> {
  const candidates = await findCandidates(id);
  if (!candidates.length) {
    await pool.query("INSERT INTO thread_posts (cluster_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
    stats.checked++;
    stats.noCandidates++;
    return true;
  }

  const cards = await loadCards([id, ...candidates.flatMap((c) => c.clusterIds)]);
  const card = cards.get(id);
  if (!card) return true;
  const { rows: details } = await pool.query(
    "SELECT cluster_id, new_details FROM thread_posts WHERE cluster_id = ANY($1)",
    [candidates.flatMap((c) => c.clusterIds)]
  );
  const newDetails = new Map(details.map((d) => [d.cluster_id, d.new_details as string | null]));
  const threadsText = candidates
    .map((c, i) => {
      const shown =
        c.clusterIds.length > MAX_POSTS_IN_PROMPT
          ? [c.clusterIds[0], ...c.clusterIds.slice(-(MAX_POSTS_IN_PROMPT - 1))]
          : c.clusterIds;
      const posts = shown
        .map((cid) => cards.get(cid))
        .filter((p): p is CardText => Boolean(p))
        .map((p) => `- (${day(p.createdAt)}) ${p.title}: ${newDetails.get(p.clusterId) ?? p.summary}`);
      return `Тред ${i + 1}:\n${posts.join("\n")}`;
    })
    .join("\n\n");
  const text = `(${day(card.createdAt)}) ${card.summary}${card.more ? ` ${card.more}` : ""}\n\nТРЕДЫ:\n${threadsText}`;

  let answer: string;
  try {
    answer = await summarize(card.title, text, THREAD_PROMPT);
  } catch (err) {
    if (err instanceof GeminiQuotaExhaustedError) {
      stats.stoppedByQuota = true;
      return false;
    }
    console.error(`  тред для #${id}: ошибка модели — ${(err as Error).message}`);
    return true;
  }
  await sleep(REQUEST_INTERVAL_MS);

  const { thread, details: fresh } = parseAnswer(answer, candidates.length);
  stats.checked++;
  if (!thread) {
    await pool.query("INSERT INTO thread_posts (cluster_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
    return true;
  }
  const chosen = candidates[thread - 1];
  let threadId = chosen.threadId;
  if (!threadId) {
    // Карточка-кандидат ещё одна — с неё тред и начинается, целиком.
    const { rows } = await pool.query("INSERT INTO threads DEFAULT VALUES RETURNING id");
    threadId = rows[0].id as number;
    await pool.query(
      `INSERT INTO thread_posts (cluster_id, thread_id) VALUES ($1, $2)
       ON CONFLICT (cluster_id) DO UPDATE SET thread_id = $2, new_details = NULL, checked_at = now()`,
      [chosen.clusterIds[0], threadId]
    );
    stats.created++;
    await ensureImageHashes(await cardImages(chosen.clusterIds[0]));
  }
  await pool.query(
    `INSERT INTO thread_posts (cluster_id, thread_id, new_details) VALUES ($1, $2, $3)
     ON CONFLICT (cluster_id) DO UPDATE SET thread_id = $2, new_details = $3, checked_at = now()`,
    [id, threadId, fresh]
  );
  stats.joined++;
  await ensureImageHashes(await cardImages(id));
  console.log(`  тред #${threadId}: «${card.title.slice(0, 60)}» → ${fresh ? "с новыми подробностями" : "без новых подробностей"}`);
  return mergeDuplicates(threadId, stats);
}

// Сверяет тред с похожими (см. MERGE_TITLE_THRESHOLD) и сливает те, что модель
// считает той же историей. Проверка 18 октября на известных парах: «да» у двух
// тредов о «Whalefall», двух о фильме Street Fighter (сборы и рецензии) и двух
// об Apple HomeView; «нет» у тредов о войне в Йемене, о фото Tesla Roadster и
// Model Y L и у треда о кроссовере Street Fighter с Mortal Kombat. false —
// квота Gemini исчерпана.
export async function mergeDuplicates(threadId: number, stats: ThreadRunStats): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT t2.thread_id, max(1 - (a1.title_embedding <=> a2.title_embedding)) AS similarity
     FROM thread_posts t1 JOIN articles a1 ON a1.id = t1.cluster_id
     JOIN thread_posts t2 ON t2.thread_id IS NOT NULL AND t2.thread_id <> t1.thread_id
     JOIN articles a2 ON a2.id = t2.cluster_id
     WHERE t1.thread_id = $1
       AND abs(extract(epoch FROM a1.created_at - a2.created_at)) < ${CANDIDATE_WINDOW_HOURS} * 3600
       AND NOT EXISTS (SELECT 1 FROM thread_exclusions x JOIN thread_posts p ON p.cluster_id = x.cluster_id
         WHERE (p.thread_id = t1.thread_id AND x.thread_id = t2.thread_id) OR (p.thread_id = t2.thread_id AND x.thread_id = t1.thread_id))
       AND 1 - (a1.title_embedding <=> a2.title_embedding) >= ${MERGE_TITLE_THRESHOLD}
     GROUP BY t2.thread_id ORDER BY similarity DESC LIMIT ${MAX_MERGE_CHECKS}`,
    [threadId]
  );
  let current = threadId;
  for (const { thread_id: other } of rows) {
    if (await excluded(current, other)) continue;
    let answer: string;
    try {
      answer = await summarize("Два треда", `Тред А:\n${await threadText(current)}\n\nТред Б:\n${await threadText(other)}`, MERGE_PROMPT);
    } catch (err) {
      if (err instanceof GeminiQuotaExhaustedError) {
        stats.stoppedByQuota = true;
        return false;
      }
      console.error(`  сверка тредов #${current} и #${other}: ошибка модели — ${(err as Error).message}`);
      continue;
    }
    await sleep(REQUEST_INTERVAL_MS);
    if (!/^\s*ДА/i.test(answer)) continue;
    current = await mergeThreads(current, other);
    stats.merged++;
  }
  return true;
}

// Есть ли в одном из тредов карточка, которую пользователь убрал из другого
// (см. thread_exclusions в db/schema.sql).
async function excluded(a: number, b: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM thread_exclusions x JOIN thread_posts p ON p.cluster_id = x.cluster_id
     WHERE (p.thread_id = $1 AND x.thread_id = $2) OR (p.thread_id = $2 AND x.thread_id = $1) LIMIT 1`,
    [a, b]
  );
  return Boolean(rowCount);
}

// Сливает два треда в тот, что начался раньше; возвращает его номер. Первая
// карточка поздней ветки была показана целиком, а в общем треде она — пост:
// без текста она склеилась бы с первой карточкой как «без новых подробностей»
// (см. assembleThreads в feed.ts), поэтому её текстом становится её главное.
async function mergeThreads(a: number, b: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT tp.thread_id, tp.cluster_id FROM thread_posts tp JOIN articles x ON x.id = tp.cluster_id
     WHERE tp.thread_id IN ($1, $2) ORDER BY x.created_at`,
    [a, b]
  );
  const target = rows[0].thread_id as number;
  const source = target === a ? b : a;
  const head = rows.find((r) => r.thread_id === source).cluster_id as number;
  await pool.query(
    `UPDATE thread_posts SET new_details = (SELECT x.ai_summary FROM articles x WHERE x.cluster_id = $1 AND x.ai_summary IS NOT NULL
       ORDER BY x.ai_summary_more IS NULL, x.created_at LIMIT 1)
     WHERE cluster_id = $1 AND new_details IS NULL`,
    [head]
  );
  await pool.query("UPDATE thread_posts SET thread_id = $1 WHERE thread_id = $2", [target, source]);
  await pool.query(
    `INSERT INTO thread_exclusions (cluster_id, thread_id) SELECT cluster_id, $1 FROM thread_exclusions WHERE thread_id = $2
     ON CONFLICT DO NOTHING`,
    [target, source]
  );
  await pool.query("DELETE FROM thread_exclusions WHERE thread_id = $1", [source]);
  await pool.query("DELETE FROM threads WHERE id = $1", [source]);
  console.log(`  тред #${target}: влит тред #${source}`);
  return target;
}

// Тред для сверки — как в запросе для новой карточки: первая карточка и
// последние посты, у постов — «что нового».
async function threadText(threadId: number): Promise<string> {
  const { rows } = await pool.query(
    `SELECT a.title, a.created_at, coalesce(tp.new_details, (SELECT x.ai_summary FROM articles x
       WHERE x.cluster_id = a.id AND x.ai_summary IS NOT NULL ORDER BY x.ai_summary_more IS NULL, x.created_at LIMIT 1)) AS text
     FROM thread_posts tp JOIN articles a ON a.id = tp.cluster_id WHERE tp.thread_id = $1 ORDER BY a.created_at`,
    [threadId]
  );
  const shown = rows.length > MAX_POSTS_IN_PROMPT ? [rows[0], ...rows.slice(-(MAX_POSTS_IN_PROMPT - 1))] : rows;
  return shown.map((r) => `- (${day(r.created_at)}) ${r.title}: ${r.text}`).join("\n");
}

// Решения о карточках, которые склейка позже объединила с другими, больше не
// действуют (первая статья перестала быть первой) — удаляем их, как и треды,
// в которых осталось меньше двух карточек: оставшаяся карточка проверится
// заново. Отпечатки картинок, которых уже нет в базе, тоже удаляем.
async function cleanupThreads(): Promise<void> {
  await pool.query(
    `DELETE FROM thread_posts tp WHERE NOT EXISTS (SELECT 1 FROM articles a WHERE a.id = tp.cluster_id AND a.cluster_id = a.id)`
  );
  await pool.query(
    `DELETE FROM threads t WHERE (SELECT count(*) FROM thread_posts tp WHERE tp.thread_id = t.id) < 2`
  );
  await pool.query(
    `DELETE FROM image_hashes h WHERE created_at < now() - interval '1 day'
       AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.image_url = h.url OR h.url = ANY(a.image_urls))`
  );
}
