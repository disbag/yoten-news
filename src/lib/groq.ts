import "dotenv/config";
import { SUMMARY_PROMPT, ensureCompleteSentence } from "./prompt.js";

// Запасной провайдер на случай, когда Gemini недоступен целиком (перегрузка
// всех моделей или исчерпанная квота на всех ключах) — см. summarize в
// src/lib/summarizer.ts. На бесплатном тарифе у Groq два лимита:
//  - в минуту (входные токены, ITPM ~7000): одна наша статья с промптом —
//    3-4 тыс. токенов, то есть примерно статья в 30 секунд. Упёрлись — Groq
//    сам говорит, сколько подождать ("try again in 6s"), ждём и повторяем;
//  - в сутки (запросы/токены, RPD/TPD): упёрлись — ждать бессмысленно,
//    бросаем GroqLimitError, и fetchAndProcess.ts останавливает прогон.
// Модель без режима рассуждений в ответе (проверено: <think> не выводит) и
// держит наш формат "ТЕМА: … / главное / === / продолжение".
const GROQ_MODEL = process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_MINUTE_WAITS = 3;
const MAX_WAIT_MS = 65_000;
const MAX_RETRIES_5XX = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GroqLimitError extends Error {}

export function hasGroqKey(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

// "Please try again in 6.008s" / "in 1m26.4s" из текста ошибки или
// заголовок retry-after (секунды) — сколько ждать до освобождения лимита.
function waitMs(res: Response, message: string): number {
  const m = message.match(/try again in (?:(\d+)m)?([\d.]+)s/i);
  const fromMessage = m ? (Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000 : NaN;
  const fromHeader = Number(res.headers.get("retry-after")) * 1000;
  const ms = Number.isFinite(fromMessage) ? fromMessage : Number.isFinite(fromHeader) ? fromHeader : 30_000;
  return ms + 500;
}

export async function summarize(
  title: string,
  rawSummary: string,
  systemPrompt: string = SUMMARY_PROMPT
): Promise<string> {
  const body = JSON.stringify({
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Заголовок: ${title}\n\nТекст: ${rawSummary}` },
    ],
    temperature: 0.3,
    // Тот же запас, что у Gemini (см. maxOutputTokens в gemini.ts).
    max_tokens: 1500,
  });

  let minuteWaits = 0;
  let serverErrors = 0;
  for (;;) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.status === 429) {
      const message: string = (await res.json().catch(() => ({})))?.error?.message ?? "";
      const wait = waitMs(res, message);
      if (/per day|\((?:RPD|TPD)\)/i.test(message) || wait > MAX_WAIT_MS) {
        throw new GroqLimitError(`исчерпан суточный лимит (${message.slice(0, 160)})`);
      }
      if (minuteWaits >= MAX_MINUTE_WAITS) throw new Error(`Groq: минутный лимит не освободился (${message.slice(0, 160)})`);
      minuteWaits += 1;
      await sleep(wait);
      continue;
    }

    if (res.status >= 500 && serverErrors < MAX_RETRIES_5XX) {
      serverErrors += 1;
      await sleep(2000 * 2 ** serverErrors);
      continue;
    }

    if (!res.ok) throw new Error(`Groq error ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const data = await res.json();
    const text: string | undefined = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Groq вернул пустой ответ");
    return ensureCompleteSentence(text);
  }
}
