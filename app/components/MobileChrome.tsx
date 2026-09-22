"use client";

import { useEffect, useState } from "react";
import CategoryNav from "./CategoryNav";
import AuthMenuItem from "./AuthMenuItem";

export default function MobileChrome({ activeCategory }: { activeCategory?: string }) {
  const [open, setOpen] = useState(false);

  // Без блокировки скролла body на iOS Safari прокрутка длинного меню
  // (fixed + overflow-y: auto) иногда не работает вовсе — тот же паттерн,
  // что уже проверен в ArticleModal.tsx.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <div className="header">
        <button className="icon-button" aria-label="Меню" onClick={() => setOpen(true)}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
            <path d="M2.75 8.25H21.25M2.75 15.75H21.25" stroke="#4C515E" strokeLinecap="round" />
          </svg>
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG */}
        <img src="/logo-outlined.svg" alt="Yoten" className="logo" />
        {/* Пустой спейсер вместо иконки авторизации — в макете справа в
            шапке ленты ничего нет (вход/выход — только через меню), спейсер
            лишь держит логотип по центру симметрично левой кнопке меню. */}
        <span className="spacer" />
      </div>

      {open && (
        <div className="overlay">
          <div className="header">
            <button className="icon-button" aria-label="Закрыть" onClick={() => setOpen(false)}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
                <path d="M6.25 6.25L17.75 17.75M17.75 6.25L6.25 17.75" stroke="#4C515E" strokeLinecap="round" />
              </svg>
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG */}
            <img src="/logo-outlined.svg" alt="Yoten" className="logo" />
            {/* Пустой спейсер вместо иконки — держит логотип по центру
                симметрично левой кнопке закрытия, как в макете. */}
            <span className="spacer" />
          </div>
          <div className="body">
            <nav className="categories">
              <CategoryNav activeCategory={activeCategory} onNavigate={() => setOpen(false)} />
            </nav>
            <div className="divider" />
            <div className="account">
              <span className="disabled">Настройка ленты</span>
              <AuthMenuItem />
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 20px 12px;
          width: 100%;
        }
        .icon-button {
          display: flex;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          width: 24px;
          height: 24px;
        }
        .spacer {
          width: 24px;
          height: 24px;
        }
        .logo {
          /* 96px, не 150 — проверено по факту рендера в Figma (пиксельные
             замеры скриншота), автосгенерированный код завышал размер для
             мобильных фреймов. То же значение, что и в десктоп-сайдбаре. */
          width: 96px;
          height: auto;
        }
        .overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: var(--bg);
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }
        .body {
          display: flex;
          flex-direction: column;
          gap: 32px;
          padding-bottom: 32px;
        }
        .categories {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          text-align: left;
          gap: 16px;
          padding: 0 40px;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 300;
          font-size: 20px;
        }
        .categories :global(a) {
          color: var(--text);
          text-decoration: none;
        }
        .categories :global(a.active) {
          color: var(--accent);
        }
        .divider {
          height: 1px;
          background: var(--border);
          margin: 0 20px;
        }
        .account {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          text-align: left;
          gap: 16px;
          padding: 0 40px;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 300;
          font-size: 20px;
          color: var(--text);
        }
        .disabled {
          color: var(--text-dim);
        }
      `}</style>
    </>
  );
}
