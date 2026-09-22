"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FeedItem } from "../../src/lib/feed";
import FeedCard from "./FeedCard";

const PAGE_SIZE = 30;

export default function FeedList({
  initialItems,
  initialHasMore,
  category,
  tab,
  onNewlyRead,
}: {
  initialItems: FeedItem[];
  initialHasMore: boolean;
  category?: string;
  tab: "new" | "read";
  // Дёргается на каждую статью, ставшую прочитанной прямо сейчас (не на
  // те, что уже пришли прочитанными с сервера) — см. счётчик в FeedShell.
  onNewlyRead?: () => void;
}) {
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pendingRemovals = useRef<Set<number>>(new Set());
  const removalScheduled = useRef(false);
  // Снимок высоты/скролла ПЕРЕД пакетным удалением карточек — см.
  // компенсацию в useLayoutEffect ниже. null значит "последнее изменение
  // items было не удалением" (например, догрузка по скроллу), тогда
  // компенсировать нечего.
  const removalSnapshot = useRef<{ height: number; scrollY: number } | null>(null);
  // Не React-state — сентинел-observer ниже создаётся один раз на
  // [hasMore] и замыкает loadMore той же итерации навсегда, поэтому
  // проверка на обычном useState(loading) внутри loadMore видела бы
  // устаревшее значение и не спасала от повторного запуска, пока
  // предыдущий fetch ещё не завершился (см. коммент у loadingRef).
  const loadingRef = useRef(false);

  async function loadMore() {
    // rootMargin у сентинела — 600px, так что он может оставаться
    // "видимым" ещё долго после первого срабатывания, пока подгруженные
    // карточки не отодвинут его дальше. Без этой проверки повторные
    // срабатывания IntersectionObserver, пока первый fetch ещё не
    // завершился, отправляли ВТОРОЙ запрос с тем же курсором
    // (beforeClusterId ещё не обновился) — сервер отдавал ту же
    // страницу дважды, и в items оказывались дублирующиеся clusterId
    // (see "two children with the same key" в консоли).
    if (items.length === 0 || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const last = items[items.length - 1];
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        beforePublishedAt: last.publishedAt ?? "",
        beforeClusterId: String(last.clusterId),
      });
      if (category) params.set("category", category);
      if (tab === "read") params.set("tab", "read");
      const res = await fetch(`/api/feed?${params}`);
      const data: { items: FeedItem[]; hasMore: boolean } = await res.json();
      setItems((prev) => {
        const known = new Set(prev.map((item) => item.clusterId));
        return [...prev, ...data.items.filter((item) => !known.has(item.clusterId))];
      });
      setHasMore(data.hasMore);
    } finally {
      loadingRef.current = false;
    }
  }

  // Подгрузка по скроллу вместо кнопки "Показать ещё" — сентинел-элемент
  // внизу списка, срабатывает чуть заранее (rootMargin), пока пользователь
  // ещё не долистал до самого низа, чтобы следующая страница успела
  // подгрузиться без видимой паузы.
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "600px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMore читает актуальные items/category/tab через замыкание на каждый ре-рендер; пересоздавать observer при каждом изменении items не нужно
  }, [hasMore]);

  // В режиме "только непрочитанные" карточка, которую только что открыли
  // (см. onRead в FeedCard), пропадает из ленты — иначе прочитанное
  // продолжает висеть в списке, специально отфильтрованном под
  // непрочитанное, до следующей перезагрузки страницы.
  //
  // Убираем не по одной штуке сразу, а пачкой на следующий кадр — при
  // быстром скролле IntersectionObserver у нескольких карточек подряд
  // срабатывает почти одновременно, и без батчинга это несколько отдельных
  // рефлоу подряд вместо одного.
  //
  // Настоящая причина скачков скролла — не в количестве рефлоу самих по
  // себе, а в том, что удаляемые карточки стоят ВЫШЕ текущей позиции
  // скролла: страница резко становится короче, и если её новая высота
  // оказывается меньше текущего scrollY, браузер вынужден обрезать
  // (clamp) scrollTop до нового максимума — это и есть видимый прыжок
  // назад. Проверено эмпирически: пошаговый скролл небольшими шагами
  // (как у реального трекпада) с логированием scrollY стабильно показывал
  // просадку ровно в момент удаления карточек (900 → 402 → 900 → 462 → 900).
  // Полагаться на scroll anchoring браузера ненадёжно, когда за один кадр
  // могут разом уйти несколько карточек, поэтому компенсируем вручную:
  // снимаем высоту документа и scrollY ДО удаления, а в useLayoutEffect
  // (синхронно после коммита DOM, до отрисовки кадра) прибавляем разницу
  // высот обратно к scrollY — так браузеру никогда не приходится обрезать.
  function handleRead(clusterId: number) {
    onNewlyRead?.();
    if (tab !== "new") return;
    pendingRemovals.current.add(clusterId);
    if (removalScheduled.current) return;
    removalScheduled.current = true;
    requestAnimationFrame(() => {
      const toRemove = pendingRemovals.current;
      pendingRemovals.current = new Set();
      removalScheduled.current = false;
      removalSnapshot.current = {
        height: document.documentElement.scrollHeight,
        scrollY: window.scrollY,
      };
      setItems((prev) => prev.filter((item) => !toRemove.has(item.clusterId)));
    });
  }

  useLayoutEffect(() => {
    const snapshot = removalSnapshot.current;
    if (!snapshot) return;
    removalSnapshot.current = null;
    const shrink = snapshot.height - document.documentElement.scrollHeight;
    if (shrink > 0) {
      window.scrollTo(0, Math.max(0, snapshot.scrollY - shrink));
    }
  }, [items]);

  return (
    <>
      <div className="card-list">
        {items.map((item) => (
          <FeedCard key={item.clusterId} item={item} onRead={handleRead} />
        ))}
      </div>

      {hasMore && <div ref={sentinelRef} className="sentinel" />}

      <style jsx>{`
        .sentinel {
          height: 1px;
        }
      `}</style>
    </>
  );
}
