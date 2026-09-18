import { pool } from "./db.js";

// Склейка статей с тем же инфоповодом в один cluster_id (строгий порог,
// источник может быть любым, включая тот же самый — см. вызов в
// fetchAndProcess.ts).
export async function findAndAssignGroup(
  column: "cluster_id",
  newId: number,
  vectorLiteral: string,
  options: {
    excludeSourceId: number | null;
    windowHours: number;
    threshold: number;
    // Более мягкий порог для пар, где хотя бы одна сторона — тизер из RSS
    // без полного текста страницы (full_description IS NULL, платные/
    // блокирующие бота издания вроде Bloomberg/WSJ/NYT). На реальных
    // примерах: BBC (богатый текст, 1433 символа) + Bloomberg (тизер,
    // тизер ~100 символов) про один и тот же расстрел в школе на
    // Филиппинах — 0.694, ниже общего порога 0.75, хотя это точно один и
    // тот же инфоповод; то же самое было с Barbra Streisand (0.667,
    // Rolling Stone тизер + Hollywood Reporter тизер). Общий порог нельзя
    // просто понизить всем — на нём же держится реальный случай с двумя
    // РАЗНЫМИ новостями от одного издания (Flock cameras, оба текста
    // богатые) на 0.674, ниже thinThreshold, но так и должно остаться
    // неслипшимся.
    isThin: boolean;
    thinThreshold: number;
  }
): Promise<{ groupId: number; matched: boolean }> {
  // Важно: id < $1, а не просто != $1. В реальном инкрементальном пайплайне
  // это одно и то же (будущих строк ещё не существует на момент вставки), но
  // бэкфилл по уже существующим данным видит ВСЕ embeddings сразу — без этого
  // ограничения жадный "ближайший сосед" у каждой статьи может указывать на
  // разные другие статьи из одной группы, и группа рвётся на осколки вместо
  // объединения в одну тему (так и произошло с 5 эпизодами подкаста при
  // первом прогоне бэкфилла).
  //
  // AND ${column} = id — сравниваем только с "якорями" (статья сама себе
  // группа), не с уже приклеенными участниками. Без этого возможна
  // транзитивная склейка: A похожа на B (0.76), B похожа на C (0.76), но A и
  // C — про совершенно разное (0.72, ниже порога) — раньше C всё равно
  // попадал в группу A через B. Реальный случай: статья про ИИ-агента Meta
  // Muse склеилась со статьями про судебное дело сына Трампа и про позицию
  // Трампа по регулированию ИИ — только третья пара (Muse/Трамп-ИИ) была
  // ниже порога, но транзитивно через вторую (Трамп-дело/Трамп-ИИ) статья
  // всё равно присоединилась. Сравнение только с якорями исключает такую
  // цепочку ценой чуть более строгого дедупа (не сливаем с последним
  // добавленным в группу, если он с исходной статьёй сам по себе непохож).
  const match = await pool.query(
    `SELECT id, ${column}
     FROM articles
     WHERE id < $1
       AND ${column} = id
       AND ($2::int IS NULL OR source_id != $2)
       AND created_at > now() - interval '${options.windowHours} hours'
       AND 1 - (embedding <=> $3::vector) > (
         CASE WHEN $5::bool OR full_description IS NULL THEN $6 ELSE $4 END
       )
     ORDER BY embedding <=> $3::vector
     LIMIT 1`,
    [newId, options.excludeSourceId, vectorLiteral, options.threshold, options.isThin, options.thinThreshold]
  );
  const groupId = match.rowCount ? match.rows[0][column] ?? match.rows[0].id : newId;
  await pool.query(`UPDATE articles SET ${column} = $1 WHERE id = $2`, [groupId, newId]);
  return { groupId, matched: !!match.rowCount };
}
