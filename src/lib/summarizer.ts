import "dotenv/config";
import { summarize as summarizeWithGemini } from "./gemini.js";
import { isNoContentSignal, extractCategory, SUMMARY_PROMPT, type Category } from "./prompt.js";

export type SummaryResult = { summary: string; category: Category[] | null };

// Единая точка, через которую проходит любой сырой ответ модели — поэтому
// разбор темы (см. extractCategory) делается здесь один раз, а не в каждом
// вызывающем коде. Для промптов без разметки темы (DETAILED_SUMMARY_PROMPT,
// CATEGORY_ONLY_PROMPT) extractCategory просто вернёт text как есть с
// category: null — вызывающий код сам решает, что делать с полем summary.
export async function summarize(
  title: string,
  rawSummary: string,
  systemPrompt: string = SUMMARY_PROMPT
): Promise<SummaryResult> {
  const raw = await summarizeWithGemini(title, rawSummary, systemPrompt);
  return extractCategory(raw);
}

// Пробует несколько источников контекста по убыванию качества (обычно:
// вытащенный текст статьи > og:description > сниппет из RSS). Если модель
// сигналит NO_CONTENT (см. src/lib/prompt.ts — контекст оказался мусором,
// например навигацией сайта или заглушкой без текста), пробует следующий,
// более простой источник, вместо того чтобы сохранить отказ модели как
// саммари. systemPrompt позволяет переиспользовать ту же логику отката для
// подробной версии (DETAILED_SUMMARY_PROMPT) в модальном окне.
export async function summarizeWithFallback(
  title: string,
  sources: { excerpt?: string; description?: string; rawSummary: string },
  systemPrompt: string = SUMMARY_PROMPT
): Promise<SummaryResult> {
  const candidates = [sources.excerpt, sources.description, sources.rawSummary].filter(
    (s): s is string => Boolean(s && s.trim())
  );

  for (const input of candidates) {
    const result = await summarize(title, input, systemPrompt);
    if (!isNoContentSignal(result.summary)) return result;
  }

  // Ни один источник контекста не дал реального текста (например, RSS-фид
  // отдал только заголовок, а страница статьи — навигационный мусор или
  // вовсе не текстовый контент вроде карикатуры). Возвращаем заголовок как
  // есть — это лучше, чем сохранить сигнал NO_CONTENT как видимое саммари.
  return { summary: title, category: null };
}
