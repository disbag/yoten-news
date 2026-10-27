import type { MetadataRoute } from "next";
import { THEME_COLORS } from "./components/theme";

// Манифест веб-приложения: добавленный на экран «Домой» Yoten открывается на
// весь экран, без адресной строки браузера (display: standalone). Цвета — фон
// светлой темы: заставка при запуске и полоса задач Android.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Yoten — новостная лента",
    short_name: "Yoten",
    description: "Свежие новости без повторов, в двух предложениях",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
    lang: "ru",
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
