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
import { sleep } from "./http.js";
import { checkedSummary, looksNonRussian, summaryQualityIssues, MAX_SUMMARY_ATTEMPTS, type SummaryBudget } from "./summaryQuality.js";
import { validateTranslatedTitles, parseTranslatedTitles, TITLE_TRANSLATION_PROMPT, type ArticleTitle } from "./titleTranslation.js";

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
// вызывающем коде. Для промптов без разметки темы
// extractCategory просто вернёт text как есть с category: null — вызывающий
// код сам решает, что делать с полем summary.
export async function summarize(
  title: string,
  rawSummary: string,
  systemPrompt: string = SUMMARY_PROMPT,
  budget: SummaryBudget = { attempts: 0, reasons: [] }
): Promise<SummaryResult> {
  const articlePrompt = systemPrompt === SUMMARY_PROMPT || systemPrompt === LEAD_AND_MORE_PROMPT;
  const raw = await checkedSummary(async (attempt, reasons) => {
    // Повтор — с напоминанием и в системном промпте, и в конце текста статьи,
    // а последняя попытка — другой моделью (Groq): на некоторых статьях
    // gemini-3.5-flash-lite отвечала по-украински даже с напоминанием
    // примерно два раза из трёх.
    const remind = attempt > 1;
    const prompt = remind ? systemPrompt + LANGUAGE_REMINDER + `\nИсправь ошибки предыдущего ответа: ${reasons.join(", ")}.` : systemPrompt;
    const text = remind ? rawSummary + LANGUAGE_REMINDER : rawSummary;
    const lastTry = attempt === MAX_SUMMARY_ATTEMPTS;
    return (
      lastTry && hasGroqKey()
        ? await summarizeWithGroq(title, text, prompt)
        : await generate(title, text, prompt));
  }, raw => articlePrompt
    ? summaryQualityIssues(extractCategory(raw).summary, systemPrompt === LEAD_AND_MORE_PROMPT)
    : looksNonRussian(raw) ? ["language"] : [], budget);
  return extractCategory(raw);
}

// Изредка модель (реально — gemini-3.5-flash-lite) пишет пересказ на соседнем
// кириллическом языке вместо русского, несмотря на "Пиши на русском" в
// промпте: за месяц нашлись три такие карточки — одна на казахском, две на
// украинском. Отличаем по буквам, которых в русском нет; порог 3, чтобы
// одиночная буква в чужом имени собственном не считалась ошибкой. Такой ответ
// не принимаем — переспрашиваем с явным напоминанием о языке (последний раз —
// у Groq), а после MAX_SUMMARY_ATTEMPTS неудач бросаем SummaryQualityError:
// сборщик блокирует повторную обработку ссылки через skipped_links.
//
// Ответ не кириллицей ловится по доле кириллицы среди букв: 19 октября
// запасной Groq (пока Gemini был перегружен) пересказал статью Polygon целиком
// по-английски, и буквенная проверка выше его пропустила. У русских
// пересказов с английскими названиями игр и компаний эта доля не ниже 0,45
// (все 6799 текстов базы на 20 октября), у английского ответа — 0. Короткие
// ответы не проверяем: NO_CONTENT — не текст.
const LANGUAGE_REMINDER =
  "\n\nВАЖНО: весь ответ — строго на русском языке. Главное должно содержать факты и завершённые предложения, а не отдельное слово или обрывок фразы.";


// Groq — запасной вариант, когда Gemini не отвечает целиком (все модели и
// ключи: перегрузка или квота, см. GeminiQuotaExhaustedError). После такого
// сбоя следующие GEMINI_PAUSE_MS идём сразу в Groq — иначе каждая статья
// сначала тратила бы минуту на перебор заведомо лежащих моделей, — а потом
// снова пробуем Gemini: к тому времени он часто уже оживает. Новый прогон
// (новый процесс) в любом случае начинает с Gemini. Исчерпан и суточный
// лимит Groq — бросаем GeminiQuotaExhaustedError без unavailable, и
// fetchAndProcess.ts останавливает прогон сразу: дальше генерировать нечем.
//
// Перегрузку (не квоту) сначала пережидаем: минута паузы и ещё одна попытка
// Gemini, и только потом Groq — и Groq на GEMINI_PAUSE_MS, а не на 10 минут,
// как было до 20 октября. Сбор объявлял Gemini недоступным уже после двух
// неудачных запросов (по одному на модель) и на 10 минут уходил в Groq:
// 20 октября с 14:00 до 15:00 так случилось четыре раза, суточный лимит Groq
// (200 тыс. токенов) кончился, и следующие прогоны останавливались.
const GEMINI_PAUSE_MS = 3 * 60_000;
const GEMINI_RETRY_DELAY_MS = 60_000;
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
    let down: GeminiQuotaExhaustedError;
    try {
      return await summarizeWithGemini(title, rawSummary, systemPrompt);
    } catch (err) {
      if (!(err instanceof GeminiQuotaExhaustedError)) throw err;
      down = err;
    }
    if (down.unavailable) {
      console.log(`  Gemini: ${describeGeminiDown(down)} — жду ${GEMINI_RETRY_DELAY_MS / 1000} с и пробую ещё раз`);
      await sleep(GEMINI_RETRY_DELAY_MS);
      try {
        return await summarizeWithGemini(title, rawSummary, systemPrompt);
      } catch (err) {
        if (!(err instanceof GeminiQuotaExhaustedError)) throw err;
        down = err;
      }
    }
    if (!hasGroqKey()) throw down;
    geminiPausedUntil = Date.now() + GEMINI_PAUSE_MS;
    geminiDownReason = describeGeminiDown(down);
    console.log(`  Gemini: ${geminiDownReason} — переключаюсь на Groq на ${GEMINI_PAUSE_MS / 60_000} мин`);
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

export async function translateArticleTitles(titles: readonly ArticleTitle[]): Promise<ArticleTitle[]> {
  const input = JSON.stringify(titles);
  const result = await checkedSummary(
    (attempt, reasons) => {
      const prompt = attempt > 1 ? `${TITLE_TRANSLATION_PROMPT}\nИсправь ошибки предыдущего ответа: ${reasons.join(", ")}. Проверь JSON, все id и строки перевода.` : TITLE_TRANSLATION_PROMPT;
      return attempt === MAX_SUMMARY_ATTEMPTS && hasGroqKey()
        ? summarizeWithGroq("Перевод заголовков", input, prompt)
        : generate("Перевод заголовков", input, prompt);
    },
    (raw) => {
      const { issues } = validateTranslatedTitles(raw, titles);
      if (issues.length) console.warn("TITLE_TRANSLATION_REJECTED " + JSON.stringify({
        ids: titles.map(({ id }) => id), reasons: issues,
        responseLength: raw.length, responsePreview: raw.slice(0, 1200),
      }));
      return issues;
    },
    { attempts: 0, reasons: [] },
  );
  return parseTranslatedTitles(result, titles)!;
}

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
  const budget: SummaryBudget = { attempts: 0, reasons: [] };
  const candidates = [sources.excerpt, sources.description, sources.rawSummary].filter(
    (s): s is string => Boolean(s && s.trim())
  );

  for (const input of candidates) {
    const withMore = input.length >= MIN_DETAIL_CONTEXT_LENGTH;
    const result = await summarize(title, input, withMore ? LEAD_AND_MORE_PROMPT : SUMMARY_PROMPT, budget);
    if (isNoContentSignal(result.summary)) continue;
    if (!withMore) return { summary: result.summary, more: null, category: result.category };
    const { lead, more } = splitLeadAndMore(result.summary);
    return { summary: lead, more, category: result.category };
  }

  return { summary: title, more: null, category: null };
}
