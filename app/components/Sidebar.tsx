"use client";

import CategoryNav from "./CategoryNav";
import AuthMenuItem from "./AuthMenuItem";

export default function Sidebar({ activeCategory }: { activeCategory?: string }) {
  return (
    <aside className="sidebar">
      {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG */}
      <img src="/logo-outlined.svg" alt="Yoten" className="logo" />
      <nav className="categories">
        <CategoryNav activeCategory={activeCategory} />
      </nav>
      <div className="account">
        {/* Настройка ленты — заглушка, реализуем следующим шагом */}
        <span className="disabled">Настройка ленты</span>
        <AuthMenuItem />
      </div>

      <style jsx>{`
        .sidebar {
          display: flex;
          flex-direction: column;
          gap: 20px;
          width: 240px;
          flex-shrink: 0;
          padding: 20px 0;
        }
        .logo {
          width: 96px;
          height: auto;
          padding: 0 16px;
        }
        .categories {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 12px;
          padding: 0 16px;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 300;
          font-size: 18px;
        }
        .categories :global(a) {
          color: var(--text);
          text-decoration: none;
          width: 100%;
          text-align: right;
        }
        .categories :global(a.active) {
          color: var(--accent);
        }
        .categories :global(a:hover) {
          color: var(--accent);
        }
        .account {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 12px;
          padding: 0 16px;
          margin-top: 20px;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 300;
          font-size: 18px;
          color: var(--text);
        }
        .disabled {
          color: var(--text-dim);
          text-align: right;
          width: 100%;
        }
      `}</style>
    </aside>
  );
}
