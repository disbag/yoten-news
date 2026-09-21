import { createHash, randomInt } from "node:crypto";

export const CODE_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 60;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// Привязываем хэш к email и SESSION_SECRET — иначе утёкшая таблица давала бы
// радужную таблицу на все 10^6 возможных кодов.
export function hashCode(email: string, code: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET не задан");
  return createHash("sha256").update(`${email}:${code}:${secret}`).digest("hex");
}

export async function sendCodeEmail(email: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY не задан");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "Yoten <onboarding@resend.dev>",
      to: [email],
      subject: `${code} — код для входа в Yoten`,
      text: `Ваш код для входа в Yoten: ${code}\n\nКод действует ${CODE_TTL_MINUTES} минут. Если вы не запрашивали вход — просто проигнорируйте это письмо.`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:420px">
  <p style="color:#2c261e">Ваш код для входа в Yoten:</p>
  <p style="font-size:32px;font-weight:600;letter-spacing:6px;color:#c94f3d;margin:8px 0">${code}</p>
  <p style="color:#8a7f6d;font-size:13px">Код действует ${CODE_TTL_MINUTES} минут. Если вы не запрашивали вход — просто проигнорируйте это письмо.</p>
</div>`,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}
