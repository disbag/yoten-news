import { isNoContentSignal } from "./prompt.js";

export class InvalidSummaryResponse extends Error {}
export class SummaryQualityError extends Error {
  constructor(public readonly reasons: string[], public readonly attempts: number) {
    super(`Саммари отклонено после ${attempts} попыток: ${reasons.join(", ")}`);
  }
}

export function looksNonRussian(text: string, minLetters = 40): boolean {
  if ((text.match(/[әғқңөұүһіїєґўӘҒҚҢӨҰҮҺІЇЄҐЎ]/g)?.length ?? 0) >= 3) return true;
  const letters = text.match(/\p{L}/gu) ?? [];
  return letters.length >= minLetters && letters.filter(ch => /[\u0400-\u04FF]/.test(ch)).length / letters.length < 0.3;
}

// Проверяем исходные части до исправления пунктуации и подрезания текста.
export function summaryQualityIssues(text: string, withMore: boolean): string[] {
  if (text.trim() === "NO_CONTENT") return [];
  const parts = withMore ? text.split(/\n\s*===\s*(?:\n|$)/) : [text];
  if (parts.length > 2) return ["extra_sections"];
  // При отсутствии === проверяем каждый абзац: он может стать продолжением.
  const sections = parts.flatMap(part => part.trim().split(/\n\s*\n/));
  const issues: string[] = [];
  sections.forEach((part, i) => {
    const t = part.trim();
    const prefix = i === 0 ? "lead" : "more";
    if ((t.match(/\p{L}+/gu)?.length ?? 0) < 4 || (t.match(/\p{L}/gu)?.length ?? 0) < 20) issues.push(`${prefix}:too_short`);
    if (!/[.!?…][»”"')\]]*$/.test(t)) issues.push(`${prefix}:unfinished`);
    if (/(^|\n)\s*(ТЕМА(?=\s|:|$)|главное\s*:|подробности\s*:|часть\s*\d|===|```)/iu.test(t)) issues.push(`${prefix}:markup`);
    if (looksNonRussian(t, 20)) issues.push(`${prefix}:language`);
    if (isNoContentSignal(t) || /^(?:извините[,!]?\s*)?(?:я не могу|я не имею доступа|как (?:языковая модель|ИИ))(?=\s|[,.:!]|$)/iu.test(t)) issues.push(`${prefix}:model_commentary`);
  });
  return [...new Set(issues)];
}

export type SummaryBudget = { attempts: number; reasons: string[] };
export const MAX_SUMMARY_ATTEMPTS = 4;
export async function checkedSummary(
  generate: (attempt: number, previousReasons: string[]) => Promise<string>,
  validate: (text: string) => string[],
  budget: SummaryBudget,
): Promise<string> {
  while (budget.attempts < MAX_SUMMARY_ATTEMPTS) {
    const attempt = ++budget.attempts;
    let issues: string[];
    try {
      const text = await generate(attempt, budget.reasons);
      issues = validate(text);
      if (!issues.length) return text;
    } catch (err) {
      if (!(err instanceof InvalidSummaryResponse)) throw err;
      issues = [err.message];
    }
    budget.reasons = [...new Set([...budget.reasons, ...issues])];
    console.warn("SUMMARY_REJECTED " + JSON.stringify({ attempt, maxAttempts: MAX_SUMMARY_ATTEMPTS, reasons: issues }));
  }
  throw new SummaryQualityError(budget.reasons, budget.attempts);
}
