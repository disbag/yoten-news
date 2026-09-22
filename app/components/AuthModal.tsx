"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./useAuth";

type Mode = "login" | "register";

// Модалка входа/регистрации (см. Figma: node 22:2289 "Войти" и 23:2388
// "Зарегистрируйтесь") — открывается по клику на "Войти" в AuthMenuItem.
// Переключение между режимами — просто локальный state, а не два разных
// компонента: разметка и хук общие, отличается только заголовок/CTA снизу.
export default function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const { loading, error, needsRegister, handleClick, handleEmailRegister } = useAuth();

  // Тот же паттерн анимации выезда, что и в ArticleModal.tsx: mounted
  // переживает закрытие на время transition, иначе sheet исчезнет мгновенно
  // вместо того чтобы уехать вниз. open — просто boolean (а не nullable item,
  // как в ArticleModal), потому что у модалки нет собственных данных.
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("login"); // не запоминаем режим между открытиями
      setEmail("");
      setMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
    }
  }, [open]);

  useEffect(() => {
    if (!visible && mounted) {
      const t = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(t);
    }
  }, [visible, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [mounted, onClose]);

  if (!mounted) return null;

  return (
    <div
      onClick={onClose}
      // Инлайн, не styled-jsx — тот же баг SWC, что описан в ArticleModal.tsx:
      // scope-класс styled-jsx не попадает на корневой DOM-узел компонента.
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
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ transform: visible ? "translateY(0)" : "translateY(100%)" }}>
        <button className="close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>

        <div className="head">
          <p className="title">{mode === "login" ? "Войти" : "Зарегистрируйтесь"}</p>
          <p className="description">Для того, чтобы выбирать интересующие издания и отмечать прочитанные новости</p>
        </div>

        {mode === "login" ? (
          <button className="primary" disabled={loading} onClick={handleClick}>
            {needsRegister ? "Создать passkey" : "Войти по Face ID"}
          </button>
        ) : (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              handleEmailRegister(email);
            }}
          >
            <input
              className="input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="primary" type="submit" disabled={loading}>
              Регистрация
            </button>
          </form>
        )}

        {error && <p className="error">{error}</p>}

        <p className="switch">
          {mode === "login" ? (
            <>
              Нет аккаунта?{" "}
              <button type="button" className="link" onClick={() => setMode("register")}>
                Регистрация
              </button>
            </>
          ) : (
            <>
              Есть аккаунт?{" "}
              <button type="button" className="link" onClick={() => setMode("login")}>
                Войти
              </button>
            </>
          )}
        </p>

        <style jsx>{`
          .sheet {
            position: relative;
            display: flex;
            flex-direction: column;
            gap: 20px;
            background: var(--card);
            border-radius: 20px 20px 0 0;
            padding: 20px 20px 40px;
            max-width: 440px;
            width: 100%;
            transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1);
          }
          .close {
            position: absolute;
            top: 20px;
            right: 20px;
            width: 24px;
            height: 24px;
            border: none;
            background: none;
            color: #3d3d3d;
            font-size: 1.4rem;
            line-height: 1;
            padding: 0;
            cursor: pointer;
          }
          .head {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .title {
            margin: 0;
            font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-weight: 300;
            font-size: 16px;
            line-height: 24px;
            color: #3d3d3d;
          }
          .description {
            margin: 0;
            font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-weight: 300;
            font-size: 14px;
            line-height: 18px;
            color: #4c515e;
          }
          .form {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .input {
            font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-weight: 300;
            font-size: 14px;
            color: #3d3d3d;
            background: #f8f8f8;
            border: none;
            border-radius: 30px;
            padding: 14px 20px;
            width: 100%;
          }
          .input::placeholder {
            color: #4c515e;
          }
          .primary {
            font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-weight: 500;
            font-size: 14px;
            letter-spacing: 0.02em;
            text-transform: uppercase;
            color: #fff;
            background: var(--accent);
            border: none;
            border-radius: 30px;
            padding: 14px 20px;
            width: 100%;
            cursor: pointer;
          }
          .primary:disabled {
            opacity: 0.6;
            cursor: default;
          }
          .error {
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 0.8rem;
            color: #c0392b;
          }
          .switch {
            margin: 0;
            text-align: center;
            font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-weight: 400;
            font-size: 14px;
            color: #3d3d3d;
          }
          .link {
            font: inherit;
            color: inherit;
            background: none;
            border: none;
            padding: 0;
            text-decoration: underline;
            cursor: pointer;
          }
        `}</style>
      </div>
    </div>
  );
}
