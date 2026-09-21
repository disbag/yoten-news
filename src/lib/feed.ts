import { pool } from "./db.js";

export type FeedSource = { name: string; homepage: string | null; link: string };

// Одна карточка ленты = один инфоповод (cluster_id). Если его освещали
// несколько изданий (или одно и то же издание несколько раз), sources.length
// > 1 и все они перечислены в модалке — без отдельного "треда" из нескольких
// похожих, но разных статей (убрали: слишком часто склеивал реально разные
// новости в одну карточку, см. историю в README).
export type FeedItem = {
  clusterId: number;
  imageUrl: string | null;
  summary: string;
  summaryLong: string | null;
  description: string | null;
  publishedAt: string | null;
  primarySource: string;
  primaryHomepage: string | null;
  primaryLink: string;
  sources: FeedSource[];
  category: string[] | null;
  isRead: boolean;
};

export async function getFeed(
  options: {
    limit?: number;
    category?: string;
    // Курсор для подгрузки следующей страницы — пара (published_at,
    // cluster_id) последней уже показанной карточки, а не OFFSET. OFFSET
    // сдвигается, когда между загрузкой страниц в таблицу добавляются новые
    // статьи (а фоновый npm run fetch может отработать в любой момент) — ORDER
    // BY published_at DESC не гарантирует, что то, что было на позиции N,
    // останется на позиции N при следующем запросе, из-за чего "Показать
    // ещё" могло показать одну и ту же карточку дважды или пропустить
    // какую-то. Курсор по последней увиденной паре не зависит от того,
    // сколько строк появилось до него с момента предыдущего запроса.
    before?: { publishedAt: string; clusterId: number };
    // Без userId (гость) isRead всегда false и unreadOnly ничего не фильтрует
    // — сравнение ar.user_id = NULL никогда не истинно в SQL.
    userId?: number | null;
    unreadOnly?: boolean;
  } = {}
): Promise<FeedItem[]> {
  const { limit = 30, category, before, userId = null, unreadOnly = false } = options;

  // category фильтрует статьи ДО группировки по cluster_id — т.к. все статьи
  // одного кластера описывают один инфоповод, категория у них должна
  // совпадать, но на случай расхождения так надёжнее, чем фильтровать уже
  // агрегированную карточку по одному произвольному значению. Статья может
  // относиться сразу к двум темам (см. CATEGORY_INSTRUCTIONS в
  // src/lib/prompt.ts), поэтому category — массив, и фильтр — вхождение, а
  // не равенство.
  const params: unknown[] = [limit, userId];
  let categoryClause = "";
  if (category) {
    params.push(category);
    categoryClause = `WHERE $${params.length} = ANY(a.category)`;
  }

  const havingClauses: string[] = [];
  if (before) {
    havingClauses.push(
      `(max(a.published_at), a.cluster_id) < ($${params.push(before.publishedAt)}::timestamptz, $${params.push(before.clusterId)})`
    );
  }
  if (unreadOnly) {
    havingClauses.push("NOT bool_or(ar.user_id IS NOT NULL)");
  }

  const { rows } = await pool.query(
    `
    SELECT
      a.cluster_id,
      (array_agg(a.ai_summary ORDER BY a.created_at ASC))[1] AS summary,
      -- Любое непустое подробное саммари в кластере, не обязательно у самой
      -- ранней статьи — старые статьи могли быть собраны до появления этого
      -- поля и не имеют его, тогда как более новая в том же кластере уже да.
      (array_agg(a.ai_summary_long ORDER BY a.ai_summary_long NULLS LAST))[1] AS summary_long,
      -- картинку/описание/дату/издание берём с первой статьи в кластере
      -- (не все источники отдают og-теги — см. src/lib/ogTags.ts)
      (array_agg(a.full_description ORDER BY a.full_description NULLS LAST))[1] AS description,
      (array_agg(a.image_url ORDER BY a.image_url NULLS LAST))[1] AS image_url,
      -- Дата карточки = дата САМОЙ СВЕЖЕЙ статьи в кластере — то же значение,
      -- по которому идёт сортировка ленты (см. ORDER BY ниже). Раньше дата
      -- бралась от первой добавленной в кластер статьи (ORDER BY created_at),
      -- а сортировка — от самой свежей: карточка могла всплыть наверх ленты
      -- из-за нового источника, но показывать дату многодневной давности —
      -- выглядело как "лента отсортирована неправильно".
      max(a.published_at) AS published_at,
      (array_agg(s.name ORDER BY a.created_at ASC))[1] AS primary_source,
      (array_agg(s.homepage_url ORDER BY a.created_at ASC))[1] AS primary_homepage,
      (array_agg(a.link ORDER BY a.created_at ASC))[1] AS primary_link,
      jsonb_agg(DISTINCT jsonb_build_object('name', s.name, 'homepage', s.homepage_url, 'link', a.link)) AS source_list,
      -- category — TEXT[] на статью (см. схему), поэтому паттерн
      -- "array_agg(...)[1]", как для остальных полей выше, здесь не
      -- работает: array_agg по колонке-массиву даёт 2D-массив, а
      -- одиночный индекс [1] у 2D-массива в Postgres не достаёт подмассив
      -- (тихо возвращает NULL) — нужны оба индекса ([1][1]) для скаляра,
      -- которых у нас нет, т.к. сам тег — уже массив. Проще и надёжнее —
      -- обычный коррелированный подзапрос: берём набор тегов первой
      -- размеченной статьи в кластере.
      (
        SELECT a2.category FROM articles a2
        WHERE a2.cluster_id = a.cluster_id AND a2.category IS NOT NULL
        ORDER BY a2.created_at ASC
        LIMIT 1
      ) AS category,
      bool_or(ar.user_id IS NOT NULL) AS is_read
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN article_reads ar ON ar.cluster_id = a.cluster_id AND ar.user_id = $2
    ${categoryClause}
    GROUP BY a.cluster_id
    ${havingClauses.length ? `HAVING ${havingClauses.join(" AND ")}` : ""}
    ORDER BY published_at DESC, a.cluster_id DESC
    LIMIT $1
    `,
    params
  );

  // pg возвращает timestamptz как объект Date, а не строку — приводим к ISO
  // сразу, чтобы дальше можно было сравнивать строки без сюрпризов.
  const toIso = (value: unknown): string | null =>
    value ? new Date(value as string | Date).toISOString() : null;

  return rows.map(
    (row): FeedItem => ({
      clusterId: row.cluster_id,
      imageUrl: row.image_url,
      summary: row.summary,
      summaryLong: row.summary_long,
      description: row.description,
      publishedAt: toIso(row.published_at),
      primarySource: row.primary_source,
      primaryHomepage: row.primary_homepage,
      primaryLink: row.primary_link,
      sources: row.source_list as FeedSource[],
      category: row.category,
      isRead: row.is_read,
    })
  );
}
