import { NextRequest, NextResponse } from "next/server";
import { getFeed, getNewCount, getUnreadCount } from "../../../src/lib/feed";
import { getSessionUserId } from "../../../src/lib/session";
import { FEED_PAGE_SIZE } from "../../../src/lib/feedPosition";

function cursor(searchParams: URLSearchParams, prefix: "before" | "after") {
  const publishedAt = searchParams.get(`${prefix}PublishedAt`);
  const clusterId = Number(searchParams.get(`${prefix}ClusterId`));
  return publishedAt && clusterId ? { publishedAt, clusterId } : undefined;
}

// Подгрузка ленты (см. app/components/FeedList.tsx): вниз — before*, вверх —
// after*, без курсора — верх ленты. Отдельный режим ?newSince=<время> — только
// число новых карточек для плашки "N Новых".
//
// Запрашиваем на одну карточку больше limit, чтобы понять, есть ли ещё
// данные, без отдельного count-запроса.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") ?? undefined;
  const userId = await getSessionUserId();
  // tab=read — вкладка "Прочитанные", иначе "Новые" (непрочитанные). У гостя
  // вкладок нет (см. app/page.tsx) — всегда вся лента.
  const readOnly = userId !== null && searchParams.get("tab") === "read";

  const newSince = searchParams.get("newSince");
  if (newSince) {
    if (Number.isNaN(Date.parse(newSince))) return NextResponse.json({ error: "newSince" }, { status: 400 });
    return NextResponse.json({ count: await getNewCount({ since: newSince, category, userId }) });
  }

  // Без потолка ?limit=5000 отдавал ~8 МБ за один запрос — дешёвый способ
  // нагрузить базу.
  const requested = Number(searchParams.get("limit") ?? FEED_PAGE_SIZE);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 50) : FEED_PAGE_SIZE;
  const before = cursor(searchParams, "before");
  const after = before ? undefined : cursor(searchParams, "after");

  // Момент ДО запроса: клиент запоминает его как "всё до этого времени я
  // видел" (см. markSeen в FeedList.tsx), и статья, попавшая в базу во время
  // запроса, не должна потеряться для счётчика новых.
  const now = new Date().toISOString();
  const rows = await getFeed({ category, limit: limit + 1, before, after, userId, unreadOnly: !readOnly, readOnly });
  const hasMore = rows.length > limit;
  // Лишняя карточка — самая дальняя от курсора: у подгрузки вверх она первая.
  const items = hasMore ? (after ? rows.slice(1) : rows.slice(0, limit)) : rows;

  // Верх ленты запрашивают по плашке "N Новых" — заодно отдаём свежий
  // счётчик непрочитанных для вкладки.
  const unreadCount = !before && !after && userId !== null ? await getUnreadCount(userId) : undefined;

  return NextResponse.json({ items, hasMore, now, unreadCount });
}
