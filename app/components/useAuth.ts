"use client";

import { useEffect, useState } from "react";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";

type SessionUser = { id: number; displayName: string } | null;

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Что-то пошло не так");
  return data;
}

// Общая passkey-логика входа/регистрации/выхода, используется текстовой
// ссылкой "Войти"/"Выйти" в AuthMenuItem (сайдбар на десктопе, мобильное
// меню) — общий хук вместо дублирования обработки NotAllowedError/
// двухшагового флоу регистрации.
export function useAuth() {
  const [user, setUser] = useState<SessionUser>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsRegister, setNeedsRegister] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => setUser(data.user));
  }, []);

  async function handleClick() {
    if (needsRegister) {
      await handleRegister();
      return;
    }
    await handleLogin();
  }

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      const options = await postJson("/api/auth/login/options");
      const response = await startAuthentication({ optionsJSON: options });
      await postJson("/api/auth/login/verify", response);
      window.location.reload();
    } catch (err) {
      if ((err as Error).name === "NotAllowedError") {
        setNeedsRegister(true);
        setError("Passkey для входа не найден. Нажмите ещё раз, чтобы создать новый.");
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    setError(null);
    setLoading(true);
    try {
      const options = await postJson("/api/auth/register/options");
      const response = await startRegistration({ optionsJSON: options });
      await postJson("/api/auth/register/verify", response);
      window.location.reload();
    } catch (err) {
      if ((err as Error).name !== "NotAllowedError") setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await postJson("/api/auth/logout");
    window.location.reload();
  }

  return { user, loading, error, needsRegister, handleClick, handleLogout };
}
