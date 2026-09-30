// Настройки отображения — тема (DIS-18) и размер текста (DIS-19): хранятся
// только в браузере, общие для гостя и вошедшего.
//
// Тема: "system" — атрибута data-theme на <html> нет, и тему выбирает media
// query prefers-color-scheme в globals.css (сама меняется вслед за системой).
// Размер текста: data-font-size на <html>, переменная --font-scale в
// globals.css; "m" — обычный, атрибута нет.
// Те же ключи и правила читает скрипт в <head> — см. DISPLAY_INIT_SCRIPT, он
// применяет настройки ещё до первой отрисовки страницы.
export type Theme = "light" | "dark" | "system";

export const THEME_KEY = "theme";

export const FONT_SIZES = ["s", "m", "l", "xl"] as const;
export type FontSize = (typeof FONT_SIZES)[number];
export const FONT_SIZE_LABELS: Record<FontSize, string> = {
  s: "Мелкий",
  m: "Обычный",
  l: "Крупный",
  xl: "Очень крупный",
};

export const FONT_SIZE_KEY = "fontSize";

export const DISPLAY_INIT_SCRIPT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")d.dataset.theme=t;var f=localStorage.getItem("${FONT_SIZE_KEY}");if(f==="s"||f==="l"||f==="xl")d.dataset.fontSize=f;}catch(e){}})();`;

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Хранилище недоступно (приватный режим и т.п.) — настройка применится
    // только до перезагрузки страницы.
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getStoredTheme(): Theme {
  const value = read(THEME_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

export function applyTheme(theme: Theme) {
  store(THEME_KEY, theme === "system" ? null : theme);
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function getStoredFontSize(): FontSize {
  const value = read(FONT_SIZE_KEY);
  return (FONT_SIZES as readonly string[]).includes(value ?? "") ? (value as FontSize) : "m";
}

export function applyFontSize(size: FontSize) {
  store(FONT_SIZE_KEY, size === "m" ? null : size);
  if (size === "m") delete document.documentElement.dataset.fontSize;
  else document.documentElement.dataset.fontSize = size;
}
