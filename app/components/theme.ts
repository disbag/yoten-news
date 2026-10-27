// Настройки отображения — тема (DIS-18) и размер текста (DIS-19): хранятся
// только в браузере (localStorage).
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

// Цвет статус-бара и панели браузера (meta theme-color) — фон темы, --bg в
// globals.css. В <head> их два, по prefers-color-scheme (см. viewport в
// app/layout.tsx); при явно выбранной теме оба получают её цвет, иначе полоса
// сверху была бы светлой в тёмной теме приложения и наоборот.
export const THEME_COLORS = { light: "#fbfbfb", dark: "#121315" } as const;
const SYNC_THEME_COLOR = `function(){var t=document.documentElement.dataset.theme;document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){var dark=t?t==="dark":/dark/.test(m.media);m.content=dark?"${THEME_COLORS.dark}":"${THEME_COLORS.light}";});}`;

// Мета-теги theme-color Next.js вставляет в <head> сам — и после этого
// скрипта, и ещё раз при гидратации (бывает дубль), — поэтому цвет
// выставляется сразу и при каждом изменении <head>.
export const DISPLAY_INIT_SCRIPT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")d.dataset.theme=t;var f=localStorage.getItem("${FONT_SIZE_KEY}");if(f==="s"||f==="l"||f==="xl")d.dataset.fontSize=f;var s=${SYNC_THEME_COLOR};s();document.addEventListener("DOMContentLoaded",s);new MutationObserver(s).observe(document.head,{childList:true});}catch(e){}})();`;

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
  syncThemeColor();
}

function syncThemeColor() {
  const theme = document.documentElement.dataset.theme;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const dark = theme ? theme === "dark" : /dark/.test(meta.media);
    meta.content = dark ? THEME_COLORS.dark : THEME_COLORS.light;
  });
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
