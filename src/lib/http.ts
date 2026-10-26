// Общее для всех запросов к сайтам изданий: RSS, страницы статей, картинки.
// Без браузерного User-Agent часть изданий отвечает заглушкой или 403 даже на
// открытые страницы.
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
