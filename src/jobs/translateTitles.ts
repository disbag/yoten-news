import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { pool } from "../lib/db.js";
import { GroqRequestTooLargeError } from "../lib/groq.js";
import { SummaryQualityError } from "../lib/summaryQuality.js";
import { sleep } from "../lib/http.js";
import { translateArticleTitles } from "../lib/summarizer.js";
import type { ArticleTitle } from "../lib/titleTranslation.js";

const BATCH_SIZE = 12;
const BATCH_LIMIT = 5;

export async function backfillArticleTitles() {
  const { rows } = await pool.query<ArticleTitle>(
    `SELECT id, title FROM (
       SELECT DISTINCT ON (a.cluster_id) a.id, a.title, a.visible_at, a.created_at
       FROM articles a
       WHERE a.ai_summary IS NOT NULL AND a.cluster_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM articles member
           WHERE member.cluster_id = a.cluster_id AND NULLIF(btrim(member.title_ru), '') IS NOT NULL
             AND (member.visible_at IS NOT NULL OR member.ai_summary IS NOT NULL)
         )
       ORDER BY a.cluster_id, a.ai_summary_more IS NULL, a.created_at, a.id
     ) pending
     ORDER BY visible_at IS NOT NULL, created_at, id LIMIT $1`,
    [BATCH_SIZE * BATCH_LIMIT],
  );
  let saved = 0;
  let failed = false;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    let translated: ArticleTitle[];
    try {
      translated = await translateArticleTitles(batch);
    } catch (err) {
      if (!(err instanceof SummaryQualityError) && !(err instanceof GroqRequestTooLargeError)) throw err;
      console.error("TITLE_TRANSLATION_FAILED " + JSON.stringify({
        ids: batch.map(({ id }) => id),
        attempts: err instanceof SummaryQualityError ? err.attempts : undefined,
        reasons: err instanceof SummaryQualityError ? err.reasons : ["groq_request_too_large"],
        message: err.message,
      }));
      failed = true;
      if (offset + BATCH_SIZE < rows.length) await sleep(4000);
      continue;
    }
    const originals = new Map(batch.map(({ id, title }) => [id, title]));
    const result = await pool.query(
      `UPDATE articles AS a SET title_ru = t.title_ru
       FROM unnest($1::int[], $2::text[], $3::text[]) AS t(id, title, title_ru)
       WHERE a.id = t.id AND a.title = t.title AND NULLIF(btrim(a.title_ru), '') IS NULL`,
      [translated.map(({ id }) => id), translated.map(({ id }) => originals.get(id)), translated.map(({ title }) => title)],
    );
    saved += result.rowCount ?? 0;
    if (offset + BATCH_SIZE < rows.length) await sleep(4000);
  }
  if (rows.length) console.log(`Заголовки: сохранено переводов ${saved} из ${rows.length}`);
  return failed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  backfillArticleTitles().then(failed => {
    if (failed) process.exitCode = 1;
  }).catch((err) => {
    console.error("Ошибка перевода заголовков:", err.message);
    process.exitCode = 1;
  }).finally(() => pool.end());
}
