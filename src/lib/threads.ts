import { pool } from "./db.js";
import { summarize, GeminiQuotaExhaustedError } from "./gemini.js";
import { ensureImageHashes } from "./imageHash.js";

// Треды (DIS-36) — уровень над склейкой дублей: карточки об одной истории,
// её развитии или об одном информационном поводе (несколько версий систем
// Apple в один день). Пока в теневом режиме: решения пишутся в thread_posts,
// рабочая лента их не показывает (см. THREADS_VIEW в src/lib/feed.ts).
//
// Как решается, что карточка — продолжение треда:
// 1. Кандидаты — карточки последних CANDIDATE_WINDOW_HOURS с похожим
//    заголовком (по векторам заголовков, порог CANDIDATE_TITLE_THRESHOLD).
//    Порог мягкий: по выборке 16 октября при сходстве заголовков 0,60–0,65
//    одна история только в половине пар — отбор окончательно делает модель.
//    Материалы об одном выходе фильма, игры или устройства (рецензии разных
//    изданий, интервью, места съёмок, саундтрек) — один тред: так решил
//    пользователь 16 октября по тредам «Разум и чувства», «Аватар: Семь
//    гаваней», Castlevania и «La Bola Negra». Гайды и подборки — нет.
//    Ежедневные рыночные сводки (Bloomberg: «медь падает третий день» и
//    «металлы отскакивают», нефтяные сводки за 15 и 16 октября) — тоже нет,
//    если у них нет общего конкретного события.
// 2. Модель получает новую карточку и до MAX_CANDIDATE_THREADS тредов-
//    кандидатов (тред — это и одиночная карточка, к которой ещё никто не
//    присоединился) и отвечает, к какому треду она относится, и что в ней
//    нового по сравнению с тредом. Это «новое» и показывается в треде вместо
//    полного пересказа.

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
// Сколько последних постов треда показывать модели — длинный тред не должен
// раздувать запрос.
const MAX_POSTS_IN_PROMPT = 4;
// Пауза между запросами — тот же лимит Gemini, что и при сборе
// (REQUEST_INTERVAL_MS в fetchAndProcess.ts).
const REQUEST_INTERVAL_MS = 4000;
// Сколько кадров галереи одной карточки считать для отпечатков.
const MAX_FRAMES_PER_CARD = 8;

export const THREAD_PROMPT = `Ты — редактор новостной ленты. Тебе дают НОВУЮ новость и пронумерованный список тредов. Тред — это одна история: одно событие, его продолжение и развитие (новые подробности, реакции, последствия, следующий этап) или один информационный повод (например, в один день вышли новые версии нескольких систем одной компании).

НЕ относи новость к треду, если общее только у темы или фона, а события разные: одна компания, один человек, одна игра, одна страна, одна отрасль или один затяжной конфликт (война, отношения двух политиков) — ещё не одна история. Для одной истории нужен конкретный общий повод: то же событие, заявление, решение, встреча, сделка или происшествие. Выход фильма, сериала, игры или устройства — тоже один повод: рецензии разных изданий, интервью с создателями, рассказы о съёмках, новости о премьере, наградах и саундтреке одной картины относи к одному треду. Не относи к треду гайды, прохождения и советы по игре, а также подборки и списки. Ежедневные рыночные сводки (движение акций, валют, нефти, металлов за день) — разные истории, даже если рынок тот же: объединяй их, только если речь об одном конкретном событии (решение центробанка, сделка, банкротство). В скобках у каждой новости — дата: материалы, разделённые несколькими днями, относи к одному треду, только если новая прямо продолжает тот же повод.

Ответь строго двумя строками, без пояснений:
ТРЕД: номер подходящего треда из списка или 0, если новость не продолжает ни один
НОВОЕ: если ТРЕД не 0 — 1–3 предложения на русском только с фактами новой новости, которых ещё нет в треде: без повторов уже сказанного, без вводных слов, без «также сообщается». Если нового нет или ТРЕД 0 — напиши «нет».`;

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

async function findCandidates(clusterId: number): Promise<Candidate[]> {
  const { rows } = await pool.query(
    `SELECT d.id AS cluster_id, 1 - (d.title_embedding <=> c.title_embedding) AS similarity, tp.thread_id
     FROM articles c
     JOIN articles d ON d.cluster_id = d.id AND d.id <> c.id
       AND d.created_at < c.created_at AND d.created_at > c.created_at - interval '${CANDIDATE_WINDOW_HOURS} hours'
       AND d.title_embedding IS NOT NULL AND d.visible_at IS NOT NULL
     LEFT JOIN thread_posts tp ON tp.cluster_id = d.id
     WHERE c.id = $1 AND c.title_embedding IS NOT NULL
       AND 1 - (d.title_embedding <=> c.title_embedding) >= $2
       AND (d.created_at > c.created_at - interval '${OLD_CANDIDATE_HOURS} hours'
         OR 1 - (d.title_embedding <=> c.title_embedding) >= ${OLD_CANDIDATE_THRESHOLD}
         OR 1 - (d.embedding <=> c.embedding) >= ${OLD_CANDIDATE_THRESHOLD})
       AND EXISTS (SELECT 1 FROM articles s WHERE s.cluster_id = d.id AND s.ai_summary IS NOT NULL)
     ORDER BY similarity DESC
     LIMIT ${MAX_CANDIDATES}`,
    [clusterId, CANDIDATE_TITLE_THRESHOLD]
  );
  const byThread = new Map<string, Candidate>();
  for (const r of rows) {
    const key = r.thread_id ? `t${r.thread_id}` : `c${r.cluster_id}`;
    const existing = byThread.get(key);
    if (existing) existing.similarity = Math.max(existing.similarity, r.similarity);
    else byThread.set(key, { threadId: r.thread_id, clusterIds: [r.cluster_id], similarity: r.similarity });
  }
  const candidates = [...byThread.values()].sort((a, b) => b.similarity - a.similarity).slice(0, MAX_CANDIDATE_THREADS);
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

export type ThreadRunStats = { checked: number; joined: number; created: number; noCandidates: number; stoppedByQuota: boolean };

// Проверяет непроверенные карточки последних sinceHours часов по порядку
// появления, чтобы треды росли в хронологии. Карточка, у которой нет
// кандидатов, отмечается проверенной без запроса к модели.
// clusterIds — проверить только эти карточки (ручная проверка конкретного случая).
export async function assignThreads(options: { sinceHours: number; limit?: number; clusterIds?: number[] }): Promise<ThreadRunStats> {
  const stats: ThreadRunStats = { checked: 0, joined: 0, created: 0, noCandidates: 0, stoppedByQuota: false };
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
    const candidates = await findCandidates(id);
    if (!candidates.length) {
      await pool.query("INSERT INTO thread_posts (cluster_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
      stats.checked++;
      stats.noCandidates++;
      continue;
    }

    const cards = await loadCards([id, ...candidates.flatMap((c) => c.clusterIds)]);
    const card = cards.get(id);
    if (!card) continue;
    const { rows: details } = await pool.query(
      "SELECT cluster_id, new_details FROM thread_posts WHERE cluster_id = ANY($1)",
      [candidates.flatMap((c) => c.clusterIds)]
    );
    const newDetails = new Map(details.map((d) => [d.cluster_id, d.new_details as string | null]));
    const threadsText = candidates
      .map((c, i) => {
        const posts = c.clusterIds
          .slice(-MAX_POSTS_IN_PROMPT)
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
        break;
      }
      console.error(`  тред для #${id}: ошибка модели — ${(err as Error).message}`);
      continue;
    }
    await sleep(REQUEST_INTERVAL_MS);

    const { thread, details: fresh } = parseAnswer(answer, candidates.length);
    stats.checked++;
    if (!thread) {
      await pool.query("INSERT INTO thread_posts (cluster_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
      continue;
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
  }
  return stats;
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
