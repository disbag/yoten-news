import type { Metadata } from "next";
import { Lora, Onest } from "next/font/google";
import "./globals.css";

// Lora — тёплая книжная антиква с поддержкой кириллицы, в духе редакторских
// изданий вроде Kinfolk (в отличие от многих серифов на Google Fonts, не
// молчаливо откатывается на дефолтный шрифт на русском тексте).
const lora = Lora({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-serif",
});

// Onest — гротеск для текста самой новости (см. .summary в FeedCard.tsx),
// не для всего сайта: заголовок/дата/имя издания остаются на своих шрифтах.
const onest = Onest({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  variable: "--font-news",
});

export const metadata: Metadata = {
  title: "Yoten — новостная лента",
  description: "Свежие новости без повторов, в двух предложениях",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${lora.variable} ${onest.variable}`}>
      <body>{children}</body>
    </html>
  );
}
