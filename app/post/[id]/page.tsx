import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost } from "../../../src/lib/feed";
import { SITE_ORIGIN } from "../../../src/lib/site";
import FeedCard from "../../components/FeedCard";
import Sidebar from "../../components/Sidebar";
import MobileChrome from "../../components/MobileChrome";

export const dynamic = "force-dynamic";

// Страница одного поста (DIS-20) — то, что открывается по ссылке "Поделиться".
// Метаданные и сама страница запрашивают пост по отдельности — cache
// склеивает это в один запрос к базе.
const loadPost = cache(async (id: string) => {
  // Только цифры: Number("1e3") и Number("0x10") тоже числа, а у поста должен
  // быть один адрес.
  if (!/^\d{1,9}$/.test(id)) return null;
  return getPost(Number(id));
});

// Подпись в превью ссылки: мессенджеры обрезают её сами, но по-разному —
// режем по границе слова, чтобы обрыв не пришёлся на середину.
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40)).replace(/[\s,;:—–-]+$/, "")}…`;
}

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  const post = await loadPost(id);
  if (!post) return { title: "Пост не найден — Yoten", robots: { index: false } };

  const description = clip(post.summary, 300);
  // Фото главного издания, а не галереи другого: в превью подписано издание.
  const cover = post.primaryImageUrl ?? post.imageUrls?.[0] ?? post.imageUrl;
  // Обложка — через свой прокси и полным адресом: часть изданий не отдаёт
  // картинку чужому серверу напрямую (см. app/api/image-proxy/route.ts), а
  // относительный адрес мессенджеры не понимают.
  const images = cover ? [`${SITE_ORIGIN}/api/image-proxy?url=${encodeURIComponent(cover)}`] : undefined;
  return {
    title: `${post.primarySource}: ${clip(post.summary, 70)} — Yoten`,
    description,
    // Пересказы чужих статей живут неделю (см. RETENTION_DAYS в
    // fetchAndProcess.ts) — поисковикам такие страницы не отдаём.
    robots: { index: false },
    openGraph: {
      type: "article",
      siteName: "Yoten",
      // Заголовков у постов нет — в превью, как и в карточке, сверху издание,
      // под ним текст.
      title: post.primarySource,
      description,
      url: `${SITE_ORIGIN}/post/${id}`,
      locale: "ru_RU",
      publishedTime: post.publishedAt ?? undefined,
      images,
    },
    twitter: { card: images ? "summary_large_image" : "summary", title: post.primarySource, description, images },
  };
}

export default async function PostPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const post = await loadPost(id);
  if (!post) notFound();

  return (
    <div className="shell">
      <div className="mobile-only">
        {/* Рубрика "none" не совпадает ни с одной — в меню ничего не выделено
            (без рубрики выделилось бы "Все"). */}
        <MobileChrome activeCategory="none" />
      </div>
      <div className="desktop-only">
        <Sidebar activeCategory="none" />
      </div>

      <main>
        <div className="card-list">
          <Link href="/" className="post-back">
            {/* eslint-disable-next-line @next/next/no-img-element -- статичный локальный SVG из макета */}
            <img src="/back-desktop.svg" alt="" width={24} height={24} className="theme-invert" />
            Вся лента
          </Link>
          {/* Пост открыт целиком, без ката. Прочитанное здесь не отмечается:
              пост по ссылке одинаковый для всех. */}
          <FeedCard item={post} trackReads={false} standalone />
        </div>
      </main>
    </div>
  );
}
