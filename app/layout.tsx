import type { Metadata } from "next";
import { Lora, Onest } from "next/font/google";
import "./globals.css";
import { DISPLAY_INIT_SCRIPT } from "./components/theme";

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
// см. Sidebar.tsx, MobileChrome.tsx, FeedTabs.tsx).
const onest = Onest({
  subsets: ["latin", "cyrillic"],
  weight: ["300", "400", "500"],
  variable: "--font-news",
});

export const metadata: Metadata = {
  title: "Yoten — новостная лента",
  description: "Свежие новости без повторов, в двух предложениях",
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
