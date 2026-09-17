import { pool } from "./db.js";

// Склейка статей с тем же инфоповодом в один cluster_id (строгий порог,
// источник может быть любым, включая тот же самый — см. вызов в
// fetchAndProcess.ts).
export async function findAndAssignGroup(
  column: "cluster_id",
  newId: number,
  vectorLiteral: string,
  options: { excludeSourceId: number | null; windowHours: number; threshold: number }
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
       AND 1 - (embedding <=> $3::vector) > $4
     ORDER BY embedding <=> $3::vector
     LIMIT 1`,
    [newId, options.excludeSourceId, vectorLiteral, options.threshold]
  );
  const groupId = match.rowCount ? match.rows[0][column] ?? match.rows[0].id : newId;
  await pool.query(`UPDATE articles SET ${column} = $1 WHERE id = $2`, [groupId, newId]);
  return { groupId, matched: !!match.rowCount };
}
