import { createHash } from "node:crypto";

export const SUBSTANTIAL_CONTENT_CHARS = 600;
export const PARSER_VERSION = "dis86-v1";
export type ContentOrigin = "rss" | "rss_cms" | "page" | "description" | "rss_snippet";

// Измеряем контекст эмбеддинга, а не метаданные страницы. Длина сама по
// себе не доказывает полноту или фактическую точность.
export function describeContext(text: string, origin: ContentOrigin) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return { chars: normalized.length, origin,
    fingerprint: createHash("sha256").update(normalized).digest("hex"),
    version: PARSER_VERSION, isThin: normalized.length < SUBSTANTIAL_CONTENT_CHARS };
}
