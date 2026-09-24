import "dotenv/config";
import { summarize as summarizeWithGemini, GeminiQuotaExhaustedError } from "./gemini.js";
import { summarize as summarizeWithGroq, GroqLimitError, hasGroqKey } from "./groq.js";
import {
  isNoContentSignal,
  extractCategory,
  splitLeadAndMore,
  SUMMARY_PROMPT,
  LEAD_AND_MORE_PROMPT,
  type Category,
} from "./prompt.js";

export type SummaryResult = { summary: string; category: Category[] | null };

// Ниже этой длины исходного текста — только короткое саммари без ката "Читать":
// у NYT/WSJ/Bloomberg и т.п. страница платная/заблокирована для бота и есть
// лишь тизер короче итогового саммари — продолжение на нём всегда выходило бы
// домысливанием. Экономит и квоту: такой запрос короче. 600, а не 300: на
// тексте в 300-600 символов почти всё уже помещается в главное, и продолжение
// выходило пустым пересказом (реальный случай — Variety, 392 символа текста →
// 18 слов продолжения, ничего нового).
export const MIN_DETAIL_CONTEXT_LENGTH = Number(process.env.MIN_DETAIL_CONTEXT_LENGTH ?? 600);

// Единая точка, через которую проходит любой сырой ответ модели — поэтому
// разбор темы (см. extractCategory) делается здесь один раз, а не в каждом
// вызывающем коде. Для промптов без разметки темы (CATEGORY_ONLY_PROMPT)
// extractCategory просто вернёт text как есть с category: null — вызывающий
// код сам решает, что делать с полем summary.
export async function summarize(
  title: string,
  rawSummary: string,
  systemPrompt: string = SUMMARY_PROMPT
): Promise<SummaryResult> {
  const raw = await generate(title, rawSummary, systemPrompt);
  return extractCategory(raw);
}

// Groq — запасной вариант, когда Gemini не отвечает целиком (все модели и
// ключи: перегрузка или квота, см. GeminiQuotaExhaustedError). После такого
// сбоя следующие GEMINI_PAUSE_MS идём сразу в Groq — иначе каждая статья
// сначала тратила бы минуту на перебор заведомо лежащих моделей, — а потом
// снова пробуем Gemini: к тому времени он часто уже оживает. Новый прогон
// (новый процесс) в любом случае начинает с Gemini. Исчерпан и суточный
// лимит Groq — бросаем GeminiQuotaExhaustedError без unavailable, и
// fetchAndProcess.ts останавливает прогон сразу: дальше генерировать нечем.
const GEMINI_PAUSE_MS = 10 * 60_000;
let geminiPausedUntil = 0;

async function generate(title: string, rawSummary: string, systemPrompt: string): Promise<string> {
  if (Date.now() >= geminiPausedUntil) {
    try {
      return await summarizeWithGemini(title, rawSummary, systemPrompt);
    } catch (err) {
      if (!(err instanceof GeminiQuotaExhaustedError) || !hasGroqKey()) throw err;
      geminiPausedUntil = Date.now() + GEMINI_PAUSE_MS;
      console.log(`  ${err.message.slice(0, 120)}… — переключаюсь на Groq на ${GEMINI_PAUSE_MS / 60_000} мин`);
    }
  }
  try {
    return await summarizeWithGroq(title, rawSummary, systemPrompt);
  } catch (err) {
    if (err instanceof GroqLimitError) {
      throw new GeminiQuotaExhaustedError(`Gemini недоступен, а у запасного Groq ${err.message}. Останавливаю прогон.`);
    }
    throw err;
  }
}

export type ArticleSummary = { summary: string; more: string | null; category: Category[] | null };

// Саммари статьи для ленты — ОДНИМ запросом к модели: для полного текста
// (>= MIN_DETAIL_CONTEXT_LENGTH) сразу главное + продолжение под кат, для
// тизера — только короткое саммари. Пробует источники контекста по убыванию
// качества (текст статьи > og:description > сниппет из RSS): если модель
// сигналит NO_CONTENT (контекст оказался мусором — навигацией сайта или
// заглушкой), берёт следующий. Формат выбирается по длине именно того
// источника, на котором сработало: откат с полного текста на короткий
// og:description не должен давать продолжение из ничего.
// summary === title — тот же сигнал "у статьи нет текста", что и раньше.
export async function summarizeArticle(
  title: string,
  sources: { excerpt?: string; description?: string; rawSummary: string }
): Promise<ArticleSummary> {
  const candidates = [sources.excerpt, sources.description, sources.rawSummary].filter(
    (s): s is string => Boolean(s && s.trim())
  );

  for (const input of candidates) {
    const withMore = input.length >= MIN_DETAIL_CONTEXT_LENGTH;
    const result = await summarize(title, input, withMore ? LEAD_AND_MORE_PROMPT : SUMMARY_PROMPT);
    if (isNoContentSignal(result.summary)) continue;
    if (!withMore) return { summary: result.summary, more: null, category: result.category };
    const { lead, more } = splitLeadAndMore(result.summary);
    return { summary: lead, more, category: result.category };
  }

  return { summary: title, more: null, category: null };
}
