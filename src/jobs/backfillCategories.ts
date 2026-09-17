import "dotenv/config";
import { pool } from "../lib/db.js";
import { summarize } from "../lib/summarizer.js";
import { CATEGORY_ONLY_PROMPT, ALL_TAGS } from "../lib/prompt.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// "Рассуждающие" модели (напр. gemma-4-31b-it) не всегда следуют инструкции
// ответить одним словом — вместо этого отдают цепочку рассуждений и называют
// тег где-то внутри (часто несколько раз, включая перебор вариантов). Берём
// ПОСЛЕДНЕЕ упоминание тега в ответе — это и есть итоговый вывод модели.
const TAG_PATTERN = new RegExp(`\\b(${ALL_TAGS.join("|")})\\b`, "gi");
function lastCategoryTag(raw: string): string | null {
  const matches = [...raw.matchAll(TAG_PATTERN)];
  return matches.length ? matches[matches.length - 1][1].toLowerCase() : null;
}

// Одноразовый докат category для статей, собранных до появления этой фичи.
// Классифицирует по уже готовому ai_summary — без повторного скрапинга
// страницы и без пересчёта самого саммари, поэтому дешевле upgrade-quality.
async function main() {
  const { rows } = await pool.query(
    `SELECT id, title, ai_summary FROM articles WHERE category IS NULL ORDER BY id ASC`
  );
  console.log(`К обработке: ${rows.length}`);

  let updated = 0;
  for (const row of rows) {
    try {
      const { summary: raw } = await summarize(row.title, row.ai_summary, CATEGORY_ONLY_PROMPT);
      const tag = lastCategoryTag(raw);

      if (tag === "sport") {
        // Спорт решили не показывать в ленте вообще (см. fetchAndProcess.ts) —
        // такие статьи не размечаем, а удаляем. cluster_id ссылается на
        // articles(id) без ON DELETE — на случай, если что-то всё же
        // сгруппировалось с этой статьёй, сначала отвязываем (обычно нет).
        await pool.query(`UPDATE articles SET cluster_id = id WHERE cluster_id = $1 AND id != $1`, [
          row.id,
        ]);
        await pool.query("DELETE FROM articles WHERE id = $1", [row.id]);
        console.log(`  #${row.id} "${row.title.slice(0, 50)}..." → спорт, удалена`);
        updated += 1;
        await sleep(500);
        continue;
      }

      // "other" сохраняем как есть, а не как NULL — иначе WHERE category IS
      // NULL выше на каждом прогоне заново выбирает те же статьи "не тройки"
      // категорий, и скрипт никогда их не "закрывает" (был реальный баг:
      // счётчик к обработке не двигался, хотя статьи реально классифицировались).
      // Только один тег (не два, как в основном пайплайне): у "рассуждающей"
      // модели "последние 2 упоминания" ненадёжны — почти всегда перед
      // финальным выводом идёт технический перебор "other: No", и он может
      // ложно попасть в результат вторым тегом.
      const category = tag ? [tag] : null;
      await pool.query("UPDATE articles SET category = $1 WHERE id = $2", [category, row.id]);
      console.log(`  #${row.id} "${row.title.slice(0, 50)}..." → ${category?.join(", ") ?? "не распознано"}`);
      updated += 1;
    } catch (err) {
      console.error(`  #${row.id} ошибка: ${(err as Error).message}`);
    }
    await sleep(500);
  }

  console.log(`Готово: ${updated} из ${rows.length}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
