"use client";

import { useEffect, useState } from "react";
import type { FeedItem } from "../../src/lib/feed";
import { categoryLabels } from "../../src/config/categories";
import ArticleModal from "./ArticleModal";

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

function faviconUrl(homepage: string | null): string | null {
  if (!homepage) return null;
  try {
    const { hostname } = new URL(homepage);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
  } catch {
    return null;
  }
}

export default function FeedCard({ item }: { item: FeedItem }) {
  const [open, setOpen] = useState(false);
  const favicon = faviconUrl(item.primaryHomepage);
  const category = categoryLabels(item.category);

  // timeAgo зависит от Date.now() — на сервере и при гидратации на клиенте
  // это разные моменты времени, и если между ними "перевалило" через минуту
  // (с точностью до часа такое почти не случалось, с минутами — регулярно),
  // React ругается на несовпадение текста при гидратации. Считаем дату
  // только на клиенте, после монтирования: на сервере/при гидратации рендерим
  // пустую строку (гарантированно совпадает), а сразу после — настоящую дату.
  const [dateLabel, setDateLabel] = useState("");
  useEffect(() => {
    setDateLabel(timeAgo(item.publishedAt));
  }, [item.publishedAt]);

  return (
    <article className="card">
      <div className="body">
        <div className="attribution">
          {favicon ? (
            // eslint-disable-next-line @next/next/no-img-element -- фавиконки с произвольных доменов изданий
            <img src={favicon} alt="" className="favicon" />
          ) : (
            <span className="favicon favicon-placeholder" />
          )}
          <div className="attribution-text">
            <div className="source-row">
              <a
                href={item.primaryLink}
                target="_blank"
                rel="noopener noreferrer"
                className="source-name"
                onClick={(e) => e.stopPropagation()}
              >
                {item.primarySource}
              </a>
              {item.sources.length > 1 && (
                <span className="badge">+{item.sources.length - 1} источника</span>
              )}
            </div>
            <span className="date">
              {category ? `${category} • ` : ""}
              {dateLabel}
            </span>
          </div>
        </div>
        <p className="summary" onClick={() => setOpen(true)}>
          {item.summary}
        </p>
      </div>
      {item.imageUrl && (
        // Через /api/image-proxy, а не напрямую — некоторые издания (Rolling
        // Stone, Variety, Hollywood Reporter, все три на инфраструктуре
        // Penske Media) блокируют именно хотлинк картинки из чужого домена
        // (см. коммент в app/api/image-proxy/route.ts), хотя тот же URL
        // прекрасно отдаётся на серверный запрос при сборе новостей.
        // eslint-disable-next-line @next/next/no-img-element -- домены картинок непредсказуемы (любое издание)
        <img
          src={`/api/image-proxy?url=${encodeURIComponent(item.imageUrl)}`}
          alt=""
          className="cover"
          loading="lazy"
        />
      )}

      <ArticleModal item={open ? item : null} onClose={() => setOpen(false)} />

      <style jsx>{`
        .card {
          display: block;
        }
        .cover {
          display: block;
          width: 100%;
          max-height: 320px;
          object-fit: cover;
          margin-top: 16px;
        }
        .body {
          padding: 0 2px;
        }
        .attribution {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 6px;
        }
        .favicon {
          width: 24px;
          height: 24px;
          border-radius: 6px;
          flex-shrink: 0;
        }
        .favicon-placeholder {
          background: var(--border);
        }
        .attribution-text {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 3px;
        }
        .source-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .source-name {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 0.64rem;
          font-weight: 600;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--text-dim);
          text-decoration: none;
        }
        .source-name:hover {
          color: var(--accent);
        }
        .badge {
          font-size: 0.72rem;
          font-style: italic;
          color: var(--accent);
        }
        .date {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 0.64rem;
          letter-spacing: 0.03em;
          color: var(--text-dim);
        }
        .summary {
          margin: 0;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 0.9rem;
          line-height: 1.5;
          cursor: pointer;
        }
      `}</style>
    </article>
  );
}
