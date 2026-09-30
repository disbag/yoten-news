"use client";

import Link from "next/link";
import { useState } from "react";
import type { SettingsGroup } from "../../src/lib/sourcePrefs";

// Страница настройки ленты — список изданий по группам с переключателем у
// каждого (макет DIS-28). Сетка та же, что у ленты (колонка 240px слева +
// основная 600px, см. .shell в globals.css), чтобы логотип не прыгал при
// переходе между лентой и настройками. На мобилке — своя шапка со стрелкой
// "назад" вместо меню.
export default function SettingsView({ groups: initialGroups }: { groups: SettingsGroup[] }) {
  const [groups, setGroups] = useState(initialGroups);
  const [error, setError] = useState(false);

  function setEnabled(sourceId: number, enabled: boolean) {
    setGroups((prev) =>
      prev.map((group) => ({
        ...group,
        sources: group.sources.map((s) => (s.id === sourceId ? { ...s, enabled } : s)),
      }))
    );
  }

  // Переключаем сразу, не дожидаясь ответа, — при ошибке возвращаем назад.
  async function toggle(sourceId: number, enabled: boolean) {
    setEnabled(sourceId, enabled);
    setError(false);
    try {
      const res = await fetch("/api/settings/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, enabled }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setEnabled(sourceId, !enabled);
      setError(true);
    }
  }

  return (
    <div className="shell">
      <div className="mobile-only">
        <div className="mobile-header">
          <Link href="/" aria-label="Назад" className="icon">
            {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG из макета */}
            <img src="/back-mobile.svg" alt="" width={24} height={24} />
          </Link>
          {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG */}
          <img src="/logo-desktop.svg" alt="Yoten" className="logo" />
          {/* Пустой справа, как в макете, — держит логотип по центру. */}
          <span className="icon" />
        </div>
      </div>
      <div className="desktop-only">
        <aside className="sidebar">
          {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG */}
          <img src="/logo-desktop.svg" alt="Yoten" className="logo" />
          <Link href="/" className="back">
            {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG из макета */}
            <img src="/back-desktop.svg" alt="" width={24} height={24} />
            Назад
          </Link>
        </aside>
      </div>

      <main>
        <div className="body">
          {error && <p className="error">Не удалось сохранить — попробуйте ещё раз</p>}
          {groups.map((group) => (
            <section key={group.label} className="group">
              <h2>{group.label}</h2>
              {group.sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  role="switch"
                  aria-checked={source.enabled}
                  className="row"
                  onClick={() => toggle(source.id, !source.enabled)}
                >
                  <span className="name">{source.name}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG из макета */}
                  <img src={source.enabled ? "/toggle-on.svg" : "/toggle-off.svg"} alt="" width={24} height={24} />
                </button>
              ))}
            </section>
          ))}
        </div>
      </main>

      <style jsx>{`
        .mobile-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 20px 12px;
        }
        .mobile-header :global(.icon) {
          display: flex;
          width: 24px;
          height: 24px;
        }
        .logo {
          width: 96px;
          height: 55px;
          display: block;
        }
        .sidebar {
          display: flex;
          flex-direction: column;
          gap: 20px;
          width: 240px;
          flex-shrink: 0;
          padding: 20px 0;
          position: sticky;
          top: 0;
        }
        .sidebar :global(.back) {
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 300;
          font-size: 18px;
          color: #3d3d3d;
          text-decoration: none;
        }
        .sidebar :global(.back:hover) {
          color: var(--accent);
        }
        .body {
          display: flex;
          flex-direction: column;
          gap: 24px;
          padding: 20px 40px 40px;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 300;
        }
        .group {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        h2 {
          margin: 0;
          font-weight: 300;
          font-size: 13px;
          line-height: 20px;
          text-transform: uppercase;
          color: rgba(38, 41, 48, 0.5);
        }
        .row {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 0;
          border: none;
          background: none;
          font: inherit;
          text-align: left;
          cursor: pointer;
        }
        .name {
          flex: 1 0 0;
          min-width: 0;
          font-size: 20px;
          color: #3d3d3d;
        }
        .row img {
          display: block;
          flex-shrink: 0;
        }
        .error {
          margin: 0;
          font-size: 14px;
          color: var(--accent);
        }
        @media (min-width: 900px) {
          .body {
            padding: 20px 0 40px;
          }
        }
      `}</style>
    </div>
  );
}
