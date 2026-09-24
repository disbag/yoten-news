import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { SUMMARY_PROMPT, ensureCompleteSentence } from "./prompt.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_RETRIES = 4;
// 503 (UNAVAILABLE) обычно значит перегрузку конкретной модели у Google, а не
// проблему с конкретным ключом — ретраить ту же комбинацию ключ+модель 4 раза
// с полным бэкоффом (2+4+8+16=30с) почти всегда бессмысленно и только тормозит
// весь пайплайн: реальный случай — во время затяжного 503-инцидента у Gemini
// каждая статья тратила 30-90с на ретраи одной и той же модели, прежде чем
// вообще пропуститься как "ошибка саммаризации". Меньше попыток на комбинацию
// — быстрее переключаемся на следующий ключ/модель (см. цикл ниже), где шанс
// получить рабочий ответ выше, чем долбить уже недоступную.
const MAX_RETRIES_5XX = 2;
// AbortSignal.timeout — у fetch() в Node нет своего таймаута, и зависший
// запрос держал весь прогон: реальный случай — запрос к Gemini висел 5 минут,
// пока не упал с "fetch failed" (обычный ответ — секунды). Такой сбой, как и
// обрыв сети, считаем недоступностью именно этой комбинации ключ+модель и
// сразу переходим к следующей, без повторов: иначе худший случай — 3 × 60с
// на одной комбинации.
const REQUEST_TIMEOUT_MS = 60_000;

// Специальный тип ошибки — весь перебор моделей и ключей (см. ниже) исчерпан
// (либо квота, либо стабильный 5xx на каждой комбинации) — дальше пытаться
// нет смысла: любой следующий вызов упрётся в ту же стену. fetchAndProcess.ts
// ловит именно этот тип отдельно от обычных ошибок саммаризации одной статьи
// (сетевой сбой, пустой ответ и т.п.) — там достаточно пропустить статью и
// пойти дальше, а здесь единственный осмысленный вариант — полностью
// остановить пайплайн, а не долбить ту же стену на каждой следующей статье до
// конца списка источников.
//
// unavailable — перебор закончился на 5xx/таймаутах, а не на квоте: это
// перегрузка моделей у Google, лимиты при этом целы (реальный случай — 503
// UNAVAILABLE у всех "-lite" моделей на всех ключах, хотя в AI Studio квота
// почти не тронута). Такой сбой обычно временный и точечный, поэтому
// fetchAndProcess.ts на нём не останавливается сразу (см. там).
export class GeminiQuotaExhaustedError extends Error {
  constructor(
    message: string,
    readonly unavailable = false
  ) {
    super(message);
  }
}

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

// Запоминаем, какая комбинация модель+ключ сработала последней — чтобы
// каждый новый прогон (новый процесс, свежий список из 0 попыток) начинал
// перебор сразу с неё, а не заново с models[0]/keys[0]. Актуально в первую
// очередь для дневной квоты: если ключ №1 исчерпал её вчера в середине
// прогона, без этого каждый следующий прогон today всё равно начинал бы с
// него и первым делом ловил бы гарантированный 429. Файл — не в БД: это
// служебное состояние самого пайплайна, а не данные приложения.
const STATE_PATH = path.join(process.cwd(), ".gemini-state.json");

type GeminiState = { model: string; keyIndex: number };

function loadState(): GeminiState | null {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function saveState(state: GeminiState): void {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch {
    // Не критично — просто не сможем начать со сработавшей комбинации в
    // следующий раз, само по себе не ломает саммаризацию.
  }
}

// Плоский список всех комбинаций (модель, индекс ключа) в порядке перебора
// по умолчанию: все ключи на models[0], потом все ключи на models[1] и т.д.
// — тот же порядок, что раньше был жёстко зашит во вложенных циклах.
function buildComboOrder(models: string[], apiKeys: string[]): { model: string; keyIndex: number }[] {
  return models.flatMap((model) => apiKeys.map((_, keyIndex) => ({ model, keyIndex })));
}

// Циклический сдвиг списка так, чтобы он начинался с сохранённой рабочей
// комбинации — весь список всё равно проходится целиком (просто с другой
// точки старта), так что fallback на остальные модели/ключи никуда не
// делся, если сохранённая комбинация вдруг тоже перестала работать.
function rotateToLastKnownGood(
  combos: { model: string; keyIndex: number }[],
  state: GeminiState | null
): { model: string; keyIndex: number }[] {
  if (!state) return combos;
  const startIndex = combos.findIndex((c) => c.model === state.model && c.keyIndex === state.keyIndex);
  if (startIndex <= 0) return combos; // не нашли (конфиг поменялся) — начинаем как обычно
  return [...combos.slice(startIndex), ...combos.slice(0, startIndex)];
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
      // С запасом на самый длинный ответ — главное (до 500 символов) плюс
      // продолжение под кат (до 200 слов, ~1500 символов) плюс строка темы.
      // Упереться в лимит на середине значит потерять конец продолжения.
      maxOutputTokens: 1500,
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

  const combos = rotateToLastKnownGood(buildComboOrder(models, apiKeys), loadState());
  const exhausted: string[] = [];

  for (let i = 0; i < combos.length; i++) {
    const { model, keyIndex } = combos[i];
    const body = buildRequestBody(title, rawSummary, systemPrompt, model);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKeys[keyIndex]}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }).catch((err: Error) => err);
      // Таймаут или сетевой сбой — ответа нет вовсе (см. REQUEST_TIMEOUT_MS).
      const noResponse = res instanceof Error;

      // 429 (квота), стабильный 5xx (после MAX_RETRIES_5XX попыток именно
      // этой комбинации) и отсутствие ответа обрабатываются одинаково — эта
      // комбинация ключ+модель сейчас нерабочая, переключаемся на следующую, а
      // не бросаем всю статью как ошибку.
      const quotaExceeded = !noResponse && res.status === 429;
      const serviceDown = noResponse || (res.status >= 500 && attempt >= MAX_RETRIES_5XX);
      if (quotaExceeded || serviceDown) {
        exhausted.push(
          noResponse
            ? `модель "${model}" (${res.name === "TimeoutError" ? "таймаут" : res.message})`
            : quotaExceeded
              ? describeQuotaError(model, await res.text())
              : `модель "${model}" (${res.status})`
        );
        if (i === combos.length - 1) {
          throw new GeminiQuotaExhaustedError(
            quotaExceeded
              ? `Gemini: лимит исчерпан у всех ${apiKeys.length} ключей на всех ${models.length} моделях (${exhausted.join(", ")}). Добавь новый ключ в GEMINI_API_KEYS или подожди сброса лимита.`
              : `Gemini: модели перегружены (5xx/таймаут, лимиты не исчерпаны) у всех ${apiKeys.length} ключей на всех ${models.length} моделях (${exhausted.join(", ")}). Временный сбой на стороне Google.`,
            !quotaExceeded
          );
        }
        const next = combos[i + 1];
        const why = noResponse ? (res.name === "TimeoutError" ? "таймаут" : "нет ответа") : "5xx";
        const reason = quotaExceeded ? "исчерпана" : `недоступна (${why})`;
        const reasonKey = quotaExceeded ? "исчерпан" : `недоступен (${why})`;
        console.log(
          next.model !== model
            ? `  Gemini: модель "${model}" ${reason} на всех ключах, переключаюсь на модель "${next.model}"`
            : `  Gemini: ключ #${keyIndex + 1} ${reasonKey} для "${model}", переключаюсь на ключ #${next.keyIndex + 1}`
        );
        break; // следующая комбинация в перебор
      }
      if (noResponse) break; // недостижимо (обработано выше) — сужение типа для TypeScript

      if (res.status >= 500) {
        // ещё остались попытки для ЭТОЙ комбинации (attempt < MAX_RETRIES_5XX)
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
      saveState({ model, keyIndex });
      return ensureCompleteSentence(text);
    }
  }

  throw new Error("Gemini: превышено число повторов");
}
