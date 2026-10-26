"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import CategoryNav from "./CategoryNav";

export default function MobileChrome({
  activeCategory,
}: {
  activeCategory?: string;
}) {
  const [open, setOpen] = useState(false);
  // Шапка закреплена сверху (DIS-80): при прокрутке вниз уезжает, при
  // прокрутке вверх возвращается вместе с вкладками. Её видимая высота —
  // в --chrome-offset: под ней прилипают вкладки и плашка "N Новых"
  // (FeedTabs.tsx, FeedList.tsx). Сама шапка fixed, место в потоке держит
  // распорка той же высоты.
  const headerRef = useRef<HTMLDivElement>(null);
  // 87 = 20 + логотип 55 + 12 (см. .header и .logo): распорка нужной высоты
  // уже в серверной разметке, до замера, — иначе лента дёрнется при загрузке.
  const [height, setHeight] = useState(87);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const desktop = window.matchMedia("(min-width: 900px)");
    const root = document.documentElement.style;
    let last = window.scrollY;
    let isHidden = false;
    const apply = (nextHidden: boolean) => {
      isHidden = nextHidden;
      setHidden(nextHidden);
      const h = header.offsetHeight;
      root.setProperty("--chrome-offset", desktop.matches || nextHidden ? "0px" : `${h}px`);
    };
    const measure = () => {
      setHeight(header.offsetHeight);
      apply(isHidden);
    };
    // Порог в несколько пикселей — чтобы шапка не дёргалась от дрожания
    // пальца и инерции на месте.
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - last;
      if (y <= header.offsetHeight) apply(false);
      else if (delta > 6 && !isHidden) apply(true);
      else if (delta < -6 && isHidden) apply(false);
      if (Math.abs(delta) > 6 || y <= header.offsetHeight) last = y;
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(header);
    window.addEventListener("scroll", onScroll, { passive: true });
    desktop.addEventListener("change", measure);
    return () => {
      resize.disconnect();
      window.removeEventListener("scroll", onScroll);
      desktop.removeEventListener("change", measure);
      root.removeProperty("--chrome-offset");
    };
  }, []);

  // Без блокировки скролла body на iOS Safari прокрутка длинного меню
  // (fixed + overflow-y: auto) иногда не работает вовсе — тот же паттерн,
  // что и в Lightbox.tsx.
  //
  // Компенсация ширины скроллбара — без неё на десктопном браузере (виден
  // полосой справа, в отличие от настоящего мобильного) overflow:hidden
  // тут же убирает эту полосу, страница резко становится на её ширину
  // шире, и весь центрированный по флексу контент шапки (в т.ч. лого
  // ровно посередине) скачет вбок на полширины скроллбара — выглядит как
  // "лого дёрнулось/пропало и появилось снова".
  useEffect(() => {
    if (!open) return;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
    };
  }, [open]);

  return (
    <>
      <div className="header-space" style={{ height }} />
      <div className={hidden ? "header top hidden" : "header top"} ref={headerRef}>
        <button className="icon-button" aria-label="Меню" onClick={() => setOpen(true)}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
            <path d="M2.75 8.25H21.25M2.75 15.75H21.25" stroke="currentColor" strokeLinecap="round" />
          </svg>
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG */}
        <img src="/logo-outlined.svg" alt="Yoten" className="logo theme-invert" />
        {/* Пустой спейсер — в макете справа в шапке ленты ничего нет, он
            держит логотип по центру симметрично левой кнопке меню. */}
        <span className="spacer" />
      </div>

      {open && (
        <div className="overlay">
          <div className="header">
            <button className="icon-button" aria-label="Закрыть" onClick={() => setOpen(false)}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
                <path d="M6.25 6.25L17.75 17.75M17.75 6.25L6.25 17.75" stroke="currentColor" strokeLinecap="round" />
              </svg>
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG */}
            <img src="/logo-outlined.svg" alt="Yoten" className="logo theme-invert" />
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
              <Link href="/settings" onClick={() => setOpen(false)}>
                Настройки
              </Link>
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
        .top {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 30;
          background: var(--bg);
          transition: transform 0.2s ease;
        }
        .top.hidden {
          transform: translateY(-100%);
        }
        .icon-button {
          display: flex;
          color: var(--icon);
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
          /* 150px — подтверждено метаданными фрейма в Figma (frame
             "yoten_logo_outlined 2 1" внутри мобильной шапки/меню — 150x55),
             в отличие от десктоп-сайдбара, где тот же логотип в раза меньше
             (96px, отдельный фрейм). Пиксельные замеры скриншота раньше
             ошибочно приняли отступ ВНУТРИ SVG за реальный размер контейнера. */
          width: 150px;
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
        .account :global(a) {
          color: inherit;
          text-decoration: none;
        }
        .account :global(a:hover) {
          color: var(--accent);
        }
      `}</style>
    </>
  );
}
