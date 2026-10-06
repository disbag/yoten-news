import { pool } from "./db.js";

export type FeedSource = { name: string; homepage: string | null; link: string };

// Одна карточка ленты = один инфоповод (cluster_id). Если его освещали
// несколько изданий (или одно и то же издание несколько раз), sources.length
// > 1 и все они перечислены в раскрытой карточке — без отдельного "треда" из нескольких
// похожих, но разных статей (убрали: слишком часто склеивал реально разные
// новости в одну карточку, см. историю в README).
export type FeedItem = {
  clusterId: number;
  imageUrl: string | null;
  // Галерея (Hearst-издания — Motor Trend, Car and Driver, см. gallery в
  // src/config/sources.ts) — несколько кадров вместо одной картинки, показывается
  // каруселью в FeedCard.tsx. null/пусто у обычных статей с одной картинкой.
  imageUrls: string[] | null;
  summary: string;
  // Продолжение под кат "Читать" — дописывается сразу после summary, не
  // повторяя его. null — у тизеров без полного текста.
  summaryMore: string | null;
  publishedAt: string | null;
  // Место карточки в порядке ленты — время, по которому она отсортирована, с
  // точностью базы (микросекунды). Клиент передаёт его обратно курсором
  // подгрузки (см. FeedList.tsx). Не то же, что publishedAt: "Прочитанные"
  // отсортированы по времени прочтения, а не публикации.
  cursor: string | null;
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
    before?: { cursor: string; clusterId: number };
    // Обратный курсор — карточки НОВЕЕ указанной (лента подгружается и
    // вверх, когда открыта с запомненного места, см. FeedList.tsx).
    // Возвращает ближайшие к курсору, в обычном порядке ленты.
    after?: { cursor: string; clusterId: number };
    // Лента начиная с места этой карточки (включительно) — открытие на
    // запомненном месте (см. app/page.tsx). Сама карточка в выборку может и
    // не попасть (прочитана — см. unreadOnly), тогда первой идёт следующая за
    // ней. Сравнение с датой карточки делается в SQL: в JS-дате нет
    // микросекунд, и карточка могла бы не попасть в собственную выборку. Если
    // карточки уже нет в базе, выборка пустая.
    fromClusterId?: number;
    // Без userId (гость) isRead всегда false — сравнение ar.user_id = NULL
    // никогда не истинно в SQL.
    userId?: number | null;
    // Вкладка "Новые": только кластеры, которые пользователь ещё не отметил
    // прочитанными. У гостя (userId=null) отметок нет — фильтр ничего не
    // убирает.
    unreadOnly?: boolean;
    // Вкладка "Прочитанные": наоборот, только отмеченные. У гостя пусто.
    readOnly?: boolean;
  } = {}
): Promise<FeedItem[]> {
  const { limit = 30, category, before, after, fromClusterId, userId = null, unreadOnly = false, readOnly = false } = options;

  // category фильтрует статьи ДО группировки по cluster_id — т.к. все статьи
  // одного кластера описывают один инфоповод, категория у них должна
  // совпадать, но на случай расхождения так надёжнее, чем фильтровать уже
  // агрегированную карточку по одному произвольному значению. Статья может
  // относиться сразу к двум темам (см. CATEGORY_INSTRUCTIONS в
  // src/lib/prompt.ts), поэтому category — массив, и фильтр — вхождение, а
  // не равенство.
  //
  // visible_at IS NOT NULL — статьи идущего прямо сейчас прогона скрыты до его
  // конца и появляются одной пачкой (см. revealBatch в fetchAndProcess.ts).
  const params: unknown[] = [limit, userId];
  let categoryClause = "WHERE a.visible_at IS NOT NULL";
  if (category) {
    params.push(category);
    categoryClause += ` AND $${params.length} = ANY(a.category)`;
  }

  // Издания, выключенные пользователем на странице настроек (см.
  // user_hidden_sources в схеме): карточка остаётся, пока в кластере есть
  // хоть одна статья из включённого издания, — и главным источником, и в
  // "Также пишут" тогда показываются только включённые. Саммари при этом
  // берём с любой статьи кластера: у приклеенных статей своего саммари нет
  // (см. fetchAndProcess.ts), и выключенное издание не должно оставлять
  // карточку без текста.
  //
  // Кластер без единого саммари не показываем: карточка вышла бы без текста.
  // Так бывает, пока фетч обрабатывает статью (строка вставляется в базу до
  // саммаризации, см. fetchAndProcess.ts), и если прогон оборвался посередине
  // (реальный случай — пустая карточка Polygon от 24 сентября).
  const havingClauses: string[] = ["bool_or(h.user_id IS NULL)", "bool_or(a.ai_summary IS NOT NULL)"];
  // "Новые" идут по дате публикации, "Прочитанные" — по времени прочтения,
  // последнее прочитанное сверху. По дате публикации только что прочитанная
  // карточка вставала в список по своему возрасту и терялась среди сотен
  // прочитанных раньше: выглядело так, будто она туда не попала (DIS-39).
  const sortExpr = readOnly ? "max(ar.read_at)" : "max(a.published_at)";
  if (before) {
    havingClauses.push(
      `(${sortExpr}, a.cluster_id) < ($${params.push(before.cursor)}::timestamptz, $${params.push(before.clusterId)})`
    );
  }
  if (after) {
    havingClauses.push(
      `(${sortExpr}, a.cluster_id) > ($${params.push(after.cursor)}::timestamptz, $${params.push(after.clusterId)})`
    );
  }
  if (fromClusterId) {
    const n = params.push(fromClusterId);
    havingClauses.push(
      `(max(a.published_at), a.cluster_id) <= ((SELECT max(published_at) FROM articles WHERE cluster_id = $${n}), $${n})`
    );
  }
  if (unreadOnly) havingClauses.push("NOT bool_or(ar.user_id IS NOT NULL)");
  if (readOnly) havingClauses.push("bool_or(ar.user_id IS NOT NULL)");
  const direction = after ? "ASC" : "DESC";

  const { rows } = await pool.query(
    `
    SELECT
      a.cluster_id,
      -- Главное и продолжение — ПАРОЙ с одной статьи: продолжение написано
      -- как дополнение именно к своему главному, с чужим оно бы повторялось.
      -- Предпочитаем статью с продолжением (кластер мог начаться с тизера, а
      -- полный текст пришёл позже, см. fetchAndProcess.ts), иначе — первую.
      (array_agg(a.ai_summary ORDER BY a.ai_summary_more IS NULL, a.created_at ASC))[1] AS summary,
      (array_agg(a.ai_summary_more ORDER BY a.ai_summary_more IS NULL, a.created_at ASC))[1] AS summary_more,
      -- картинку/дату/издание берём с первой статьи в кластере
      -- (не все источники отдают og-теги — см. src/lib/ogTags.ts)
      (array_agg(a.image_url ORDER BY a.image_url NULLS LAST))[1] AS image_url,
      -- Дата карточки = дата САМОЙ СВЕЖЕЙ статьи в кластере — то же значение,
      -- по которому идёт сортировка ленты (см. ORDER BY ниже). Раньше дата
      -- бралась от первой добавленной в кластер статьи (ORDER BY created_at),
      -- а сортировка — от самой свежей: карточка могла всплыть наверх ленты
      -- из-за нового источника, но показывать дату многодневной давности —
      -- выглядело как "лента отсортирована неправильно".
      max(a.published_at) AS published_at,
      ${sortExpr} AS sort_at,
      to_char(${sortExpr} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor,
      (array_agg(s.name ORDER BY h.user_id IS NOT NULL, a.created_at ASC))[1] AS primary_source,
      (array_agg(s.homepage_url ORDER BY h.user_id IS NOT NULL, a.created_at ASC))[1] AS primary_homepage,
      (array_agg(a.link ORDER BY h.user_id IS NOT NULL, a.created_at ASC))[1] AS primary_link,
      jsonb_agg(DISTINCT jsonb_build_object('name', s.name, 'homepage', s.homepage_url, 'link', a.link))
        FILTER (WHERE h.user_id IS NULL) AS source_list,
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
      -- Тот же 2D-массив-через-array_agg капкан, что и у category выше —
      -- image_urls тоже TEXT[] на статью, коррелированный подзапрос вместо
      -- array_agg(...)[1].
      (
        SELECT a2.image_urls FROM articles a2
        WHERE a2.cluster_id = a.cluster_id AND a2.image_urls IS NOT NULL
        ORDER BY a2.created_at ASC
        LIMIT 1
      ) AS image_urls,
      bool_or(ar.user_id IS NOT NULL) AS is_read
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN article_reads ar ON ar.cluster_id = a.cluster_id AND ar.user_id = $2
    LEFT JOIN user_hidden_sources h ON h.source_id = a.source_id AND h.user_id = $2
    ${categoryClause}
    GROUP BY a.cluster_id
    HAVING ${havingClauses.join(" AND ")}
    ORDER BY sort_at ${direction}, a.cluster_id ${direction}
    LIMIT $1
    `,
    params
  );

  // pg возвращает timestamptz как объект Date, а не строку — приводим к ISO
  // сразу, чтобы дальше можно было сравнивать строки без сюрпризов.
  const toIso = (value: unknown): string | null =>
    value ? new Date(value as string | Date).toISOString() : null;

  const items = rows.map(
    (row): FeedItem => ({
      clusterId: row.cluster_id,
      imageUrl: row.image_url,
      imageUrls: row.image_urls,
      summary: row.summary,
      summaryMore: row.summary_more,
      publishedAt: toIso(row.published_at),
      cursor: row.cursor,
      primarySource: row.primary_source,
      primaryHomepage: row.primary_homepage,
      primaryLink: row.primary_link,
      sources: row.source_list as FeedSource[],
      category: row.category,
      isRead: row.is_read,
    })
  );
  return after ? items.reverse() : items;
}

// Сколько карточек появилось или обновилось после указанного момента — для
// плашки "N Новых" (см. FeedList.tsx). Считаем по времени появления статьи в
// ленте (visible_at — конец её прогона, см. revealBatch в fetchAndProcess.ts),
// а не по дате публикации: фетч часто приносит статьи, опубликованные раньше
// уже показанных, и по дате они встали бы ниже верха ленты незамеченными.
// Кластеры только из выключенных изданий и без саммари не считаются — их в
// ленте нет (см. getFeed). Прочитанные тоже: новая статья в уже прочитанном
// кластере его не возвращает во вкладку "Новые", и плашка обещала бы больше
// карточек, чем покажет.
export async function getNewCount(options: {
  since: string;
  category?: string;
  userId?: number | null;
}): Promise<number> {
  const params: unknown[] = [options.userId ?? null, options.since];
  const categoryClause = options.category ? `AND $${params.push(options.category)} = ANY(a.category)` : "";
  const { rows } = await pool.query(
    `
    SELECT count(*) AS count FROM (
      SELECT a.cluster_id
      FROM articles a
      LEFT JOIN article_reads ar ON ar.cluster_id = a.cluster_id AND ar.user_id = $1
      LEFT JOIN user_hidden_sources h ON h.source_id = a.source_id AND h.user_id = $1
      WHERE a.visible_at IS NOT NULL ${categoryClause}
      GROUP BY a.cluster_id
      HAVING bool_or(h.user_id IS NULL) AND bool_or(a.ai_summary IS NOT NULL) AND NOT bool_or(ar.user_id IS NOT NULL)
         AND max(a.visible_at) > $2::timestamptz
    ) fresh
    `,
    params
  );
  return Number(rows[0].count);
}

// Счётчик рядом с вкладкой "Новые" (см. FeedTabs.tsx) — по открытой рубрике,
// без рубрики — по всей ленте (DIS-38). Кластеры только из выключенных
// изданий, без саммари и ещё скрытые до конца прогона не считаются — их в
// ленте нет (см. getFeed).
export async function getUnreadCount(userId: number | null, category?: string): Promise<number> {
  const params: unknown[] = [userId];
  const categoryClause = category ? `AND $${params.push(category)} = ANY(a.category)` : "";
  const { rows } = await pool.query(
    `
    SELECT count(*) AS count FROM (
      SELECT a.cluster_id
      FROM articles a
      LEFT JOIN article_reads ar ON ar.cluster_id = a.cluster_id AND ar.user_id = $1
      LEFT JOIN user_hidden_sources h ON h.source_id = a.source_id AND h.user_id = $1
      WHERE a.visible_at IS NOT NULL ${categoryClause}
      GROUP BY a.cluster_id
      HAVING NOT bool_or(ar.user_id IS NOT NULL) AND bool_or(h.user_id IS NULL) AND bool_or(a.ai_summary IS NOT NULL)
    ) unread
    `,
    params
  );
  return Number(rows[0].count);
}
