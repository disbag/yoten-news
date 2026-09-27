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
  trackReads,
  onNewlyRead,
}: {
  initialItems: FeedItem[];
  initialHasMore: boolean;
  category?: string;
  tab: "new" | "read";
  trackReads: boolean;
  // Дёргается на каждую статью, ставшую прочитанной прямо сейчас (не на
  // те, что уже пришли прочитанными с сервера) — см. счётчик в FeedShell.
  onNewlyRead?: () => void;
}) {
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pendingRemovals = useRef<Set<number>>(new Set());
  // Удаление откладывается до паузы в скролле (см. handleRead/scroll-листенер
  // ниже) — таймер сбрасывается на каждое новое чтение и на каждый scroll-
  // событие, так что реально срабатывает только через IDLE_MS после того, как
  // пользователь перестал прокручивать.
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Опорная карточка ПЕРЕД пакетным удалением — первая видимая из тех, что
  // остаются, и её положение на экране. См. компенсацию в useLayoutEffect
  // ниже. null значит "последнее изменение items было не удалением"
  // (например, догрузка по скроллу), тогда компенсировать нечего.
  const removalSnapshot = useRef<{ anchorId: string; viewTop: number } | null>(null);
  // Палец на экране. Пока он есть, удалять нельзя: iOS Safari игнорирует
  // программный window.scrollTo во время касания, компенсация не срабатывала,
  // и лента съезжала вверх на высоту удалённых карточек (см. flushRemovals).
  const touching = useRef(false);
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
      // Удаление, отложенное на время загрузки (см. flushRemovals).
      if (pendingRemovals.current.size > 0) scheduleFlush();
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
  // Настоящая причина скачков скролла — не в количестве рефлоу самих по
  // себе, а в том, что удаляемые карточки стоят ВЫШЕ текущей позиции
  // скролла: страница резко становится короче, и если её новая высота
  // оказывается меньше текущего scrollY, браузер вынужден обрезать
  // (clamp) scrollTop до нового максимума — это и есть видимый прыжок
  // назад. Полагаться на scroll anchoring браузера ненадёжно, когда за один
  // кадр могут разом уйти несколько карточек (проверено: без ручной
  // компенсации опорная карточка реально прыгает на экране на 300-700px),
  // поэтому компенсируем вручную: снимаем высоту документа и scrollY ДО
  // удаления, а в useLayoutEffect (синхронно после коммита DOM, до отрисовки
  // кадра) прибавляем разницу высот обратно к scrollY — так браузеру никогда
  // не приходится обрезать.
  //
  // Само удаление при этом откладывается до паузы в скролле (а не до
  // следующего кадра, как раньше) — measured: с компенсацией на каждый кадр
  // экранная позиция не сдвигается ни на пиксель, НО window.scrollTo прямо
  // во время активной прокрутки (инерция трекпада/колеса) обрывает эту
  // инерцию у браузера, что и ощущается как небольшое дёргание, даже когда
  // итоговая позиция идеально верна. Откладывая flush до IDLE_MS после
  // последнего скролл-события, компенсация никогда не попадает в момент
  // активного жеста — только в паузу между ними, где её в любом случае
  // никто не почувствует.
  //
  // Ещё два случая, когда удалять нельзя, — оба у точки догрузки ленты, где
  // пользователь обычно держит палец внизу, ожидая новых карточек:
  //  - палец на экране (touching): scroll-событий нет, таймер считал это
  //    паузой, а iOS Safari игнорирует window.scrollTo во время касания и
  //    не умеет scroll anchoring — лента съезжала вверх на высоту удалённого,
  //    видимые карточки улетали за верх экрана, отмечались прочитанными, и
  //    через 200мс всё повторялось ("всё улетает");
  //  - идёт догрузка (loadingRef): её карточки могли попасть в тот же
  //    рендер, что и удаление.
  // Компенсация — по положению опорной карточки, а не по изменению высоты
  // документа: высота меняется и от догруженных снизу карточек.
  function flushRemovals() {
    flushTimer.current = null;
    if (pendingRemovals.current.size === 0) return;
    if (touching.current || loadingRef.current) return scheduleFlush();
    const toRemove = pendingRemovals.current;
    pendingRemovals.current = new Set();
    removalSnapshot.current = null;
    for (const el of document.querySelectorAll<HTMLElement>("[data-cluster-id]")) {
      const id = el.dataset.clusterId!;
      if (toRemove.has(Number(id))) continue;
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= 0) continue;
      removalSnapshot.current = { anchorId: id, viewTop: rect.top };
      break;
    }
    setItems((prev) => prev.filter((item) => !toRemove.has(item.clusterId)));
  }

  const IDLE_MS = 200;

  function scheduleFlush() {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flushRemovals, IDLE_MS);
  }

  function handleRead(clusterId: number) {
    onNewlyRead?.();
    if (tab !== "new") return;
    pendingRemovals.current.add(clusterId);
    scheduleFlush();
  }

  // Подстраховка на случай, если между двумя срабатываниями handleRead
  // (например, в разреженной части ленты с крупными картинками) проходит
  // больше IDLE_MS, а пользователь всё ещё физически скроллит — без этого
  // таймер из handleRead успел бы сработать посреди жеста. Каждое
  // scroll-событие отодвигает flush дальше, так что он гарантированно
  // происходит только после реальной остановки.
  useEffect(() => {
    function onScroll() {
      if (pendingRemovals.current.size > 0) scheduleFlush();
    }
    function onTouchStart() {
      touching.current = true;
    }
    // После отпускания пальца ещё идёт инерция — её scroll-события сами
    // отодвинут flush дальше (см. onScroll).
    function onTouchEnd() {
      touching.current = false;
      if (pendingRemovals.current.size > 0) scheduleFlush();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flushRemovals читает актуальные pendingRemovals/items через замыкание/рефы, пересоздавать листенер не нужно
  }, []);

  // Удалённые карточки стояли выше опорной — без компенсации она уехала бы
  // вверх ровно на их высоту. Возвращаем её на прежнее место на экране.
  // Именно "на прежнее место", а не "на высоту удалённого": Chrome успевает
  // сам сдвинуть скролл (scroll anchoring), и вычитание высоты ещё раз
  // сдвинуло бы дважды; если браузер уже всё сделал, здесь выйдет ноль.
  useLayoutEffect(() => {
    const snapshot = removalSnapshot.current;
    if (!snapshot) return;
    removalSnapshot.current = null;
    const anchor = document.querySelector<HTMLElement>(`[data-cluster-id="${snapshot.anchorId}"]`);
    if (!anchor) return;
    const drift = anchor.getBoundingClientRect().top - snapshot.viewTop;
    if (Math.abs(drift) >= 1) window.scrollTo(0, Math.max(0, window.scrollY + drift));
  }, [items]);

  return (
    <>
      <div className="card-list">
        {items.map((item) => (
          <FeedCard key={item.clusterId} item={item} onRead={trackReads ? handleRead : undefined} />
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
