"use client";

import Link from "next/link";

// Заменяет прежний текстовый тоггл "Показать все / Только непрочитанные" —
// теперь два таба-режима вместо режима "всё сразу": "Новые" (непрочитанные,
// с счётчиком) и "Прочитанные". Категория (см. CategoryNav) — отдельное,
// независимое измерение фильтра, поэтому сохраняется в query при переключении.
export default function FeedTabs({
  tab,
  category,
  unreadCount,
}: {
  tab: "new" | "read";
  category?: string;
  unreadCount: number;
}) {
  const categoryQuery = category ? `category=${category}` : "";
  const href = (t: "new" | "read") =>
    `/?${categoryQuery}${categoryQuery ? "&" : ""}${t === "read" ? "tab=read" : ""}`;

  return (
    <div className="tabs">
      <Link href={href("new")} className={tab === "new" ? "tab active" : "tab"}>
        <span className="label">
          <span>Новые</span>
          {unreadCount > 0 && <span className="count">{unreadCount}</span>}
        </span>
      </Link>
      <Link href={href("read")} className={tab === "read" ? "tab active" : "tab"}>
        <span className="label">
          <span>Прочитанные</span>
        </span>
      </Link>

      <style jsx>{`
        .tabs {
          display: flex;
          align-items: stretch;
          width: 100%;
          border-bottom: 1px solid var(--border);
          /* Липнут к верху экрана при скролле — свой непрозрачный фон
             нужен, иначе карточки будут просвечивать сквозь табы, когда
             уезжают вверх под них. */
          position: sticky;
          top: 0;
          z-index: 10;
          background: var(--bg);
        }
        /* next/link рендерит <a> сам по себе — styled-jsx не проставляет
           scope-класс на JSX-компоненты (только на host-теги), поэтому
           таргетим через :global() от уже отмеченного родителя .tabs, как и
           в Sidebar.tsx/CategoryNav. */
        .tabs :global(a.tab) {
          /* Высота таба в макете ровно 40px: pt-12 + строка label
             (line-height 20) + gap-7 перед разделительной линией + сама
             линия 1px = 12+20+7+1 = 40. padding-bottom здесь — это тот же
             "gap-7", а линия — border, а не ещё один паддинг. */
          flex: 1 0 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 7px;
          padding-top: 12px;
          padding-bottom: 7px;
          text-decoration: none;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 300;
          font-size: 13px;
          line-height: 20px;
          color: rgba(38, 41, 48, 0.5);
          border-bottom: 1px solid transparent;
          margin-bottom: -1px;
        }
        .tabs :global(a.tab.active) {
          color: var(--text);
          border-bottom-color: var(--accent);
        }
        .label {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .count {
          font-size: 8.4px;
          color: rgba(0, 0, 0, 0.5);
        }
      `}</style>
    </div>
  );
}
