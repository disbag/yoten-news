import { SOURCES } from "../config/sources.js";
import { sourceSlug } from "./sourceSlug.js";

// Издание по адресу его страницы (только на сервере: тянет весь конфиг).
export function sourceBySlug(slug: string) {
  return SOURCES.find((s) => sourceSlug(s.name) === slug);
}
