import "dotenv/config";
import { SUMMARY_PROMPT, ensureCompleteSentence } from "./prompt.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_RETRIES = 4;

// Gemini отдаёт квоту как вложенный JSON (details[] с QuotaFailure/RetryInfo)
// вместо понятного текста — разбираем его в читаемое сообщение, чтобы в
// логах пайплайна сразу было видно "лимит исчерпан", а не сырой JSON.
function describeQuotaError(model: string, body: string): string {
  try {
    const parsed = JSON.parse(body);
    const details = parsed?.error?.details ?? [];
    const quotaId = details.find((d: { "@type"?: string }) => d["@type"]?.includes("QuotaFailure"))
      ?.violations?.[0]?.quotaId;
    const retryDelay = details.find((d: { "@type"?: string }) => d["@type"]?.includes("RetryInfo"))
      ?.retryDelay;
    return (
      `Gemini: лимит запросов исчерпан для модели "${model}"` +
      (quotaId ? ` (${quotaId})` : "") +
      (retryDelay ? `, попробуйте снова через ${retryDelay}` : "") +
      `. Смените GEMINI_MODEL в .env или подождите сброса лимита.`
    );
  } catch {
    return `Gemini: лимит запросов исчерпан для модели "${model}". Смените GEMINI_MODEL в .env или подождите сброса лимита.`;
  }
}

export async function summarize(
  title: string,
  rawSummary: string,
  systemPrompt: string = SUMMARY_PROMPT
): Promise<string> {
  const model = process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest";
  // GEMINI_API_KEY_2 — второй проект Google AI Studio с полностью независимой
  // от первого квотой (см. .env) — предпочитаем его, когда задан.
  const apiKey = process.env.GEMINI_API_KEY_2 ?? process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [
          { role: "user", parts: [{ text: `Заголовок: ${title}\n\nТекст: ${rawSummary}` }] },
        ],
        generationConfig: {
          temperature: 0.3,
          // С запасом — покрывает и короткое саммари (~300-350 символов), и
          // подробное для модалки (~700-900 символов).
          maxOutputTokens: 1000,
          // Без этого модели с "рассуждениями" (gemini-3.x, кроме -lite)
          // иногда утекали черновик размышлений прямо в текст ответа вместо
          // чистого саммари (например, "ТЕМА: sport"\n\n4. **Refining the
          // Summary:**...) — это ломало парсинг темы регуляркой в
          // extractCategory и пропускало спортивные новости мимо фильтра.
          // thinkingBudget: 0 отключает этот черновой этап полностью. У
          // "-lite" моделей режима рассуждений в принципе нет, и сам параметр
          // thinkingConfig для них — невалидный аргумент (400), поэтому шлём
          // его только моделям, которые могут "думать".
          ...(model.includes("lite") ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
        },
      }),
    });

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error(describeQuotaError(model, body));
      throw new Error(`Gemini error ${res.status}: ${body}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      if (attempt < MAX_RETRIES) {
        await sleep(1000);
        continue;
      }
      throw new Error("Gemini вернул пустой ответ");
    }
    return ensureCompleteSentence(text);
  }

  throw new Error("Gemini: превышено число повторов");
}
