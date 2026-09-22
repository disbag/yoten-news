"use client";

import CategoryNav from "./CategoryNav";
import AuthMenuItem from "./AuthMenuItem";

export default function Sidebar({ activeCategory }: { activeCategory?: string }) {
  return (
    <aside className="sidebar">
      {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG */}
      <img src="/logo-outlined.svg" alt="Yoten" className="logo" />
      <div className="menu">
        <nav className="categories">
          <CategoryNav activeCategory={activeCategory} />
        </nav>
        <div className="account">
          {/* Настройка ленты — заглушка, реализуем следующим шагом */}
          <span className="disabled">Настройка ленты</span>
          <AuthMenuItem />
        </div>
      </div>

      <style jsx>{`
        .sidebar {
          display: flex;
          flex-direction: column;
          gap: 20px;
          width: 240px;
          flex-shrink: 0;
          padding: 20px 0;
          /* Фиксируем при скролле страницы — обёртка .desktop-only растянута
             на всю высоту строки (см. .shell в globals.css), так что есть
             место "отлипнуть" и остаться в этой позиции. Без
             max-height/overflow-y на самом sticky-элементе: вложенный
             скролл-контейнер внутри sticky путал обработку wheel-событий
             браузером и дёргал скролл всей страницы — контент сайдбара и
             так короче типичной высоты вьюпорта. */
          position: sticky;
          top: 0;
        }
        .logo {
          /* Без паддинга на самом img: с глобальным box-sizing: border-box
             паддинг на replaced-элементе с явным width сжимает контентную
             область (не сам квадрат width x height), а height:auto считает
             пропорцию уже от суженной ширины — картинка выходит
             расплющенной по вертикали. Отступ от левого края сайдбара
             отдельным .menu ниже, у логотипа его вовсе нет — как и в макете. */
          width: 96px;
          height: auto;
          display: block;
        }
        .menu {
          display: flex;
          flex-direction: column;
          gap: 40px;
          padding: 0 16px;
        }
        .categories {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          text-align: left;
          gap: 12px;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 300;
          font-size: 18px;
        }
        .categories :global(a) {
          color: var(--text);
          text-decoration: none;
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
          align-items: flex-start;
          text-align: left;
          gap: 12px;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 300;
          font-size: 18px;
          color: var(--text);
        }
        .disabled {
          color: var(--text-dim);
        }
      `}</style>
    </aside>
  );
}
