import { summaryQualityIssues } from "./summaryQuality.js";

export function parseThreadAnswer(raw: string, max: number): { thread: number; details: string | null } | null {
  const match = raw.trim().match(/^ТРЕД:\s*(\d+)\s*\nНОВОЕ:\s*([\s\S]+)$/iu);
  if (!match) return null;
  const thread = Number(match[1]);
  if (!Number.isSafeInteger(thread) || thread < 0 || thread > max) return null;
  const text = match[2].trim();
  const details = /^нет\.?$/iu.test(text) ? null : text;
  if (thread === 0 && details !== null) return null;
  return { thread, details };
}

export function threadQualityIssues(raw: string, max: number): string[] {
  const result = parseThreadAnswer(raw, max);
  if (!result) return ["thread_format"];
  if (result.details === null) return [];
  if (result.details === "NO_CONTENT") return ["thread_no_content"];
  return summaryQualityIssues(result.details, false);
}
