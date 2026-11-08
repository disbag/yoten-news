import { readFileSync } from "node:fs";
import { pool } from "../lib/db.js";
import { SummaryQualityError } from "../lib/summaryQuality.js";

export type SummaryAlert = {
  link: string; title: string; source: string; attempts: number; reasons: string[]; action: string;
};
let ready: Promise<unknown> | undefined;
async function initAlerts(): Promise<void> {
  ready ??= pool.query(readFileSync(new URL("../../db/summary-alerts.sql", import.meta.url), "utf8"))
    .catch(err => { ready = undefined; throw err; });
  await ready;
}

export async function queueSummaryAlert(
  article: { link: string; title: string; source: string }, err: unknown, action: string,
): Promise<void> {
  // Промежуточные отказы, успешное исправление, сеть и квоты не уведомляют.
  if (!(err instanceof SummaryQualityError)) return;
  await initAlerts();
  const payload: SummaryAlert = { ...article, attempts: err.attempts, reasons: err.reasons, action };
  await pool.query("INSERT INTO summary_quality_alerts (link, payload) VALUES ($1, $2::jsonb) ON CONFLICT (link) DO NOTHING", [article.link, JSON.stringify(payload)]);
}

export function summaryAlertText(alert: SummaryAlert): string {
  const reasons: Record<string, string> = {
    too_short: "слишком короткий текст", unfinished: "оборванное предложение", language: "другой язык",
    markup: "служебная разметка", model_commentary: "ответ модели вместо пересказа", extra_sections: "лишние разделы",
    gemini_empty: "пустой ответ Gemini", groq_empty: "пустой ответ Groq",
  };
  const describe = (reason: string) => {
    const [part, code] = reason.split(":");
    if (part === "lead" || part === "more") return `${part === "lead" ? "главное" : "продолжение"}: ${reasons[code] ?? code}`;
    if (part.endsWith("_finish")) return `незавершённый ответ ${part.startsWith("gemini") ? "Gemini" : "Groq"} (${code})`;
    return reasons[reason] ?? reason;
  };
  // Plain text: внешние заголовки не интерпретируются как Telegram HTML.
  return ["⚠️ Не удалось исправить саммари", alert.source.slice(0, 150), alert.title.slice(0, 400),
    `Попыток: ${alert.attempts}.`, `Причины: ${alert.reasons.map(describe).join("; ").slice(0, 1000)}.`,
    alert.action === "keep_card_summary" ? "Продолжение треда не добавлено. Сохранена самостоятельная карточка с исходным пересказом; автоповторы остановлены."
      : alert.action === "keep_cluster_summary" ? "Новое продолжение не добавлено. Сохранён прежний пересказ в ленте." : "Повреждённый пересказ не опубликован. Автоповторы остановлены минимум на 7 дней.",
    alert.link.slice(0, 1500)].join("\n");
}

export async function sendSummaryAlert(alert: SummaryAlert, token: string, chat: string, request = fetch): Promise<void> {
  const response = await request(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ chat_id: chat, text: summaryAlertText(alert), disable_web_page_preview: true }),
  });
  const body = await response.json() as { ok?: boolean };
  if (!response.ok || body.ok !== true) throw new Error(`Telegram HTTP ${response.status}, ok=${body.ok === true}`);
}

// Вызывается под общей блокировкой сборщика. Не больше 10 сообщений / 15 с
// за прогон; неудачная доставка повторяется через 30 минут, без регенерации.
export async function flushSummaryAlerts(): Promise<void> {
  await initAlerts();
  const { rows } = await pool.query<{ link: string; payload: SummaryAlert }>(
    "SELECT link, payload FROM summary_quality_alerts WHERE sent_at IS NULL AND next_attempt_at <= now() ORDER BY next_attempt_at, created_at LIMIT 10");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (rows.length && (!token || !chat)) {
    console.error("SUMMARY_ALERT_PENDING: Telegram не настроен; уведомления остаются в очереди");
    return;
  }
  const started = Date.now();
  for (const row of rows) {
    if (Date.now() - started >= 10_000) break;
    await pool.query("UPDATE summary_quality_alerts SET delivery_attempts = delivery_attempts + 1, next_attempt_at = now() + interval '30 minutes' WHERE link = $1", [row.link]);
    try {
      await sendSummaryAlert(row.payload, token!, chat!);
    } catch {
      // Не печатаем исключение fetch: в URL содержится токен бота.
      console.error(`SUMMARY_ALERT_PENDING: доставка не удалась (${row.link})`);
      continue;
    }
    await pool.query("UPDATE summary_quality_alerts SET sent_at = now() WHERE link = $1", [row.link]);
    console.log(`SUMMARY_ALERT_SENT ${row.link}`);
  }
  // Недоставленные уведомления не удаляем при очистке истории.
  await pool.query("DELETE FROM summary_quality_alerts WHERE sent_at < now() - interval '56 days'");
}
