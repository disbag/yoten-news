"use client";

import { useEffect, useState } from "react";
import type { FeedItem } from "../../src/lib/feed";

function faviconUrl(homepage: string | null): string | null {
  if (!homepage) return null;
  try {
    const { hostname } = new URL(homepage);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
  } catch {
    return null;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ArticleModal({
  item,
  onClose,
}: {
  item: FeedItem | null;
  onClose: () => void;
}) {
  // displayItem переживает закрытие на время анимации выезда — иначе контент
  // исчезнет мгновенно вместе с item, и sheet "схлопнется" пустым.
  const [displayItem, setDisplayItem] = useState<FeedItem | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (item) {
      setDisplayItem(item);
      // Двойной rAF — даём браузеру отрисовать исходное состояние (сдвинуто
      // вниз за экран) ДО переключения на видимое, иначе transition не сыграет.
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
    }
  }, [item]);

  useEffect(() => {
    if (!visible && displayItem) {
      const t = setTimeout(() => setDisplayItem(null), 300);
      return () => clearTimeout(t);
    }
  }, [visible, displayItem]);

  useEffect(() => {
    if (!displayItem) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [displayItem, onClose]);

  if (!displayItem) return null;

  const favicon = faviconUrl(displayItem.primaryHomepage);
  const body = displayItem.summaryLong ?? displayItem.description ?? displayItem.summary;

  return (
    <div
      onClick={onClose}
      // Все стили — inline, не через styled-jsx: у styled-jsx (в SWC-варианте
      // Next.js) есть баг — он не добавляет свой scope-класс именно на корневой
      // элемент компонента (проверено: даже со статичным className="overlay"
      // класс на DOM-узле оставался без jsx-scope, и CSS-правило .overlay просто
      // не совпадало с элементом). На практике это выглядело как модалка,
      // "залипшая" за нижним краем экрана — position:fixed не применялся.
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 100,
        transition: "background 0.3s ease",
        background: visible ? "rgba(0, 0, 0, 0.6)" : "rgba(0, 0, 0, 0)",
      }}
    >
      <div
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ transform: visible ? "translateY(0)" : "translateY(100%)" }}
      >
        <div className="handle" />
        <button className="close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>

        <div className="attribution">
          {favicon ? (
            // eslint-disable-next-line @next/next/no-img-element -- фавиконки с произвольных доменов изданий
            <img src={favicon} alt="" className="favicon" />
          ) : (
            <span className="favicon favicon-placeholder" />
          )}
          <span className="source-name">{displayItem.primarySource}</span>
        </div>
        <div className="date">{formatDate(displayItem.publishedAt)}</div>

        <p className="body-text">{body}</p>

        <div className="sources">
          <p className="sources-label">Источники</p>
          {displayItem.sources.map((s) => (
            <a key={s.link} href={s.link} target="_blank" rel="noopener noreferrer">
              {s.name} →
            </a>
          ))}
        </div>

        <style jsx>{`
          .sheet {
            position: relative;
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 20px 20px 0 0;
            padding: 10px 20px 28px;
            max-width: 640px;
            width: 100%;
            max-height: 85vh;
            overflow-y: auto;
            transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1);
          }
          .handle {
            width: 36px;
            height: 4px;
            border-radius: 999px;
            background: var(--border);
            margin: 0 auto 16px;
          }
          .close {
            position: absolute;
            top: 14px;
            right: 16px;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border: none;
            background: var(--border);
            color: var(--text);
            font-size: 1.3rem;
            line-height: 1;
            cursor: pointer;
          }
          .attribution {
            display: flex;
            align-items: center;
            gap: 9px;
            padding-right: 40px;
          }
          .favicon {
            width: 18px;
            height: 18px;
            border-radius: 4px;
            flex-shrink: 0;
          }
          .favicon-placeholder {
            background: var(--border);
          }
          .source-name {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 0.72rem;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--text-dim);
          }
          .date {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 0.75rem;
            color: var(--text-dim);
            margin: 6px 0 20px;
          }
          .body-text {
            margin: 0;
            font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 1.15rem;
            line-height: 1.65;
            white-space: pre-line;
          }
          .sources {
            margin-top: 24px;
            padding-top: 18px;
            border-top: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .sources-label {
            margin: 0 0 4px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 0.7rem;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--text-dim);
          }
          .sources a {
            font-size: 0.95rem;
            color: var(--accent);
            text-decoration: none;
          }
          .sources a:hover {
            text-decoration: underline;
          }
        `}</style>
      </div>
    </div>
  );
}
