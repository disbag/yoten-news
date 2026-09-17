import "dotenv/config";
import { pool } from "../lib/db.js";
import { fetchOgTags } from "../lib/ogTags.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Одноразовый докат image_url/full_description для статей, собранных до того,
// как пайплайн начал их подтягивать. Best-effort: часть изданий (NYT,
// Telegraph) блокирует такие запросы — тогда просто оставляем поля пустыми.
async function main() {
  const { rows } = await pool.query(
    `SELECT id, link FROM articles WHERE image_url IS NULL AND full_description IS NULL`
  );
  console.log(`К обработке: ${rows.length}`);

  let filled = 0;
  for (const row of rows) {
    try {
      const og = await fetchOgTags(row.link);
      if (og.description || og.image) {
        await pool.query(
          "UPDATE articles SET full_description = $1, image_url = $2 WHERE id = $3",
          [og.description ?? null, og.image ?? null, row.id]
        );
        filled += 1;
      }
    } catch {
      // источник заблокировал бота — пропускаем
    }
    await sleep(300);
  }

  console.log(`Обогащено картинкой/описанием: ${filled} из ${rows.length}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
