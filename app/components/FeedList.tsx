"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedItem } from "../../src/lib/feed";
import FeedCard from "./FeedCard";

const PAGE_SIZE = 30;

export default function FeedList({
  initialItems,
  initialHasMore,
  category,
  tab,
  trackReads,
}: {
  initialItems: FeedItem[];
  initialHasMore: boolean;
  category?: string;
  tab: "new" | "read";
  trackReads: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  async function loadMore() {
    if (items.length === 0) return;
    setLoading(true);
    try {
      const last = items[items.length - 1];
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        beforePublishedAt: last.publishedAt ?? "",
        beforeClusterId: String(last.clusterId),
      });
      if (category) params.set("category", category);
      if (tab === "read") params.set("tab", "read");
      const res = await fetch(`/api/feed?${params}`);
      const data: { items: FeedItem[]; hasMore: boolean } = await res.json();
      setItems((prev) => [...prev, ...data.items]);
      setHasMore(data.hasMore);
    } finally {
      setLoading(false);
    }
  }

  // Подгрузка по скроллу вместо кнопки "Показать ещё" — сентинел-элемент
  // внизу списка, срабатывает чуть заранее (rootMargin), пока пользователь
  // ещё не долистал до самого низа, чтобы следующая страница успела
  // подгрузиться без видимой паузы.
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "600px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMore читает актуальные items/category/tab через замыкание на каждый ре-рендер; пересоздавать observer при каждом изменении items не нужно
  }, [hasMore]);

  return (
    <>
      <div className="card-list">
        {items.map((item) => (
          <FeedCard key={item.clusterId} item={item} trackReads={trackReads} />
        ))}
      </div>

      {hasMore && <div ref={sentinelRef} className="sentinel" />}

      <style jsx>{`
        .sentinel {
          height: 1px;
        }
      `}</style>
    </>
  );
}
