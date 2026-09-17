import "dotenv/config";
import { SUMMARY_PROMPT, ensureCompleteSentence } from "./prompt.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_RETRIES = 4;

// Список ключей через запятую (GEMINI_API_KEYS) — у бесплатного тарифа квота
// per-project-per-model, так что каждый ключ от отдельного проекта Google AI
// Studio даёт независимый лимит. GEMINI_API_KEY — старое имя переменной с
// одним ключом, оставлено для обратной совместимости.
function getApiKeys(): string[] {
  const list = process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? "";
  return list
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// Gemini отдаёт квоту как вложенный JSON (details[] с QuotaFailure/RetryInfo)
// вместо понятного текста — разбираем его в читаемое сообщение, чтобы в
// логах пайплайна сразу было видно "лимит исчерпан", а не сырой JSON.
function describeQuotaError(model: string, body: string): string {
  try {
    const parsed = JSON.parse(body);
    const details = parsed?.error?.details ?? [];
    const quotaId = details.find((d: { "@type"?: string }) => d["@type"]?.includes("QuotaFailure"))
      ?.violations?.[0]?.quotaId;
    return `Gemini: лимит запросов исчерпан для модели "${model}"` + (quotaId ? ` (${quotaId})` : "");
  } catch {
    return `Gemini: лимит запросов исчерпан для модели "${model}"`;
  }
}

export async function summarize(
  title: string,
  rawSummary: string,
  systemPrompt: string = SUMMARY_PROMPT
): Promise<string> {
  const model = process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest";
  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) throw new Error("Gemini: не задан ни один ключ (GEMINI_API_KEYS)");

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: `Заголовок: ${title}\n\nТекст: ${rawSummary}` }] }],
    generationConfig: {
      temperature: 0.3,
      // С запасом — покрывает и короткое саммари (~300-350 символов), и
      // подробное для модалки (~700-900 символов).
      maxOutputTokens: 1000,
      // Без этого модели с "рассуждениями" (gemini-3.x, кроме -lite) иногда
      // утекали черновик размышлений прямо в текст ответа вместо чистого
      // саммари (например, "ТЕМА: sport"\n\n4. **Refining the Summary:**...)
      // — это ломало парсинг темы регуляркой в extractCategory и пропускало
      // спортивные новости мимо фильтра. thinkingBudget: 0 отключает этот
      // черновой этап полностью. У "-lite" моделей режима рассуждений в
      // принципе нет, и сам параметр thinkingConfig для них — невалидный
      // аргумент (400), поэтому шлём его только моделям, которые могут
      // "думать".
      ...(model.includes("lite") ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
    },
  });

  // Внешний цикл — по ключам (переключаемся сразу при 429, ждать нечего,
  // квота у этого ключа для этой модели исчерпана на сегодня); внутренний —
  // по попыткам для ТЕКУЩЕГО ключа (там имеет смысл подождать: 5xx —
  // временная перегрузка сервиса, пустой ответ — редкая заминка модели).
  for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKeys[keyIndex]}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });

      if (res.status === 429) {
        if (keyIndex < apiKeys.length - 1) {
          console.log(`  Gemini: ключ #${keyIndex + 1} исчерпан, переключаюсь на #${keyIndex + 2}`);
          break; // следующий ключ, без паузы
        }
        const errBody = await res.text();
        throw new Error(describeQuotaError(model, errBody));
      }

      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }

      if (!res.ok) {
        throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
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
  }

  throw new Error("Gemini: превышено число повторов");
}
