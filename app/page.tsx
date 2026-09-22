import { getFeed, getUnreadCount } from "../src/lib/feed";
import { getSessionUserId } from "../src/lib/session";
import { CATEGORIES } from "../src/config/categories";
import FeedList from "./components/FeedList";
import FeedTabs from "./components/FeedTabs";
import Sidebar from "./components/Sidebar";
import MobileChrome from "./components/MobileChrome";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

export default async function HomePage({
  searchParams,
}: {
  searchParams: { category?: string; tab?: string };
}) {
  const activeCategory = CATEGORIES.find((c) => c.id === searchParams.category);
  const tab: "new" | "read" = searchParams.tab === "read" ? "read" : "new";
  const userId = await getSessionUserId();
  // На единицу больше лимита — чтобы понять, есть ли ещё карточки для кнопки
  // "Показать ещё" (см. FeedList.tsx), без отдельного count-запроса.
  const [rows, unreadCount] = await Promise.all([
    getFeed({
      category: activeCategory?.id,
      limit: PAGE_SIZE + 1,
      userId,
      unreadOnly: tab === "new",
      readOnly: tab === "read",
    }),
    getUnreadCount(userId),
  ]);
  const hasMore = rows.length > PAGE_SIZE;
  const feed = rows.slice(0, PAGE_SIZE);

  return (
    <div className="shell">
      <div className="mobile-only">
        <MobileChrome activeCategory={activeCategory?.id} />
      </div>
      <div className="desktop-only">
        <Sidebar activeCategory={activeCategory?.id} />
      </div>

      <main>
        <FeedTabs tab={tab} category={activeCategory?.id} unreadCount={unreadCount} />

        {/* key заставляет React пересоздать компонент (и его внутренний стейт
            items/hasMore) при смене категории/таба — иначе при клике по
            фильтру React переиспользует тот же экземпляр FeedList,
            initialItems в пропсах меняется, а useState(initialItems) это
            игнорирует (стейт инициализируется только при монтировании), и
            лента визуально не обновляется без полной перезагрузки страницы. */}
        <FeedList
          key={`${activeCategory?.id ?? "all"}:${tab}`}
          initialItems={feed}
          initialHasMore={hasMore}
          category={activeCategory?.id}
          tab={tab}
        />
      </main>
    </div>
  );
}
