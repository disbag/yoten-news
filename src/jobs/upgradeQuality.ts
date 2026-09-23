import "dotenv/config";
import { pool, toVectorLiteral } from "../lib/db.js";
import { embed } from "../lib/embeddings.js";
import { summarizeArticle } from "../lib/summarizer.js";
import { fetchOgTags } from "../lib/ogTags.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Пересчитывает саммари (главное + продолжение под кат) для последних N
// статей с более богатым контекстом (JSON-LD articleBody / отфильтрованные
// абзацы вместо голого og:description или сниппета из RSS) — см.
// src/lib/ogTags.ts. Обновляет ai_summary, ai_summary_more, full_description,
// image_url, category и embedding (т.к. эмбеддинг считается от текста саммари).
// cluster_id намеренно не трогает — пересчитывать кластеризацию задним
// числом рискованно, это отдельная задача.
async function main() {
  const limit = Number(process.env.QUALITY_LIMIT ?? 50);
  const { rows } = await pool.query(
    `SELECT id, title, link, raw_summary FROM articles ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  console.log(`К обработке: ${rows.length}`);

  let updated = 0;
  for (const row of rows) {
    let fullDescription: string | undefined;
    let imageUrl: string | undefined;
    let excerpt: string | undefined;
    try {
      const og = await fetchOgTags(row.link);
      fullDescription = og.description;
      imageUrl = og.image;
      excerpt = og.excerpt;
    } catch {
      // источник заблокировал бота — работаем с тем, что уже есть
    }

    let aiSummary: string;
    let aiSummaryMore: string | null;
    let category: string[] | null;
    try {
      ({ summary: aiSummary, more: aiSummaryMore, category } = await summarizeArticle(row.title, {
        excerpt,
        description: fullDescription,
        rawSummary: row.raw_summary,
      }));
    } catch (err) {
      console.error(`  #${row.id} ошибка саммаризации: ${(err as Error).message}`);
      continue;
    }

    const embedding = await embed(`${row.title}. ${aiSummary}`);
    const vectorLiteral = toVectorLiteral(embedding);

    await pool.query(
      `UPDATE articles
       SET ai_summary = $1,
           ai_summary_more = $2,
           ai_summary_long = NULL,
           full_description = COALESCE($3, full_description),
           image_url = COALESCE($4, image_url),
           category = $5,
           embedding = $6::vector
       WHERE id = $7`,
      [aiSummary, aiSummaryMore, fullDescription ?? null, imageUrl ?? null, category, vectorLiteral, row.id]
    );

    console.log(`  #${row.id} "${row.title.slice(0, 50)}..." → ${aiSummary.slice(0, 80)}...`);
    updated += 1;
    await sleep(500);
  }

  console.log(`Обновлено: ${updated} из ${rows.length}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
