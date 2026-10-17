import { pool } from "./db.js";
import { dedupeImages } from "./imageDedupe.js";

// Лента с тредами (DIS-36) — пока только на тестовой выкладке Vercel
// (preview) и локально с THREADS_VIEW=1. На продакшене карточки идут как
// раньше, по одной на инфоповод, хотя сбор уже раскладывает их по тредам.
export const THREADS_VIEW = process.env.VERCEL_ENV === "preview" || process.env.THREADS_VIEW === "1";

// Карточка, продолжающая тред (DIS-36): показывается под первой карточкой
// треда — издание, время и только то новое, что она добавила к треду.
export type ThreadPost = {
  clusterId: number;
  source: string;
  homepage: string | null;
  link: string;
  publishedAt: string | null;
  // Новое по сравнению с тредом; null — нового модель не нашла.
  text: string | null;
  isRead: boolean;
};

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
  // Своя картинка главного издания — для превью ссылки на пост (og:image, см.
  // app/post/[id]/page.tsx). Обложка карточки может быть с другой статьи, если
  // галерея есть только у неё.
  primaryImageUrl: string | null;
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
  // Только в ленте с тредами (THREADS_VIEW): остальные карточки треда по
  // порядку появления и номер позиции треда для курсора подгрузки
  // (отрицательный — номер треда со знаком минус, чтобы не пересекаться с
  // номерами карточек).
  // clusterIds — все карточки треда, включая склеенные с первой (без новых
  // подробностей, см. assembleThreads): прочтение отмечает их все.
  thread?: { id: number; posts: ThreadPost[]; clusterIds: number[] };
  cursorId?: number;
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
    // Одна карточка — та, в которой сейчас лежит эта статья (страница поста,
    // см. getPost).
    articleId?: number;
    // Только в ленте с тредами: одна позиция ленты — тред (номер со знаком
    // минус) или карточка (см. getPost).
    unit?: number;
  } = {}
): Promise<FeedItem[]> {
  const {
    limit = 30,
    category,
    before,
    after,
    fromClusterId,
    userId = null,
    unreadOnly = false,
    readOnly = false,
    articleId,
    unit,
  } = options;

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
  // Позиция в ленте: тред целиком (номер треда со знаком минус) или карточка.
  const threads = THREADS_VIEW && !articleId;
  const unitExpr = threads ? "COALESCE(-tp.thread_id, a.cluster_id)" : "a.cluster_id";
  const threadJoin = threads
    ? "LEFT JOIN thread_posts tp ON tp.cluster_id = a.cluster_id AND tp.thread_id IS NOT NULL"
    : "";
  let categoryClause = "WHERE a.visible_at IS NOT NULL";
  if (threads && unit) {
    params.push(unit);
    categoryClause += ` AND ${unitExpr} = $${params.length}`;
  }
  if (category) {
    params.push(category);
    categoryClause += ` AND $${params.length} = ANY(a.category)`;
  }
  if (articleId) {
    params.push(articleId);
    categoryClause += ` AND a.cluster_id = (SELECT cluster_id FROM articles WHERE id = $${params.length})`;
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
      `(${sortExpr}, ${unitExpr}) < ($${params.push(before.cursor)}::timestamptz, $${params.push(before.clusterId)})`
    );
  }
  if (after) {
    havingClauses.push(
      `(${sortExpr}, ${unitExpr}) > ($${params.push(after.cursor)}::timestamptz, $${params.push(after.clusterId)})`
    );
  }
  if (fromClusterId && threads) {
    // Запомненная карточка могла с тех пор попасть в тред — открываем с места
    // треда.
    const n = params.push(fromClusterId);
    const unitOf = `COALESCE(-(SELECT thread_id FROM thread_posts WHERE cluster_id = $${n} AND thread_id IS NOT NULL), $${n})`;
    havingClauses.push(
      `(max(a.published_at), ${unitExpr}) <= ((SELECT max(x.published_at) FROM articles x
         LEFT JOIN thread_posts t ON t.cluster_id = x.cluster_id AND t.thread_id IS NOT NULL
         WHERE COALESCE(-t.thread_id, x.cluster_id) = ${unitOf}), ${unitOf})`
    );
  } else if (fromClusterId) {
    const n = params.push(fromClusterId);
    havingClauses.push(
      `(max(a.published_at), a.cluster_id) <= ((SELECT max(published_at) FROM articles WHERE cluster_id = $${n}), $${n})`
    );
  }
  // Тред остаётся во "Новых", пока в нём есть непрочитанная карточка.
  if (unreadOnly) havingClauses.push(threads ? "bool_or(ar.user_id IS NULL)" : "NOT bool_or(ar.user_id IS NOT NULL)");
  if (readOnly) havingClauses.push("bool_or(ar.user_id IS NOT NULL)");
  const direction = after ? "ASC" : "DESC";

  // Два шага (DIS-54): сначала отбираем нужные карточки по одной дате на
  // кластер — это дёшево, — и только для них собираем тексты, источники и
  // картинки. В один шаг база собирала все ~4 тысячи карточек целиком (около
  // секунды на запрос) и выбрасывала всё, кроме двадцати. Второй шаг
  // повторяет условия первого (рубрика, видимость, настройки читателя), чтобы
  // в карточку попали те же статьи, что и раньше.
  const { rows } = await pool.query(
    `
    WITH picked AS (
      SELECT ${unitExpr} AS unit
      FROM articles a
      LEFT JOIN article_reads ar ON ar.cluster_id = a.cluster_id AND ar.user_id = $2
      LEFT JOIN user_hidden_sources h ON h.source_id = a.source_id AND h.user_id = $2
      ${threadJoin}
      ${categoryClause}
      GROUP BY ${unitExpr}
      HAVING ${havingClauses.join(" AND ")}
      ORDER BY ${sortExpr} ${direction}, ${unitExpr} ${direction}
      LIMIT $1
    ), cards AS (
    SELECT
      a.cluster_id,
      ${threads ? "max(tp.thread_id) AS thread_id, max(tp.new_details) AS new_details, min(a.created_at) AS first_created," : ""}
      -- Главное и продолжение — ПАРОЙ с одной статьи: продолжение написано
      -- как дополнение именно к своему главному, с чужим оно бы повторялось.
      -- Предпочитаем статью с продолжением (кластер мог начаться с тизера, а
      -- полный текст пришёл позже, см. fetchAndProcess.ts), иначе — первую.
      (array_agg(a.ai_summary ORDER BY a.ai_summary_more IS NULL, a.created_at ASC))[1] AS summary,
      (array_agg(a.ai_summary_more ORDER BY a.ai_summary_more IS NULL, a.created_at ASC))[1] AS summary_more,
      -- Статья, чьи обложка и галерея идут в карточку (DIS-62): та, что даёт
      -- главное издание (порядок как у primary_source ниже), — если у неё
      -- есть картинка; иначе следующая с картинкой. Галерея важнее: если она
      -- есть хоть у одной статьи, берётся статья с галереей — иначе половина
      -- карточек с галереей (104 из 206 на 14 октября) показывала бы одно
      -- фото. Обложка и кадры всегда с одной статьи. Раньше обложка была
      -- первой по алфавиту ссылкой кластера — часто от другого издания.
      -- Выключенные читателем издания — в последнюю очередь, как и для текста.
      (array_agg(a.id ORDER BY h.user_id IS NOT NULL, coalesce(cardinality(a.image_urls), 0) < 2,
        a.image_url IS NULL, a.created_at ASC))[1] AS visual_id,
      -- Своя картинка главного издания (может не быть) — для превью ссылки
      -- в мессенджерах: там подписано издание, и фото должно быть его.
      (array_agg(a.image_url ORDER BY h.user_id IS NOT NULL, a.created_at ASC))[1] AS primary_image_url,
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
      bool_or(ar.user_id IS NOT NULL) AS is_read
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN article_reads ar ON ar.cluster_id = a.cluster_id AND ar.user_id = $2
    LEFT JOIN user_hidden_sources h ON h.source_id = a.source_id AND h.user_id = $2
    ${threadJoin}
    JOIN picked p ON p.unit = ${unitExpr}
    ${categoryClause}
    GROUP BY a.cluster_id
    -- В треде отбор был по треду целиком — карточку без текста или только из
    -- выключенных изданий внутри треда отсекаем здесь.
    ${threads ? "HAVING bool_or(h.user_id IS NULL) AND bool_or(a.ai_summary IS NOT NULL)" : ""}
    )
    -- image_urls — TEXT[] на статью, через array_agg его не достать (тот же
    -- капкан, что у category выше), поэтому картинки берём отдельно по
    -- visual_id.
    SELECT c.*, v.image_url, v.image_urls
    FROM cards c
    LEFT JOIN articles v ON v.id = c.visual_id
    ORDER BY c.sort_at ${direction}, c.cluster_id ${direction}
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
      primaryImageUrl: row.primary_image_url,
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
  const ordered = threads ? await assembleThreads(rows, items, direction) : items;
  return after ? ordered.reverse() : ordered;
}

// Собирает карточки одного треда в один элемент ленты (DIS-36): первая
// карточка треда — сверху целиком, остальные — постами под ней. Галерея треда
// — фото первой карточки и обложки остальных без повторов (по отпечаткам, см.
// imageHash.ts); обложка — первое фото треда. Позиция в ленте — по самой
// свежей карточке.
async function assembleThreads(
  rows: { cluster_id: number; thread_id: number | null; new_details: string | null; first_created: Date; sort_at: Date | null }[],
  items: FeedItem[],
  direction: "ASC" | "DESC"
): Promise<FeedItem[]> {
  const meta = new Map(rows.map((r) => [r.cluster_id, r]));
  const units = new Map<number, FeedItem[]>();
  for (const item of items) {
    const threadId = meta.get(item.clusterId)?.thread_id;
    const key = threadId ? -threadId : item.clusterId;
    units.set(key, [...(units.get(key) ?? []), item]);
  }

  const threadImages = [...units.values()]
    .filter((group) => group.length > 1)
    .flatMap((group) => group.flatMap((i) => i.imageUrls ?? (i.imageUrl ? [i.imageUrl] : [])));
  const hashes = new Map<string, string | null>();
  if (threadImages.length) {
    const { rows: hashRows } = await pool.query("SELECT url, hash FROM image_hashes WHERE url = ANY($1)", [threadImages]);
    for (const r of hashRows) hashes.set(r.url, r.hash);
  }

  const time = (item: FeedItem) => meta.get(item.clusterId)?.sort_at?.getTime() ?? 0;
  const result: { item: FeedItem; sort: number; unit: number }[] = [];
  for (const [unit, group] of units) {
    if (group.length === 1) {
      result.push({ item: group[0], sort: time(group[0]), unit });
      continue;
    }
    const byAppearance = [...group].sort(
      (a, b) => meta.get(a.clusterId)!.first_created.getTime() - meta.get(b.clusterId)!.first_created.getTime()
    );
    const [root, ...rest] = byAppearance;
    // Карточка без новых подробностей — по сути ещё одна статья о том же:
    // вместо пустого поста «Без новых подробностей» её издания идут в
    // «Также пишут» первой карточки, как у обычной склейки.
    const posts = rest.filter((i) => meta.get(i.clusterId)?.new_details);
    const glued = rest.filter((i) => !meta.get(i.clusterId)?.new_details);
    const sources = [...root.sources];
    for (const source of glued.flatMap((i) => i.sources)) {
      if (!sources.some((s) => s.link === source.link)) sources.push(source);
    }
    const newest = group.reduce((best, item) => (time(item) > time(best) ? item : best));
    // От первой карточки — вся её галерея, от остальных — только обложка.
    // Галерея у карточки бывает и не про её историю: у дайджеста Guardian
    // «First Thing» это фото всех сюжетов дня (16 октября в тред о стрельбе в
    // школе в Орегоне попали фото других новостей), а обложка — фото главного
    // сюжета, того, по которому карточка и попала в тред.
    const images = dedupeImages(
      [
        ...(root.imageUrls ?? (root.imageUrl ? [root.imageUrl] : [])),
        ...rest.flatMap((i) => (i.imageUrl ? [i.imageUrl] : [])),
      ],
      hashes
    );
    result.push({
      unit,
      sort: time(newest),
      item: {
        ...root,
        imageUrl: images[0] ?? null,
        imageUrls: images.length > 1 ? images : null,
        publishedAt: newest.publishedAt,
        cursor: newest.cursor,
        cursorId: unit,
        sources,
        isRead: group.every((i) => i.isRead),
        thread: {
          id: -unit,
          clusterIds: group.map((i) => i.clusterId),
          posts: posts.map((i) => ({
            clusterId: i.clusterId,
            source: i.primarySource,
            homepage: i.primaryHomepage,
            link: i.primaryLink,
            publishedAt: i.publishedAt,
            text: meta.get(i.clusterId)?.new_details ?? null,
            isRead: i.isRead,
          })),
        },
      },
    });
  }
  const sign = direction === "DESC" ? -1 : 1;
  return result.sort((a, b) => sign * (a.sort - b.sort) || sign * (a.unit - b.unit)).map((r) => r.item);
}

// Одна карточка для страницы поста (/post/<id>, DIS-20). В ссылке — номер
// статьи, с которой карточка началась (он же clusterId в ленте), а ищем по
// статье, а не по номеру карточки: если карточку позже приклеили к другой,
// её статьи переехали, и старая ссылка открывает объединённую карточку.
// Настройки читателя не учитываются: пост по ссылке одинаковый для всех,
// включая издания, которые открывший выключил у себя в ленте.
export async function getPost(articleId: number): Promise<FeedItem | null> {
  if (THREADS_VIEW) {
    // В ленте с тредами пост — весь тред, в котором лежит карточка статьи.
    const { rows } = await pool.query(
      `SELECT COALESCE(-tp.thread_id, a.cluster_id) AS unit FROM articles a
       LEFT JOIN thread_posts tp ON tp.cluster_id = a.cluster_id AND tp.thread_id IS NOT NULL
       WHERE a.id = $1`,
      [articleId]
    );
    if (!rows[0]) return null;
    const [item] = await getFeed({ unit: rows[0].unit, limit: 1 });
    return item ?? null;
  }
  const [item] = await getFeed({ articleId, limit: 1 });
  return item ?? null;
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
