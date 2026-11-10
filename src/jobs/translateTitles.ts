import { pool } from "../lib/db.js";
import { SummaryQualityError } from "../lib/summaryQuality.js";
import { sleep } from "../lib/http.js";
import { translateArticleTitles } from "../lib/summarizer.js";
import type { ArticleTitle } from "../lib/titleTranslation.js";

const BATCH_SIZE = 12;
const BATCH_LIMIT = 5;

async function main() {
  const { rows } = await pool.query<ArticleTitle>(
    `SELECT id, title FROM articles
     WHERE title_ru IS NULL AND visible_at IS NOT NULL AND cluster_id IS NOT NULL
     ORDER BY created_at DESC, id DESC LIMIT $1`,
    [BATCH_SIZE * BATCH_LIMIT],
  );
  let saved = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    let translated: ArticleTitle[];
    try {
      translated = await translateArticleTitles(batch);
    } catch (err) {
      if (!(err instanceof SummaryQualityError)) throw err;
      console.error("TITLE_TRANSLATION_FAILED " + JSON.stringify({
        ids: batch.map(({ id }) => id), attempts: err.attempts, reasons: err.reasons,
      }));
      process.exitCode = 1;
      if (offset + BATCH_SIZE < rows.length) await sleep(4000);
      continue;
    }
    const originals = new Map(batch.map(({ id, title }) => [id, title]));
    const result = await pool.query(
      `UPDATE articles AS a SET title_ru = t.title_ru
       FROM unnest($1::int[], $2::text[], $3::text[]) AS t(id, title, title_ru)
       WHERE a.id = t.id AND a.title = t.title AND a.title_ru IS NULL`,
      [translated.map(({ id }) => id), translated.map(({ id }) => originals.get(id)), translated.map(({ title }) => title)],
    );
    saved += result.rowCount ?? 0;
    if (offset + BATCH_SIZE < rows.length) await sleep(4000);
  }
  console.log(`Заголовки: сохранено переводов ${saved} из ${rows.length}`);
}

main().catch((err) => {
  console.error("Ошибка перевода заголовков:", err.message);
  process.exitCode = 1;
}).finally(() => pool.end());
