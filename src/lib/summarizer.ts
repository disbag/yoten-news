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
  for (let attempt = 0; attempt < MAX_LANGUAGE_ATTEMPTS; attempt++) {
    // Повтор — с напоминанием и в системном промпте, и в конце текста статьи,
    // а последняя попытка — другой моделью (Groq): на некоторых статьях
    // gemini-3.5-flash-lite отвечала по-украински даже с напоминанием
    // примерно два раза из трёх.
    const remind = attempt > 0;
    const prompt = remind ? systemPrompt + LANGUAGE_REMINDER : systemPrompt;
    const text = remind ? rawSummary + LANGUAGE_REMINDER : rawSummary;
    const lastTry = attempt === MAX_LANGUAGE_ATTEMPTS - 1;
    const raw =
      lastTry && hasGroqKey()
        ? await summarizeWithGroq(title, text, prompt).catch((err: Error) => {
            throw new Error(`модель отвечала не на русском, запасной Groq недоступен: ${err.message}`);
          })
        : await generate(title, text, prompt);
    if (!looksNonRussian(raw)) return extractCategory(raw);
    console.log(`  модель ответила не на русском (попытка ${attempt + 1}) — переспрашиваю`);
  }
  throw new Error(`модель ${MAX_LANGUAGE_ATTEMPTS} раза подряд ответила не на русском`);
}

// Изредка модель (реально — gemini-3.5-flash-lite) пишет пересказ на соседнем
// кириллическом языке вместо русского, несмотря на "Пиши на русском" в
// промпте: за месяц нашлись три такие карточки — одна на казахском, две на
// украинском. Отличаем по буквам, которых в русском нет; порог 3, чтобы
// одиночная буква в чужом имени собственном не считалась ошибкой. Такой ответ
// не принимаем — переспрашиваем с явным напоминанием о языке (последний раз —
// у Groq), а после MAX_LANGUAGE_ATTEMPTS неудач бросаем ошибку: статья
// пропускается и обработается следующим прогоном (см. fetchAndProcess.ts).
const NON_RUSSIAN_LETTERS = /[әғқңөұүһіїєґўӘҒҚҢӨҰҮҺІЇЄҐЎ]/g;
const MAX_LANGUAGE_ATTEMPTS = 4;
const LANGUAGE_REMINDER =
  "\n\nВАЖНО: весь ответ — строго на русском языке, не на казахском, украинском или любом другом.";

function looksNonRussian(text: string): boolean {
  return (text.match(NON_RUSSIAN_LETTERS)?.length ?? 0) >= 3;
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
// Почему ушли в Groq — для понятного сообщения при остановке.
let geminiDownReason = "";

// Без подробностей по каждой комбинации ключ+модель — они уже в логе выше.
function describeGeminiDown(err: GeminiQuotaExhaustedError): string {
  return err.unavailable
    ? "серверы Google перегружены (503/таймауты на всех моделях и ключах), ваши лимиты целы"
    : "лимиты исчерпаны на всех ключах и моделях";
}

async function generate(title: string, rawSummary: string, systemPrompt: string): Promise<string> {
  if (Date.now() >= geminiPausedUntil) {
    try {
      return await summarizeWithGemini(title, rawSummary, systemPrompt);
    } catch (err) {
      if (!(err instanceof GeminiQuotaExhaustedError) || !hasGroqKey()) throw err;
      geminiPausedUntil = Date.now() + GEMINI_PAUSE_MS;
      geminiDownReason = describeGeminiDown(err);
      console.log(`  Gemini: ${geminiDownReason} — переключаюсь на Groq на ${GEMINI_PAUSE_MS / 60_000} мин`);
    }
  }
  try {
    return await summarizeWithGroq(title, rawSummary, systemPrompt);
  } catch (err) {
    if (err instanceof GroqLimitError) {
      throw new GeminiQuotaExhaustedError(
        `Останавливаю прогон. Gemini: ${geminiDownReason}. Запасной Groq: ${err.message}. Следующий прогон снова начнёт с Gemini.`
      );
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
