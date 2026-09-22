"use client";

import { useState } from "react";
import type { FeedItem } from "../../src/lib/feed";
import FeedTabs from "./FeedTabs";
import FeedList from "./FeedList";

// Объединяет табы и ленту в одном клиентском компоненте — счётчик
// непрочитанных должен уменьшаться сразу при отметке статьи прочитанной
// (см. onNewlyRead в FeedList), а не только при следующей полной
// перезагрузке страницы. Раньше FeedTabs и FeedList жили отдельно прямо в
// app/page.tsx (серверном компоненте), и у них не было общего состояния,
// через которое можно было бы прокинуть живое обновление счётчика.
export default function FeedShell({
  tab,
  category,
  initialUnreadCount,
  initialItems,
  initialHasMore,
}: {
  tab: "new" | "read";
  category?: string;
  initialUnreadCount: number;
  initialItems: FeedItem[];
  initialHasMore: boolean;
}) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);

  // Декремент — только на вкладке "Новые": там onRead реально означает
  // "статья только что стала прочитанной", то есть непрочитанных стало на
  // одну меньше. На вкладке "Прочитанные" всё и так уже прочитано, там
  // декрементировать нечего.
  function handleNewlyRead() {
    if (tab === "new") setUnreadCount((count) => Math.max(0, count - 1));
  }

  return (
    <>
      <FeedTabs tab={tab} category={category} unreadCount={unreadCount} />

      {/* Пересоздание при смене категории/таба обеспечивает key на самом
          FeedShell (см. app/page.tsx) — он размонтирует и этот FeedList
          вместе с собой, так что отдельный key здесь не нужен. */}
      <FeedList
        initialItems={initialItems}
        initialHasMore={initialHasMore}
        category={category}
        tab={tab}
        onNewlyRead={handleNewlyRead}
      />
    </>
  );
}
