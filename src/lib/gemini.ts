import "dotenv/config";
import { SUMMARY_PROMPT, ensureCompleteSentence } from "./prompt.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_RETRIES = 4;

// Специальный тип ошибки — весь перебор моделей и ключей (см. ниже) исчерпан,
// дальше пытаться нет смысла: любой следующий вызов упрётся в ту же стену.
// fetchAndProcess.ts ловит именно этот тип отдельно от обычных ошибок
// саммаризации одной статьи (сетевой сбой, пустой ответ и т.п.) — там
// достаточно пропустить статью и пойти дальше, а здесь единственный
// осмысленный вариант — полностью остановить пайплайн, а не долбить те же
// исчерпанные лимиты на каждой следующей статье до конца списка источников.
export class GeminiQuotaExhaustedError extends Error {}

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

// Список моделей через запятую (GEMINI_MODELS) — перебираются по порядку
// ПОСЛЕ того, как все ключи исчерпаны на текущей модели (см. summarize ниже):
// сначала все ключи на models[0], затем все ключи на models[1] и т.д.
// GEMINI_MODEL — старое имя переменной с одной моделью, для совместимости.
function getModels(): string[] {
  const list = process.env.GEMINI_MODELS ?? process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest";
  return list
    .split(",")
    .map((m) => m.trim())
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
    return `модель "${model}"` + (quotaId ? ` (${quotaId})` : "");
  } catch {
    return `модель "${model}"`;
  }
}

function buildRequestBody(title: string, rawSummary: string, systemPrompt: string, model: string) {
  return JSON.stringify({
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
}

export async function summarize(
  title: string,
  rawSummary: string,
  systemPrompt: string = SUMMARY_PROMPT
): Promise<string> {
  const models = getModels();
  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) throw new Error("Gemini: не задан ни один ключ (GEMINI_API_KEYS)");

  const exhausted: string[] = [];

  // Перебор: все ключи на первой модели, затем все ключи на второй модели и
  // т.д. — переключение модели ТОЛЬКО после того, как все ключи текущей себя
  // исчерпали, не раньше (см. запрошенный порядок: 3 ключа на Flash Lite 3.5,
  // потом те же 3 ключа заново на Flash Lite 3.1).
  for (const model of models) {
    const body = buildRequestBody(title, rawSummary, systemPrompt, model);

    for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKeys[keyIndex]}`;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });

        if (res.status === 429) {
          exhausted.push(describeQuotaError(model, await res.text()));
          const isLastKey = keyIndex === apiKeys.length - 1;
          const isLastModel = model === models[models.length - 1];
          if (isLastKey && isLastModel) {
            throw new GeminiQuotaExhaustedError(
              `Gemini: лимит исчерпан у всех ${apiKeys.length} ключей на всех ${models.length} моделях (${exhausted.join(", ")}). Добавь новый ключ в GEMINI_API_KEYS или подожди сброса лимита.`
            );
          }
          console.log(
            isLastKey
              ? `  Gemini: модель "${model}" исчерпана на всех ключах, переключаюсь на модель "${models[models.indexOf(model) + 1]}"`
              : `  Gemini: ключ #${keyIndex + 1} исчерпан для "${model}", переключаюсь на ключ #${keyIndex + 2}`
          );
          break; // следующий ключ (а если это был последний — внешний цикл перейдёт к следующей модели)
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
  }

  throw new Error("Gemini: превышено число повторов");
}
