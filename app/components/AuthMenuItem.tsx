"use client";

import { useState } from "react";
import { useAuth } from "./useAuth";
import AuthModal from "./AuthModal";

// Текстовый вариант входа/выхода для меню (сайдбар на десктопе, оверлей на
// мобилке) — единственный способ войти/выйти в текущем макете, иконки в
// шапке больше нет (см. useAuth.ts). Сам вход/регистрация — в отдельной
// модалке (AuthModal), а не сразу по клику: с возвращением email-регистрации
// нужен выбор между passkey и email, а не одно действие на кнопку.
export default function AuthMenuItem() {
  const { user, handleLogout } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="item">
      <button onClick={user ? handleLogout : () => setModalOpen(true)}>{user ? "Выйти" : "Войти"}</button>
      <AuthModal open={modalOpen} onClose={() => setModalOpen(false)} />
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
      `}</style>
    </div>
  );
}
