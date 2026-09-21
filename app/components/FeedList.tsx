"use client";

import { useState } from "react";
import type { FeedItem } from "../../src/lib/feed";
import FeedCard from "./FeedCard";

const PAGE_SIZE = 30;

export default function FeedList({
  initialItems,
  initialHasMore,
  category,
  unreadOnly,
}: {
  initialItems: FeedItem[];
  initialHasMore: boolean;
  category?: string;
  unreadOnly?: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);

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
      if (unreadOnly) params.set("unread", "1");
      const res = await fetch(`/api/feed?${params}`);
      const data: { items: FeedItem[]; hasMore: boolean } = await res.json();
      setItems((prev) => [...prev, ...data.items]);
      setHasMore(data.hasMore);
    } finally {
      setLoading(false);
    }
  }

  // В режиме "только непрочитанные" карточка, которую только что открыли
  // (см. onRead в FeedCard), должна тут же пропасть из ленты — иначе
  // прочитанное продолжает висеть в списке, специально отфильтрованном под
  // непрочитанное, до следующей перезагрузки страницы.
  function handleRead(clusterId: number) {
    if (unreadOnly) setItems((prev) => prev.filter((item) => item.clusterId !== clusterId));
  }

  return (
    <>
      <div className="card-list">
        {items.map((item) => (
          <FeedCard key={item.clusterId} item={item} onRead={handleRead} />
        ))}
      </div>

      {hasMore && (
        <div className="load-more">
          <button onClick={loadMore} disabled={loading}>
            {loading ? "Загрузка…" : "Показать ещё"}
          </button>
        </div>
      )}

      <style jsx>{`
        .load-more {
          text-align: center;
          margin-top: 36px;
        }
        button {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 0.78rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-dim);
          background: none;
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 10px 24px;
          cursor: pointer;
        }
        button:hover:not(:disabled) {
          color: var(--accent);
          border-color: var(--accent);
        }
        button:disabled {
          cursor: default;
          opacity: 0.6;
        }
      `}</style>
    </>
  );
}
