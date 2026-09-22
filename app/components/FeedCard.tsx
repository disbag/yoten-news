"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedItem } from "../../src/lib/feed";
import { categoryLabels } from "../../src/config/categories";
import ArticleModal from "./ArticleModal";
import Gallery from "./Gallery";

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

export default function FeedCard({
  item,
  onRead,
}: {
  item: FeedItem;
  onRead?: (clusterId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isRead, setIsRead] = useState(item.isRead);
  // Некоторые издания (Telegraph — известный случай) отдают 402/битые байты
  // даже через прокси (см. коммент в app/api/image-proxy/route.ts) — вместо
  // сломанной иконки картинки в ленте просто скрываем блок с ней целиком.
  const [imageBroken, setImageBroken] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const favicon = faviconUrl(item.primaryHomepage);
  const category = categoryLabels(item.category);
  // Подробную версию для модалки не генерируем на бэкенде для источников с
  // коротким тизером (NYT/WSJ/Bloomberg и т.п. — см. MIN_DETAIL_CONTEXT_LENGTH
  // в fetchAndProcess.ts): там разворачивать нечего, вся статья и так
  // целиком уже видна в ленте. Модалка в таком случае просто не нужна —
  // не показываем ни клик по тексту, ни "Читать", ни саму ArticleModal.
  const hasDetail = Boolean(item.summaryLong);

  function markRead() {
    setIsRead(true);
    onRead?.(item.clusterId);
    // Fire-and-forget: у гостя (без аккаунта) это тихо no-op'ается на
    // бэкенде ({ok:false}, см. app/api/reads/route.ts) — карточка всё
    // равно уже выглядит прочитанной локально, просто не переживёт
    // перезагрузку страницы без аккаунта.
    fetch("/api/reads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clusterId: item.clusterId }),
    }).catch(() => {});
  }

  // Прочитанной карточка становится не по клику, а когда пользователь
  // проскроллил её целиком выше видимой области — как в Twitter/почте, где
  // "просмотрено" значит "прошло через экран", а не "открыто по клику".
  // rootMargin не используем — вместо этого различаем направление выхода по
  // boundingClientRect: top < 0 при !isIntersecting означает "ушла наверх"
  // (пользователь проскроллил мимо), а не "ещё не долистали" (там top > 0).
  useEffect(() => {
    if (isRead) return;
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
          markRead();
        }
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- markRead читает актуальный isRead через замыкание на каждый ре-рендер, доп. зависимости пересоздавали бы observer без надобности
  }, [isRead]);

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
    <article className="card" ref={cardRef}>
      <div className="content">
        <div className="header">
          {favicon ? (
            // eslint-disable-next-line @next/next/no-img-element -- фавиконки с произвольных доменов изданий
            <img src={favicon} alt="" className="favicon" />
          ) : (
            <span className="favicon favicon-placeholder" />
          )}
          <div className="meta">
            <div className="source-row">
              {!isRead && <span className="unread-dot" />}
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
        <p
          className={`summary${isRead ? " read" : ""}${hasDetail ? "" : " no-detail"}`}
          onClick={hasDetail ? () => setOpen(true) : undefined}
        >
          {item.summary} {hasDetail && <span className="read-more">Читать</span>}
        </p>
      </div>
      {item.imageUrls && item.imageUrls.length > 1 ? (
        <Gallery urls={item.imageUrls} />
      ) : (
        item.imageUrl &&
        !imageBroken && (
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
            onError={() => setImageBroken(true)}
          />
        )
      )}

      {hasDetail && <ArticleModal item={open ? item : null} onClose={() => setOpen(false)} />}

      <style jsx>{`
        .card {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .content {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .cover {
          display: block;
          width: 100%;
          aspect-ratio: 1200 / 630;
          object-fit: cover;
          border-radius: 14px;
        }
        .header {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .favicon {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }
        .favicon-placeholder {
          background: var(--border);
        }
        .meta {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          flex: 1 0 0;
          min-width: 0;
        }
        .source-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .unread-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--accent);
          flex-shrink: 0;
        }
        .source-name {
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 12px;
          line-height: 14px;
          color: var(--text);
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
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 10px;
          line-height: 12px;
          color: var(--text-dim);
        }
        .summary {
          margin: 0;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 400;
          font-size: 15px;
          line-height: 20px;
          color: var(--text);
          cursor: pointer;
        }
        .summary.read {
          color: var(--text-dim);
        }
        .summary.no-detail {
          cursor: default;
        }
        .read-more {
          color: #3186d1;
          text-decoration: underline;
        }
        @media (max-width: 899px) {
          .summary {
            font-size: 1rem;
          }
        }
      `}</style>
    </article>
  );
}
