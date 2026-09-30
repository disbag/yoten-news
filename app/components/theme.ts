// Тема оформления (DIS-18): хранится только в браузере, общая для гостя и
// вошедшего. "system" — атрибута data-theme на <html> нет, и тему выбирает
// media query prefers-color-scheme в globals.css (сама меняется вслед за
// системой). Тот же ключ и те же правила читает скрипт в <head> — см.
// THEME_INIT_SCRIPT, он применяет тему ещё до первой отрисовки страницы.
export type Theme = "light" | "dark" | "system";

export const THEME_KEY = "theme";

export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}})();`;

export function getStoredTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Хранилище недоступно (приватный режим и т.п.) — тема применится
    // только до перезагрузки страницы.
  }
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
