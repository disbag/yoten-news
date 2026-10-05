import { cookies } from "next/headers";
import { getFeed, getUnreadCount } from "../src/lib/feed";
import { getSessionUserId } from "../src/lib/session";
import { CATEGORIES } from "../src/config/categories";
import { FEED_PAGE_SIZE, positionCookieName } from "../src/lib/feedPosition";
import FeedList from "./components/FeedList";
import Sidebar from "./components/Sidebar";
import MobileChrome from "./components/MobileChrome";

export const dynamic = "force-dynamic";

export default async function HomePage(props: { searchParams: Promise<{ category?: string; tab?: string }> }) {
  const searchParams = await props.searchParams;
  const activeCategory = CATEGORIES.find((c) => c.id === searchParams.category);
  const userId = await getSessionUserId();
  const isLoggedIn = userId !== null;
  const category = activeCategory?.id;
  // Вкладки "Новые/Прочитанные" и отметка прочитанного — только для вошедших:
  // гостю прочитанное негде хранить (/api/reads для userId=null — no-op).
  // Гость видит просто всю ленту.
  const tab: "new" | "read" = isLoggedIn && searchParams.tab === "read" ? "read" : "new";

  // Момент ДО запроса ленты — см. такой же в app/api/feed/route.ts.
  const loadedAt = new Date().toISOString();
  // На единицу больше лимита — чтобы понять, есть ли ещё карточки для
  // подгрузки (см. FeedList.tsx), без отдельного count-запроса.
  const filter = { category, limit: FEED_PAGE_SIZE + 1, userId, unreadOnly: tab === "new", readOnly: tab === "read" };

  // "Новые" открываются с места, на котором пользователь остановился в прошлый
  // раз (см. src/lib/feedPosition.ts), даже если сверху появились новые, — но
  // уже без прочитанного: первой идёт следующая непрочитанная карточка, начиная
  // с запомненной. Если запомненной карточки больше нет в базе (давно не
  // заходил) или ниже неё всё прочитано — обычный верх ленты.
  const savedId = tab === "new" ? Number((await cookies()).get(positionCookieName(category))?.value) : 0;
  const [restoredRows, unreadCount] = await Promise.all([
    savedId > 0 ? getFeed({ ...filter, fromClusterId: savedId }) : [],
    isLoggedIn ? getUnreadCount(userId) : 0,
  ]);
  const restored = restoredRows.length > 0;
  const rows = restored ? restoredRows : await getFeed(filter);

  return (
    <div className="shell">
      <div className="mobile-only">
        <MobileChrome activeCategory={category} isLoggedIn={isLoggedIn} />
      </div>
      <div className="desktop-only">
        <Sidebar activeCategory={category} isLoggedIn={isLoggedIn} />
      </div>

      <main>
        {/* key пересоздаёт ленту при смене рубрики или вкладки — иначе
            useState внутри неё не подхватит новые initial*-пропсы от сервера,
            и список карточек останется от предыдущего фильтра. */}
        <FeedList
          key={`${category ?? "all"}:${tab}`}
          initialItems={rows.slice(0, FEED_PAGE_SIZE)}
          initialHasOlder={rows.length > FEED_PAGE_SIZE}
          restored={restored}
          loadedAt={loadedAt}
          category={category}
          tab={tab}
          trackReads={isLoggedIn}
          initialUnreadCount={unreadCount}
        />
      </main>
    </div>
  );
}
