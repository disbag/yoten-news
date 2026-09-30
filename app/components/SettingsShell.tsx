"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Каркас страницы "Настройки" (DIS-28, DIS-18): шапка/колонка слева как в
// макете настройки ленты и переключение подразделов. Сетка та же, что у
// ленты (колонка 240px слева + основная 600px, см. .shell в globals.css),
// чтобы логотип не прыгал при переходе между лентой и настройками.
// Подразделы: "Источники" (выбор изданий — только у вошедшего, настройки в
// базе) и "Отображение" (тема — у всех, хранится в браузере). Отдельного
// макета для подразделов нет: на десктопе это меню в левой колонке в стиле
// сайдбара ленты, на мобилке — табы под шапкой в стиле табов ленты.
export default function SettingsShell({ isLoggedIn, children }: { isLoggedIn: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const sections = [
    ...(isLoggedIn ? [{ href: "/settings", label: "Источники" }] : []),
    { href: "/settings/display", label: "Отображение" },
  ];
  const nav = sections.map((s) => (
    <Link key={s.href} href={s.href} className={pathname === s.href ? "active" : undefined}>
      {s.label}
    </Link>
  ));

  return (
    <div className="shell">
      <div className="mobile-only">
        <div className="mobile-header">
          <Link href="/" aria-label="Назад" className="icon">
            {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG из макета */}
            <img src="/back-mobile.svg" alt="" width={24} height={24} className="theme-invert" />
          </Link>
          {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG */}
          <img src="/logo-desktop.svg" alt="Yoten" className="logo theme-invert" />
          {/* Пустой справа, как в макете, — держит логотип по центру. */}
          <span className="icon" />
        </div>
        {sections.length > 1 && <nav className="tabs">{nav}</nav>}
      </div>
      <div className="desktop-only">
        <aside className="sidebar">
          {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG */}
          <img src="/logo-desktop.svg" alt="Yoten" className="logo theme-invert" />
          <div className="menu">
            <Link href="/" className="back">
              {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG из макета */}
              <img src="/back-desktop.svg" alt="" width={24} height={24} className="theme-invert" />
              Назад
            </Link>
            <nav className="sections">{nav}</nav>
          </div>
        </aside>
      </div>

      <main>
        <div className="body">{children}</div>
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
        .tabs {
          display: flex;
          border-bottom: 1px solid var(--border);
        }
        .tabs :global(a) {
          flex: 1 0 0;
          text-align: center;
          padding: 12px 0 7px;
          margin-bottom: -1px;
          border-bottom: 1px solid transparent;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 300;
          font-size: 13px;
          line-height: 20px;
          color: var(--text-muted);
          text-decoration: none;
        }
        .tabs :global(a.active) {
          color: var(--text);
          border-bottom-color: var(--accent);
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
        .menu {
          display: flex;
          flex-direction: column;
          gap: 40px;
        }
        .menu :global(.back) {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .menu :global(a),
        .sections {
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 300;
          font-size: 18px;
          color: var(--text-soft);
          text-decoration: none;
        }
        .sections {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 12px;
        }
        .menu :global(a:hover),
        .menu :global(a.active) {
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
        @media (min-width: 900px) {
          .body {
            padding: 20px 0 40px;
          }
        }
      `}</style>
    </div>
  );
}
