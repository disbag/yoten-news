"use client";

import { useAuth } from "./useAuth";

export default function AuthWidget() {
  const { user, loading, error, needsRegister, handleClick, handleLogout } = useAuth();

  if (user) {
    return (
      <div className="auth">
        <button className="icon-button" onClick={handleLogout} title={`Выйти (${user.displayName})`}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
            <path
              d="M20.25 12L9 12M20.25 12L15.75 16.5M20.25 12L15.75 7.5M11.25 20.25H5.75C4.64543 20.25 3.75 19.3546 3.75 18.25L3.75 5.75C3.75 4.64543 4.64543 3.75 5.75 3.75L11.25 3.75"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <style jsx>{`
          .auth {
            display: flex;
            align-items: center;
          }
          .icon-button {
            display: flex;
            background: none;
            border: none;
            padding: 4px;
            cursor: pointer;
            color: var(--text-dim);
          }
          .icon-button svg {
            width: 20px;
            height: 20px;
          }
          .icon-button:hover {
            color: var(--accent);
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="auth">
      <button
        className="icon-button"
        onClick={handleClick}
        disabled={loading}
        title={needsRegister ? "Создать новый passkey" : "Войти по Face ID/Touch ID"}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
          <path
            d="M15.25 10C15.25 11.7949 13.7949 13.25 12 13.25C10.2051 13.25 8.75 11.7949 8.75 10C8.75 8.20507 10.2051 6.75 12 6.75C13.7949 6.75 15.25 8.20507 15.25 10Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M18.143 18.9157C16.8294 16.9968 14.668 15.75 12 15.75C9.33203 15.75 7.17056 16.9968 5.85697 18.9157M18.143 18.9157C20.0491 17.2214 21.25 14.7509 21.25 12C21.25 6.89137 17.1086 2.75 12 2.75C6.89137 2.75 2.75 6.89137 2.75 12C2.75 14.7509 3.95086 17.2214 5.85697 18.9157M18.143 18.9157C16.5094 20.3679 14.3577 21.25 12 21.25C9.6423 21.25 7.49061 20.3679 5.85697 18.9157"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {error && <span className="error">{error}</span>}

      <style jsx>{`
        .auth {
          position: relative;
          display: flex;
          align-items: center;
        }
        .icon-button {
          display: flex;
          background: none;
          border: none;
          padding: 4px;
          cursor: pointer;
          color: var(--text-dim);
        }
        .icon-button svg {
          width: 20px;
          height: 20px;
        }
        .icon-button:hover:not(:disabled) {
          color: var(--accent);
        }
        .icon-button:disabled {
          cursor: default;
          opacity: 0.6;
        }
        .error {
          position: absolute;
          top: calc(100% + 10px);
          right: 0;
          max-width: 220px;
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px 12px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 0.72rem;
          color: #c0392b;
          z-index: 10;
        }
      `}</style>
    </div>
  );
}
