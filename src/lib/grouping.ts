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
    // Второй сигнал — сходство ЗАГОЛОВКОВ (см. title_embedding в схеме).
    // Тело статьи у разных изданий об одном инфоповоде часто расходится по
    // акценту (Variety/THR про Оливера: тела 0.62, заголовки 0.83), а вес
    // заголовка в эмбеддинге тела — единицы процентов. Склеиваем, если:
    //  - заголовки почти одинаковые (titleThreshold), тело не важно; либо
    //  - заголовки близки (titleAssistThreshold) И тела хотя бы отдалённо
    //    об одном (titleAssistBodyThreshold). Второе условие отсекает
    //    похожие по формулировке, но разные материалы: подборки "что смотреть
    //    на выходных" (заголовки 0.72, тела 0.46-0.56) и серии статей.
    // Подобрано на реальных парах за 60 часов (см. коммит): все 5 пар с
    // заголовками ≥0.80 и 8 пар по второму правилу — настоящие дубли.
    titleVector: string;
    titleThreshold: number;
    titleAssistThreshold: number;
    titleAssistBodyThreshold: number;
    // Для запасного правила по общему имени в заголовках (см. matchByNamePair).
    title: string;
    sourceId: number;
    // Для запасного правила по одной и той же обложке (см. matchBySameImage).
    imageUrl: string | null;
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
       AND (
         1 - (embedding <=> $3::vector) > (
           CASE WHEN $5::bool OR full_description IS NULL THEN $6::float8 ELSE $4::float8 END
         )
         OR (
           title_embedding IS NOT NULL AND (
             1 - (title_embedding <=> $7::vector) >= $8::float8
             OR (
               1 - (title_embedding <=> $7::vector) >= $9::float8
               AND 1 - (embedding <=> $3::vector) >= $10::float8
             )
           )
         )
       )
     ORDER BY GREATEST(
       1 - (embedding <=> $3::vector),
       COALESCE(1 - (title_embedding <=> $7::vector), 0)
     ) DESC
     LIMIT 1`,
    [
      newId,
      options.excludeSourceId,
      vectorLiteral,
      options.threshold,
      options.isThin,
      options.thinThreshold,
      options.titleVector,
      options.titleThreshold,
      options.titleAssistThreshold,
      options.titleAssistBodyThreshold,
    ]
  );
  const fallback = match.rowCount
    ? null
    : (await matchByNamePair(newId, vectorLiteral, options)) ?? (await matchBySameImage(newId, vectorLiteral, options));
  const groupId = match.rowCount ? match.rows[0][column] ?? match.rows[0].id : fallback ?? newId;
  await pool.query(`UPDATE articles SET ${column} = $1 WHERE id = $2`, [groupId, newId]);
  return { groupId, matched: !!match.rowCount || fallback !== null };
}

// Запасное правило: в заголовках двух разных изданий одно и то же редкое
// имя собственное из двух слов ("Nathan Fielder", "Endgame Encore", "Warren
// Buffett"), которое за последние сутки встречалось только у этого кластера.
// Такие пары — почти всегда один инфоповод, даже когда тела статей похожи
// лишь средне: издания пересказывают его под разным углом (реальный случай —
// трейлер документалки про Элизабет Холмс у TechCrunch и Variety: тела 0.54,
// заголовки 0.79, мимо обоих правил выше). Само по себе общее имя не
// аргумент — у одного актёра бывает два разных интервью за день, — поэтому
// тела всё равно должны быть заметно похожи (NAME_PAIR_BODY), а в полосе
// пониже — ещё и заголовки (NAME_PAIR_ASSIST_*).
// Подобрано на неделе реальных данных: из статей, которые остались без
// склейки, правило склеивает ~17 настоящих дублей и одну ошибочную пару
// (обзор Mac Studio с подборкой аксессуаров к нему, 0.67). Порог 0.62, а не
// 0.60: в полосе 0.60–0.62 были почти одни разные материалы — два интервью
// Naomi Watts, две новости Rockstar Games, две про китайские машины.
const NAME_PAIR_BODY = 0.62;
const NAME_PAIR_ASSIST_BODY = 0.53;
const NAME_PAIR_ASSIST_TITLE = 0.65;
const NAME_PAIR_DF_HOURS = 24;

const PHRASE_STOPWORDS = new Set(
  "a an the of to in on for and or but is are was were be been with at by from as it its this that these those his her their our your my he she they we you i new says say said how why what who when where will can could would should just now after over into out up about than more most not no yes do does did has have had vs".split(
    " "
  )
);

// Пары соседних слов заголовка (в нижнем регистре) без служебных слов и
// чисел. capitalizedOnly — только пары, где оба слова с заглавной, то есть
// похожие на имя собственное (в заголовках в Title Case с заглавной и
// обычные слова — от этого отсекает редкость пары, см. выше).
function titleBigrams(title: string, capitalizedOnly: boolean): Set<string> {
  const words = title
    .replace(/&#8217;|[’‘`]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, "").replace(/'s$/i, ""))
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 1 < words.length; i++) {
    const [x, y] = [words[i], words[i + 1]];
    if (capitalizedOnly && !(/^\p{Lu}/u.test(x) && /^\p{Lu}/u.test(y))) continue;
    const [lx, ly] = [x.toLowerCase(), y.toLowerCase()];
    if (PHRASE_STOPWORDS.has(lx) || PHRASE_STOPWORDS.has(ly)) continue;
    if (lx.length < 3 || ly.length < 3 || /^\d+$/.test(lx) || /^\d+$/.test(ly)) continue;
    out.add(`${lx} ${ly}`);
  }
  return out;
}

async function matchByNamePair(
  newId: number,
  vectorLiteral: string,
  options: { title: string; sourceId: number; titleVector: string; windowHours: number }
): Promise<number | null> {
  const names = titleBigrams(options.title, true);
  if (!names.size) return null;

  const recent = await pool.query<{ cluster_id: number; source_id: number; title: string }>(
    `SELECT cluster_id, source_id, title FROM articles
     WHERE id <> $1 AND cluster_id IS NOT NULL AND created_at > now() - interval '${NAME_PAIR_DF_HOURS} hours'`,
    [newId]
  );
  // Для каждой пары слов — в каких кластерах она встречалась (в любом
  // регистре — для редкости) и где она стоит именем с заглавных у другого
  // издания (для самой склейки).
  const seenIn = new Map<string, Set<number>>();
  const namedIn = new Map<string, Set<number>>();
  for (const row of recent.rows) {
    const any = titleBigrams(row.title, false);
    const caps = row.source_id !== options.sourceId ? titleBigrams(row.title, true) : new Set<string>();
    for (const name of names) {
      if (!any.has(name)) continue;
      (seenIn.get(name) ?? seenIn.set(name, new Set()).get(name)!).add(row.cluster_id);
      if (caps.has(name)) (namedIn.get(name) ?? namedIn.set(name, new Set()).get(name)!).add(row.cluster_id);
    }
  }
  const candidates = new Set<number>();
  for (const [name, clusters] of seenIn) {
    const [only] = clusters;
    if (clusters.size === 1 && namedIn.get(name)?.has(only)) candidates.add(only);
  }
  if (!candidates.size) return null;

  const match = await pool.query<{ id: number }>(
    `SELECT id FROM (
       SELECT id,
              1 - (embedding <=> $2::vector) AS body,
              COALESCE(1 - (title_embedding <=> $3::vector), 0) AS title
       FROM articles
       WHERE id = ANY($1::int[]) AND cluster_id = id
         AND created_at > now() - interval '${options.windowHours} hours'
     ) s
     WHERE body >= $4 OR (body >= $5 AND title >= $6)
     ORDER BY body DESC
     LIMIT 1`,
    [[...candidates], vectorLiteral, options.titleVector, NAME_PAIR_BODY, NAME_PAIR_ASSIST_BODY, NAME_PAIR_ASSIST_TITLE]
  );
  if (!match.rowCount) return null;
  console.log(`  Склейка по общему имени в заголовке: кластер #${match.rows[0].id}`);
  return match.rows[0].id;
}

// Ещё одно запасное правило: у статьи другого издания та же обложка —
// один и тот же пресс-кадр (реальный случай — рецензии Variety и THR на
// "A Different World" с одним кадром Netflix ADW_102_260414_DD_00631_R*:
// тела 0.61, заголовки 0.59, мимо всех правил выше). Издания кладут кадр под
// своим именем с разными хвостами размера/версии, поэтому сравниваем имена
// файлов по общему началу, а не целиком. За неделю из 18 таких пар 14 уже
// были в одном кластере; из остальных ложными были только пары с
// обезличенными именами вроде "resident-evil-1" при телах 0.29–0.41 — их
// отсекают требование кода из 3+ цифр в имени и SAME_IMAGE_BODY.
const SAME_IMAGE_BODY = 0.5;

// Имя файла картинки без расширения и типовых хвостов размера — или null,
// если имя слишком общее, чтобы по нему судить (нет кода из цифр).
function imageKey(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  let name: string;
  try {
    name = decodeURIComponent(path.split("/").pop() ?? "");
  } catch {
    return null;
  }
  name = name
    .toLowerCase()
    .replace(/\.(jpe?g|png|webp|gif|avif)$/, "")
    .replace(/-\d{2,4}x\d{2,4}$/, "")
    .replace(/-scaled$/, "");
  return name.length >= 12 && /\d{3}/.test(name) ? name : null;
}

function sameImage(a: string, b: string): boolean {
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  return common >= 12 && common >= 0.8 * Math.min(a.length, b.length);
}

async function matchBySameImage(
  newId: number,
  vectorLiteral: string,
  options: { imageUrl: string | null; sourceId: number; windowHours: number }
): Promise<number | null> {
  const key = options.imageUrl ? imageKey(options.imageUrl) : null;
  if (!key) return null;

  const recent = await pool.query<{ cluster_id: number; image_url: string; body: number }>(
    `SELECT cluster_id, image_url, 1 - (embedding <=> $2::vector) AS body
     FROM articles
     WHERE id <> $1 AND cluster_id IS NOT NULL AND image_url IS NOT NULL AND source_id <> $3
       AND created_at > now() - interval '${options.windowHours} hours'
     ORDER BY body DESC`,
    [newId, vectorLiteral, options.sourceId]
  );
  const hit = recent.rows.find((r) => {
    const other = imageKey(r.image_url);
    return other !== null && sameImage(key, other) && r.body >= SAME_IMAGE_BODY;
  });
  if (!hit) return null;
  console.log(`  Склейка по одинаковой обложке: кластер #${hit.cluster_id}`);
  return hit.cluster_id;
}
