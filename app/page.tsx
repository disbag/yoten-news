import { cookies } from "next/headers";
import { getFeed } from "../src/lib/feed";
import { getSessionUserId } from "../src/lib/session";
import { CATEGORIES } from "../src/config/categories";
import { FEED_PAGE_SIZE, positionCookieName } from "../src/lib/feedPosition";
import FeedList from "./components/FeedList";
import Sidebar from "./components/Sidebar";
import MobileChrome from "./components/MobileChrome";

export const dynamic = "force-dynamic";

export default async function HomePage(props: { searchParams: Promise<{ category?: string }> }) {
  const searchParams = await props.searchParams;
  const activeCategory = CATEGORIES.find((c) => c.id === searchParams.category);
  const userId = await getSessionUserId();
  const isLoggedIn = userId !== null;
  const category = activeCategory?.id;

  // Момент ДО запроса ленты — см. такой же в app/api/feed/route.ts.
  const loadedAt = new Date().toISOString();
  // На единицу больше лимита — чтобы понять, есть ли ещё карточки для
  // подгрузки (см. FeedList.tsx), без отдельного count-запроса.
  const limit = FEED_PAGE_SIZE + 1;

  // Лента открывается на карточке, на которой пользователь остановился в
  // прошлый раз (см. src/lib/feedPosition.ts), даже если сверху появились
  // новые. Если этой карточки больше нет (давно не заходил, она удалена по
  // сроку хранения) или она не проходит нынешний фильтр — обычный верх ленты.
  const savedId = Number((await cookies()).get(positionCookieName(category))?.value);
  let rows = savedId > 0 ? await getFeed({ category, limit, userId, fromClusterId: savedId }) : [];
  const restored = rows[0]?.clusterId === savedId;
  if (!restored) rows = await getFeed({ category, limit, userId });

  return (
    <div className="shell">
      <div className="mobile-only">
        <MobileChrome activeCategory={category} isLoggedIn={isLoggedIn} />
      </div>
      <div className="desktop-only">
        <Sidebar activeCategory={category} isLoggedIn={isLoggedIn} />
      </div>

      <main>
        {/* key пересоздаёт ленту при смене рубрики — иначе useState внутри
            неё не подхватит новые initial*-пропсы от сервера, и список
            карточек останется от предыдущего фильтра. */}
        <FeedList
          key={category ?? "all"}
          initialItems={rows.slice(0, FEED_PAGE_SIZE)}
          initialHasOlder={rows.length > FEED_PAGE_SIZE}
          restored={restored}
          loadedAt={loadedAt}
          category={category}
          trackReads={isLoggedIn}
        />
      </main>
    </div>
  );
}
