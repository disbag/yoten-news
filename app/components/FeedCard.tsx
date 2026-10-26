"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { FeedItem } from "../../src/lib/feed";
import { categoryLabels } from "../../src/config/categories";
import { FAVICON_LIGHT_BACKING } from "../../src/config/faviconBacking";
import Gallery from "./Gallery";
import Lightbox from "./Lightbox";
import ThreadPosts from "./ThreadPosts";

export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

export function faviconUrl(homepage: string | null): string | null {
  if (!homepage) return null;
  try {
    const { hostname } = new URL(homepage);
    // Своя копия иконки, а не запрос к Google из браузера читателя (DIS-68):
    // файлы кладёт `npm run favicons` (src/jobs/fetchFavicons.ts).
    return `/favicons/${hostname}.png`;
  } catch {
    return null;
  }
}

// Сколько карточка должна пробыть на экране, чтобы считаться прочитанной.
const READ_AFTER_MS = 2500;

export default function FeedCard({
  item,
  trackReads,
  onRead,
  standalone = false,
}: {
  item: FeedItem;
  // false на странице поста: прочитанное там не отмечается и не показывается
  // (ни точки "новое", ни приглушённого текста).
  trackReads: boolean;
  // Карточка только что стала прочитанной — для счётчика вкладки "Новые".
  onRead?: () => void;
  // Страница одного поста (app/post/[id]): карточка сразу раскрыта.
  standalone?: boolean;
}) {
  const [expanded, setExpanded] = useState(standalone);
  // Подпись "Ссылка скопирована" рядом с кнопкой "Поделиться".
  const [copied, setCopied] = useState(false);
  const [isRead, setIsRead] = useState(item.isRead);
  // Некоторые издания (Telegraph — известный случай) отдают 402/битые байты
  // даже через прокси (см. коммент в app/api/image-proxy/route.ts). Тогда
  // пробуем загрузить картинку напрямую из браузера читателя: Telegraph
  // блокирует адреса серверов Vercel, но не браузеры (DIS-36, 17 октября: через
  // прокси не открылась ни одна из 15 обложек, напрямую — открываются). Если
  // не вышло и так — вместо сломанной иконки скрываем блок с картинкой целиком.
  const [imageDirect, setImageDirect] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  // Вертикальная или квадратная обложка (у The NY Times они все квадратные) в
  // рамке 16:9 при обрезке теряла почти половину кадра — такую вписываем
  // целиком на чёрном фоне, как кадры в карусели (см. Gallery.tsx).
  const [coverUpright, setCoverUpright] = useState(false);
  const coverRef = useRef<HTMLImageElement>(null);
  // Просмотр фото на весь экран: номер кадра, с которого открыли, или null.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const cardRef = useRef<HTMLElement>(null);

  function checkCoverUpright(img: HTMLImageElement) {
    if (img.naturalWidth > 0 && img.naturalWidth <= img.naturalHeight) setCoverUpright(true);
  }
  // Обложка приходит в серверном HTML и у верхних карточек успевает
  // загрузиться (или упасть) до гидрации — тогда onLoad/onError React уже не
  // увидит. Упавшая до гидрации: complete, но без размеров.
  useEffect(() => {
    const img = coverRef.current;
    if (!img?.complete) return;
    if (img.naturalWidth === 0) setImageDirect(true);
    else checkCoverUpright(img);
  }, []);
  // Иконки нового издания может не оказаться, пока не запущен
  // `npm run favicons` — тогда серый кружок, как у издания без сайта.
  const [faviconMissing, setFaviconMissing] = useState(false);
  const favicon = faviconMissing ? null : faviconUrl(item.primaryHomepage);
  const category = categoryLabels(item.category);
  // "Читать" раскрывает карточку на месте, без модалки, и только в одну
  // сторону — свернуть обратно нельзя намеренно: дописывает продолжение
  // (summaryMore, не повторяет summary). У тизеров (NYT/WSJ/Bloomberg — см.
  // MIN_DETAIL_CONTEXT_LENGTH в summarizer.ts) раскрывать нечего — "Читать" нет.
  const hasMoreText = Boolean(item.summaryMore);
  // Раньше остальные издания кластера были видны только в модалке — теперь
  // они в раскрытой карточке, а раскрыть её можно и бейджем "+N источника"
  // (у поста без ката иначе до них было бы не добраться).
  const otherSources = item.sources.filter((s) => s.link !== item.primaryLink);

  // Ссылка на страницу поста (DIS-20). На телефоне — системное окно
  // "Поделиться", на компьютере — сразу в буфер обмена: там его окно только
  // добавляет лишний шаг до того же "Скопировать".
  async function share() {
    const url = `${window.location.origin}/post/${item.clusterId}`;
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      // Отказ пользователя (закрыл окно) приходит как ошибка — это не сбой.
      // title — подпись вверху системного окна вместо голого адреса сайта.
      // text не передаём: мессенджеры вставляют его в сообщение рядом со
      // ссылкой, а текст поста там и так покажет превью.
      const lead = item.summary.length > 90 ? `${item.summary.slice(0, 90).trimEnd()}…` : item.summary;
      await navigator.share({ title: `${item.primarySource}: ${lead}`, url }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Буфер недоступен (старый браузер, страница не по https) — открываем
      // пост, ссылку можно взять из адресной строки.
      window.location.assign(url);
    }
  }

  function markRead() {
    setIsRead(true);
    onRead?.();
    // Fire-and-forget: ошибка сети не должна мешать ленте — в худшем случае
    // статья снова придёт непрочитанной при следующей загрузке.
    // У треда прочитанным становится весь тред — все его карточки.
    fetch("/api/reads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clusterIds: item.thread?.clusterIds ?? [item.clusterId] }),
    }).catch(() => {});
  }

  // Прочитанной карточка становится, когда пробыла на экране READ_AFTER_MS —
  // как в Twitter (DIS-25): пролистанная на ходу остаётся непрочитанной.
  // "На экране" — видна хотя бы наполовину; у карточки выше экрана (раскрытая,
  // с вертикальным фото) половина может не поместиться никогда, поэтому ей
  // достаточно занять половину экрана. Пока вкладка в фоне, время не идёт.
  useEffect(() => {
    if (isRead || !trackReads) return;
    const el = cardRef.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    function tick() {
      timer = null;
      if (document.visibilityState === "visible") markRead();
      else timer = setTimeout(tick, READ_AFTER_MS);
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        const screenHeight = entry.rootBounds?.height ?? window.innerHeight;
        const onScreen =
          entry.isIntersecting &&
          (entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= screenHeight * 0.5);
        if (onScreen) timer ??= setTimeout(tick, READ_AFTER_MS);
        else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- markRead не зависит от состояния, пересоздавать observer при каждом рендере не нужно
  }, [isRead]);

  // timeAgo зависит от Date.now() — на сервере и при гидратации на клиенте
  // это разные моменты времени, и если между ними "перевалило" через минуту
  // (с точностью до часа такое почти не случалось, с минутами — регулярно),
  // React ругается на несовпадение текста при гидратации. Считаем дату
  // только на клиенте, после монтирования: на сервере/при гидратации рендерим
  // пустую строку (гарантированно совпадает), а сразу после — настоящую дату.
  const [dateLabel, setDateLabel] = useState("");
  useEffect(() => {
    setDateLabel(timeAgo(item.publishedAt));
  }, [item.publishedAt]);

  return (
    <article className="card" ref={cardRef} data-cluster-id={item.clusterId}>
      <div className="content">
        <div className="header">
          {favicon ? (
            // eslint-disable-next-line @next/next/no-img-element -- маленькие статичные файлы из public/favicons
            <img
              src={favicon}
              alt=""
              className={FAVICON_LIGHT_BACKING.has(item.primarySource) ? "favicon favicon-backing" : "favicon"}
              onError={() => setFaviconMissing(true)}
            />
          ) : (
            <span className="favicon favicon-placeholder" />
          )}
          <div className="meta">
            <div className="source-row">
              <a
                href={item.primaryLink}
                target="_blank"
                rel="noopener noreferrer"
                className="source-name"
                onClick={(e) => e.stopPropagation()}
              >
                {item.primarySource}
              </a>
              {otherSources.length > 0 && (
                <button type="button" className="badge" onClick={() => setExpanded(true)}>
                  +{otherSources.length} источника
                </button>
              )}
              {/* Точка "новое" — последней в строке: когда карточка становится
                  прочитанной и точка пропадает, ничего не сдвигается. */}
              {trackReads && !isRead && <span className="unread-dot" />}
            </div>
            <span className="date">
              {category ? `${category} • ` : ""}
              {dateLabel}
            </span>
          </div>
          {copied && <span className="copied">Ссылка скопирована</span>}
          {/* Ни в классе, ни в подписи нет слов "share"/"Поделиться": по ним
              блокировщики рекламы в Safari скрывают кнопку как виджет соцсетей
              (так и было в первой версии). */}
          <button type="button" className="post-link" aria-label="Отправить ссылку на пост" onClick={share}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 15V3.5M7.5 8L12 3.5L16.5 8M5 12.5V19.5H19V12.5"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <p
          className={`summary${isRead ? " read" : ""}${hasMoreText && !expanded ? " expandable" : ""}`}
          onClick={hasMoreText && !expanded ? () => setExpanded(true) : undefined}
        >
          {item.summary}
          {hasMoreText && !expanded && (
            <>
              {" "}
              <span className="read-more">Читать</span>
            </>
          )}
        </p>
        {expanded && item.summaryMore && <p className={`summary${isRead ? " read" : ""}`}>{item.summaryMore}</p>}
        {expanded && otherSources.length > 0 && (
          <p className="sources">
            Также пишут:{" "}
            {otherSources.map((s, i) => (
              <Fragment key={s.link}>
                {i > 0 && ", "}
                <a href={s.link} target="_blank" rel="noopener noreferrer">
                  {s.name}
                </a>
              </Fragment>
            ))}
          </p>
        )}
      </div>
      {item.imageUrls && item.imageUrls.length > 1 ? (
        <Gallery urls={item.imageUrls} onTap={(index) => setLightboxIndex(index)} />
      ) : (
        item.imageUrl &&
        !imageBroken && (
          // Через /api/image-proxy, а не напрямую — некоторые издания (Rolling
          // Stone, Variety, Hollywood Reporter, все три на инфраструктуре
          // Penske Media) блокируют именно хотлинк картинки из чужого домена
          // (см. коммент в app/api/image-proxy/route.ts), хотя тот же URL
          // прекрасно отдаётся на серверный запрос при сборе новостей.
          // eslint-disable-next-line @next/next/no-img-element -- домены картинок непредсказуемы (любое издание)
          <img
            src={imageDirect ? item.imageUrl : `/api/image-proxy?url=${encodeURIComponent(item.imageUrl)}`}
            alt=""
            referrerPolicy="no-referrer"
            ref={coverRef}
            className={coverUpright ? "cover upright" : "cover"}
            loading="lazy"
            onLoad={(e) => checkCoverUpright(e.currentTarget)}
            onError={() => (imageDirect ? setImageBroken(true) : setImageDirect(true))}
            onClick={() => setLightboxIndex(0)}
          />
        )
      )}
      {item.thread && item.thread.posts.length > 0 && <ThreadPosts posts={item.thread.posts} />}
      {lightboxIndex !== null && (
        <Lightbox
          urls={item.imageUrls && item.imageUrls.length > 1 ? item.imageUrls : item.imageUrl ? [item.imageUrl] : []}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      <style jsx>{`
        .card {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .content {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .cover {
          display: block;
          width: 100%;
          /* 16:9, а не 1200×630 (1.91:1): по выборке из 450 обложек всех
             изданий 61% — ровно 16:9 и ещё 26% — 1.91:1; в рамке 16:9
             в среднем обрезается 5.8% площади кадра против 8.4% (DIS-35). */
          aspect-ratio: 16 / 9;
          object-fit: cover;
          border-radius: 14px;
          cursor: zoom-in;
        }
        .cover.upright {
          object-fit: contain;
          background: #000;
        }
        .header {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .favicon {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }
        .favicon-placeholder {
          background: var(--border);
        }
        .meta {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          flex: 1 0 0;
          min-width: 0;
        }
        .source-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .post-link {
          display: flex;
          flex-shrink: 0;
          /* Поле вокруг значка — чтобы попадать пальцем; отрицательный отступ
             оставляет сам значок на правом краю карточки. */
          padding: 8px;
          margin: -8px;
          border: none;
          background: none;
          color: var(--text-dim);
          cursor: pointer;
        }
        .post-link:hover {
          color: var(--accent);
        }
        .copied {
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 10px;
          line-height: 12px;
          color: var(--text-dim);
          white-space: nowrap;
        }
        .unread-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--accent);
          flex-shrink: 0;
        }
        .source-name {
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 12px;
          line-height: 14px;
          color: var(--text);
          text-decoration: none;
        }
        .source-name:hover {
          color: var(--accent);
        }
        .badge {
          font-family: inherit;
          font-size: 0.72rem;
          font-style: italic;
          color: var(--accent);
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
        }
        .sources {
          margin: 0;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: calc(13px * var(--font-scale));
          line-height: calc(18px * var(--font-scale));
          color: var(--text-dim);
        }
        .sources a {
          color: inherit;
        }
        .sources a:hover {
          color: var(--accent);
        }
        .date {
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 10px;
          line-height: 12px;
          color: var(--text-dim);
        }
        .summary {
          margin: 0;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 400;
          /* Масштаб — из настройки "Размер текста" (DIS-19, --font-scale в
             globals.css); на обычном размере — ровно 15/20 по макету. */
          font-size: calc(15px * var(--font-scale));
          line-height: calc(20px * var(--font-scale));
          color: var(--text);
          transition: color 0.4s;
        }
        .summary.expandable {
          cursor: pointer;
        }
        .summary.read {
          color: var(--text-read);
        }
        .read-more {
          color: var(--link);
          text-decoration: underline;
        }
        @media (max-width: 899px) {
          .summary {
            font-size: calc(1rem * var(--font-scale));
          }
        }
      `}</style>
    </article>
  );
}
