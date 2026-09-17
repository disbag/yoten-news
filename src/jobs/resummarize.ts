import "dotenv/config";
import { pool } from "../lib/db.js";
import { summarize } from "../lib/summarizer.js";

// Пересчитывает саммари для статей, где ai_summary обрывается без финальной
// пунктуации (например, из-за старого/слишком маленького maxOutputTokens).
async function main() {
  const { rows } = await pool.query(
    `SELECT id, title, raw_summary FROM articles WHERE ai_summary !~ '[.!?…»"]$'`
  );

  console.log(`Найдено обрывистых саммари: ${rows.length}`);

  for (const row of rows) {
    try {
      const { summary: newSummary } = await summarize(row.title, row.raw_summary);
      await pool.query("UPDATE articles SET ai_summary = $1 WHERE id = $2", [
        newSummary,
        row.id,
      ]);
      console.log(`  #${row.id} обновлено: "${newSummary}"`);
    } catch (err) {
      console.error(`  #${row.id} ошибка: ${(err as Error).message}`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
