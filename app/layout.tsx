import type { Metadata, Viewport } from "next";
import { Lora, Onest } from "next/font/google";
import "./globals.css";
import { DISPLAY_INIT_SCRIPT, THEME_COLORS } from "./components/theme";

// Lora — тёплая книжная антиква с поддержкой кириллицы, в духе редакторских
// изданий вроде Kinfolk (в отличие от многих серифов на Google Fonts, не
// молчаливо откатывается на дефолтный шрифт на русском тексте).
const lora = Lora({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-serif",
});

// Onest — гротеск для текста самой новости (см. .summary в FeedCard.tsx) и,
// с редизайна 2026 года, для меню/табов/сайдбара (Light-начертание 300 —
// см. Sidebar.tsx, MobileChrome.tsx, FeedTabs.tsx). 700 — название издания на
// его странице (SourceHeader.tsx).
const onest = Onest({
  subsets: ["latin", "cyrillic"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-news",
});

export const metadata: Metadata = {
  title: "Yoten — новостная лента",
  description: "Свежие новости без повторов, в двух предложениях",
  // Подпись под иконкой при добавлении сайта на главный экран iPhone — без
  // неё iOS подставит начало title и обрежет его. Сами иконки — файлы
  // app/icon.png и app/apple-icon.png, Next подключает их сам.
  // capable + black-translucent — открытый с экрана «Домой» Yoten идёт на весь
  // экран под статус-бар, как приложение; отступы от выреза — через
  // env(safe-area-inset-*) (см. globals.css, MobileChrome.tsx). Манифест —
  // app/manifest.ts.
  appleWebApp: { title: "Yoten", capable: true, statusBarStyle: "black-translucent" },
};

// viewport-fit=cover — страница рисуется до краёв экрана, под вырез и полосу
// «Домой» (без него env(safe-area-inset-*) всегда 0). Масштабирование не
// запрещаем: это проблема доступности. theme-color — по теме, см. theme.ts.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning — скрипт темы ставит data-theme на <html> до
    // гидратации, и серверная разметка (без атрибута) с ней не совпадёт.
    <html lang="ru" className={`${lora.variable} ${onest.variable}`} suppressHydrationWarning>
      <head>
        {/* Тема и размер текста из браузера — до первой отрисовки, иначе
            тёмная тема мигала бы светлой, а текст прыгал бы по размеру при
            каждой загрузке (см. app/components/theme.ts). */}
        <script dangerouslySetInnerHTML={{ __html: DISPLAY_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
