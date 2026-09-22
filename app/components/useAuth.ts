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

// Общая логика входа/регистрации/выхода — passkey и email — используется
// AuthMenuItem (текстовая ссылка "Войти"/"Выйти" в сайдбаре/мобильном меню) и
// AuthModal (сама форма). Общий хук вместо дублирования обработки
// NotAllowedError/двухшагового флоу passkey-регистрации и fetch-обвязки для
// email — оба компонента держат свой независимый экземпляр состояния
// (loading/error), так как одновременно активен только один из них.
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

  // Регистрация по email — без одноразового кода (см. коммент в
  // app/api/auth/email/register/route.ts), поэтому в один шаг, в отличие от
  // passkey-регистрации выше.
  async function handleEmailRegister(email: string) {
    setError(null);
    setLoading(true);
    try {
      await postJson("/api/auth/email/register", { email });
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return { user, loading, error, needsRegister, handleClick, handleLogout, handleEmailRegister };
}
