import { getFeed, getUnreadCount } from "../src/lib/feed";
import { getSessionUserId } from "../src/lib/session";
import { CATEGORIES } from "../src/config/categories";
import FeedShell from "./components/FeedShell";
import Sidebar from "./components/Sidebar";
import MobileChrome from "./components/MobileChrome";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

export default async function HomePage(props: {
  searchParams: Promise<{ category?: string; tab?: string }>;
}) {
  const searchParams = await props.searchParams;
  const activeCategory = CATEGORIES.find((c) => c.id === searchParams.category);
  const userId = await getSessionUserId();
  const isLoggedIn = userId !== null;
  // Табы "Новые/Прочитанные" и отметка прочитанного — только для вошедших:
  // гостю прочитанное всё равно негде хранить (/api/reads для userId=null —
  // no-op), и раньше оно лишь локально гасло при скролле и возвращалось после
  // перезагрузки. Гость видит просто всю ленту; ?tab=read ему не показываем
  // (для userId=null это всегда пустой список).
  const tab: "new" | "read" = isLoggedIn && searchParams.tab === "read" ? "read" : "new";
  // На единицу больше лимита — чтобы понять, есть ли ещё карточки для
  // автоподгрузки по скроллу (см. FeedList.tsx), без отдельного count-запроса.
  const [rows, unreadCount] = await Promise.all([
    getFeed({
      category: activeCategory?.id,
      limit: PAGE_SIZE + 1,
      userId,
      unreadOnly: tab === "new",
      readOnly: tab === "read",
    }),
    isLoggedIn ? getUnreadCount(userId) : 0,
  ]);
  const hasMore = rows.length > PAGE_SIZE;
  const feed = rows.slice(0, PAGE_SIZE);

  return (
    <div className="shell">
      <div className="mobile-only">
        <MobileChrome activeCategory={activeCategory?.id} isLoggedIn={isLoggedIn} />
      </div>
      <div className="desktop-only">
        <Sidebar activeCategory={activeCategory?.id} isLoggedIn={isLoggedIn} />
      </div>

      <main>
        {/* key пересоздаёт весь FeedShell (табы + лента + счётчик
            непрочитанных) при смене категории/таба — иначе useState
            внутри него не подхватит новые initial*-пропсы от сервера,
            а старый (уменьшившийся по ходу скролла) счётчик и список
            карточек останутся от предыдущего фильтра. */}
        <FeedShell
          key={`${activeCategory?.id ?? "all"}:${tab}`}
          tab={tab}
          trackReads={isLoggedIn}
          category={activeCategory?.id}
          initialUnreadCount={unreadCount}
          initialItems={feed}
          initialHasMore={hasMore}
        />
      </main>
    </div>
  );
}
