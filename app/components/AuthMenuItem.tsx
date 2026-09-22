"use client";

import { useAuth } from "./useAuth";

// Текстовый вариант входа/выхода для нового меню (сайдбар на десктопе,
// оверлей на мобилке) — та же passkey-логика из useAuth, что и у иконки в
// AuthWidget, просто другое представление.
export default function AuthMenuItem() {
  const { user, loading, error, needsRegister, handleClick, handleLogout } = useAuth();

  return (
    <div className="item">
      <button disabled={loading} onClick={user ? handleLogout : handleClick}>
        {user ? "Выйти" : needsRegister ? "Создать passkey" : "Войти"}
      </button>
      {error && <span className="error">{error}</span>}
      <style jsx>{`
        .item {
          position: relative;
          width: 100%;
        }
        button {
          font: inherit;
          color: inherit;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          width: 100%;
          /* Направление текста (лево на десктоп-сайдбаре, право в мобильном
             оверлее) задаёт родитель через text-align на .account/.categories. */
          text-align: inherit;
        }
        button:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .error {
          display: block;
          margin-top: 6px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 0.7rem;
          color: #c0392b;
        }
      `}</style>
    </div>
  );
}
