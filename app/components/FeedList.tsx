"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FeedItem } from "../../src/lib/feed";
import { FEED_PAGE_SIZE, positionCookieName } from "../../src/lib/feedPosition";
import FeedCard from "./FeedCard";
import FeedTabs from "./FeedTabs";

// Подгружаем следующие карточки, когда до края загруженного остаётся столько.
const EDGE_CARDS = 3;
// Как часто спрашиваем сервер, не появилось ли новое.
const POLL_MS = 60_000;
// Пауза в прокрутке, после которой она считается законченной.
const IDLE_MS = 150;
const POSITION_MAX_AGE = 60 * 60 * 24 * 30;
// Высота липких вкладок (см. FeedTabs.tsx): карточка под ними не видна.
const TABS_HEIGHT = 40;

type Page = { items: FeedItem[]; hasMore: boolean; now: string; unreadCount?: number };
type Cursor = { publishedAt: string | null; clusterId: number };

function newLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} Новая`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} Новые`;
  return `${count} Новых`;
}

// Лента устроена как в Twitter (DIS-25): непрерывная, прочитанная карточка
// только сереет (см. FeedCard.tsx) и остаётся на месте. Раньше прочитанные
// карточки удалялись из ленты прямо во время прокрутки, и вместе с догрузкой
// страницы по 30 это и давало скачки. Из вкладки "Новые" прочитанное уходит
// только тогда, когда лента и так собирается заново: при нажатии на плашку
// "N Новых", при перезагрузке страницы и при возврате с вкладки
// "Прочитанные" — сервер отдаёт уже только непрочитанное (unreadOnly в
// src/lib/feed.ts). Пока лента открыта, над видимым местом ничего не удаляется:
//  - вниз карточки дописываются в конец — на положение экрана это не влияет;
//  - лента запоминает место и в следующий раз открывается с той же карточки
//    (initialItems начинаются с неё, restored=true) — тогда она растёт и
//    вверх, к новым;
//  - о новых статьях сообщает плашка "N Новых", сама лента при этом не
//    перестраивается, пока на плашку не нажмут.
export default function FeedList({
  initialItems,
  initialHasOlder,
  restored,
  loadedAt,
  category,
  tab,
  trackReads,
  initialUnreadCount,
}: {
  initialItems: FeedItem[];
  initialHasOlder: boolean;
  // Лента открыта с запомненного места, а не с самого верха.
  restored: boolean;
  // Время сервера, на которое собрана эта лента.
  loadedAt: string;
  category?: string;
  // "Прочитанные" — простой список: без запоминания места и без плашки.
  tab: "new" | "read";
  // false у гостя: прочитанное хранить негде (см. /api/reads), вкладок нет.
  trackReads: boolean;
  initialUnreadCount: number;
}) {
  const live = tab === "new";
  const [items, setItems] = useState(initialItems);
  const [hasOlder, setHasOlder] = useState(initialHasOlder);
  const [hasNewer, setHasNewer] = useState(restored && live);
  const [newCount, setNewCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const listRef = useRef<HTMLDivElement>(null);

  const topInset = trackReads ? TABS_HEIGHT : 0;
  const scope = category ?? "all";
  const positionKey = `yoten:pos:${scope}`;
  const seenKey = `yoten:seen:${scope}`;

  // Курсоры подгрузки — отдельно от items: карточка, поднявшаяся в ленте из-за
  // новой статьи в кластере, приходит повторно и отбрасывается как уже
  // известная, и по краю items курсор тогда не сдвинулся бы никогда.
  const olderCursor = useRef<Cursor | null>(initialItems[initialItems.length - 1] ?? null);
  const newerCursor = useRef<Cursor | null>(initialItems[0] ?? null);
  const loadingOlder = useRef(false);
  const loadingNewer = useRef(false);
  // Подгруженные сверху карточки, которые ждут вставки (см. flushNewer).
  const pendingNewer = useRef<Page | null>(null);
  // Номер "поколения" ленты: растёт, когда её заменяют целиком (нажатие на
  // плашку), — ответ на запрос, отправленный до замены, уже не к месту.
  const generation = useRef(0);
  // Всё, что попало в базу до этого момента, пользователь уже видел в ленте
  // или может долистать сам, — от него считается "N Новых".
  const seenAt = useRef(loadedAt);
  // На какой момент в ленте загружен её настоящий верх (null — верх ещё не
  // загружен). "Увиденным" он становится, только когда пользователь до него
  // долистал (см. savePosition): карточки, вставленные выше экрана, сами по
  // себе не повод убирать плашку.
  const topLoadedAt = useRef<string | null>(restored ? null : loadedAt);
  const hasNewerRef = useRef(hasNewer);
  hasNewerRef.current = hasNewer;

  const touching = useRef(false);
  const lastScrollAt = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Опорная карточка перед вставкой сверху и её положение на экране — см.
  // компенсацию в useLayoutEffect ниже.
  const anchorSnapshot = useRef<{ id: string; viewTop: number } | null>(null);
  const scrollToTopNext = useRef(false);
  // Идёт переход наверх по плашке (см. showNew): на это время подгрузка и
  // запоминание места выключены — лента всё равно сейчас заменится.
  const replacing = useRef(false);

  function cards(): HTMLElement[] {
    return Array.from(listRef.current?.querySelectorAll<HTMLElement>(":scope > [data-cluster-id]") ?? []);
  }

  function feedUrl(params: Record<string, string>): string {
    const query = new URLSearchParams(params);
    if (category) query.set("category", category);
    if (tab === "read") query.set("tab", "read");
    return `/api/feed?${query}`;
  }

  function markSeen(time: string) {
    seenAt.current = time;
    setNewCount(0);
    try {
      localStorage.setItem(seenKey, time);
    } catch {}
  }

  function append(prev: FeedItem[], added: FeedItem[], toTop: boolean): FeedItem[] {
    const known = new Set(prev.map((item) => item.clusterId));
    const fresh = added.filter((item) => !known.has(item.clusterId));
    return toTop ? [...fresh, ...prev] : [...prev, ...fresh];
  }

  async function loadOlder() {
    const cursor = olderCursor.current;
    if (!cursor || loadingOlder.current || replacing.current) return;
    loadingOlder.current = true;
    const startedIn = generation.current;
    try {
      const res = await fetch(
        feedUrl({
          limit: String(FEED_PAGE_SIZE),
          beforePublishedAt: cursor.publishedAt ?? "",
          beforeClusterId: String(cursor.clusterId),
        })
      );
      const page: Page = await res.json();
      if (startedIn !== generation.current) return;
      if (page.items.length) olderCursor.current = page.items[page.items.length - 1];
      setItems((prev) => append(prev, page.items, false));
      setHasOlder(page.hasMore);
    } catch {
      // Сеть моргнула — следующая попытка будет при следующем движении ленты.
    } finally {
      loadingOlder.current = false;
    }
  }

  async function loadNewer() {
    const cursor = newerCursor.current;
    if (!cursor || !hasNewerRef.current || loadingNewer.current || pendingNewer.current || replacing.current) return;
    loadingNewer.current = true;
    const startedIn = generation.current;
    try {
      const res = await fetch(
        feedUrl({
          limit: String(FEED_PAGE_SIZE),
          afterPublishedAt: cursor.publishedAt ?? "",
          afterClusterId: String(cursor.clusterId),
        })
      );
      const page: Page = await res.json();
      if (startedIn !== generation.current) return;
      if (page.items.length) newerCursor.current = page.items[0];
      pendingNewer.current = page;
      flushNewer();
    } catch {
    } finally {
      loadingNewer.current = false;
    }
  }

  // Вставка карточек СВЕРХУ сдвигает всё, что ниже, — чтобы лента не прыгала,
  // после вставки возвращаем опорную карточку на прежнее место на экране (см.
  // useLayoutEffect ниже). Там, где браузер сам удерживает прокрутку при
  // вставке выше экрана (scroll anchoring — Chrome, Firefox), вставляем сразу.
  // В Safari этого нет, а прокрутка из кода во время касания игнорируется и
  // обрывает инерцию — там ждём, пока палец отпущен и лента остановилась. В
  // самом верху страницы браузер прокрутку не удерживает нигде.
  function flushNewer() {
    const page = pendingNewer.current;
    if (!page || replacing.current) return;
    const browserAnchors = typeof CSS !== "undefined" && CSS.supports("overflow-anchor", "auto") && window.scrollY > 0;
    const idle = !touching.current && Date.now() - lastScrollAt.current >= IDLE_MS;
    if (!browserAnchors && !idle) return scheduleIdle();
    pendingNewer.current = null;
    const anchor = cards().find((el) => el.getBoundingClientRect().bottom > topInset);
    anchorSnapshot.current = anchor
      ? { id: anchor.dataset.clusterId!, viewTop: anchor.getBoundingClientRect().top }
      : null;
    setItems((prev) => append(prev, page.items, true));
    setHasNewer(page.hasMore);
    if (!page.hasMore) topLoadedAt.current = page.now;
  }

  // Нажатие на плашку: показываем верх ленты заново. Лента заменяется целиком,
  // а не достраивается вверх: между запомненным местом и верхом могут быть
  // сотни карточек, и тянуть их все ради перехода наверх незачем — вниз от
  // новых лента всё равно подгружается непрерывно.
  // Плавная прокрутка к началу страницы; завершается, когда страница доехала
  // (или через 2,5 с — на случай, если прокрутку перебили жестом).
  function scrollToTopSmoothly(): Promise<void> {
    if (window.scrollY < 2) return Promise.resolve();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (window.scrollY >= 2 && Date.now() - startedAt < 2500) return;
        clearInterval(timer);
        resolve();
      }, 50);
    });
  }

  // Нажатие на плашку: плавно едем наверх и показываем верх ленты заново.
  // Лента заменяется целиком, а не достраивается вверх: между запомненным
  // местом и верхом могут быть сотни карточек, и тянуть их все ради перехода
  // наверх незачем — вниз от новых лента всё равно подгружается непрерывно.
  // Заменяем уже после прокрутки: новая лента короче, и замена на ходу
  // оборвала бы движение.
  async function showNew() {
    if (replacing.current) return;
    replacing.current = true;
    generation.current += 1;
    pendingNewer.current = null;
    anchorSnapshot.current = null;
    try {
      const request = fetch(feedUrl({ limit: String(FEED_PAGE_SIZE) })).then((res) => res.json() as Promise<Page>);
      request.catch(() => {});
      await scrollToTopSmoothly();
      const page = await request;
      olderCursor.current = page.items[page.items.length - 1] ?? null;
      newerCursor.current = page.items[0] ?? null;
      scrollToTopNext.current = true;
      setItems(page.items);
      setHasOlder(page.hasMore);
      setHasNewer(false);
      topLoadedAt.current = page.now;
      markSeen(page.now);
      if (page.unreadCount !== undefined) setUnreadCount(page.unreadCount);
    } catch {
    } finally {
      replacing.current = false;
    }
  }

  async function checkNew() {
    if (!live || document.visibilityState !== "visible") return;
    try {
      const res = await fetch(feedUrl({ newSince: seenAt.current }));
      const data: { count: number } = await res.json();
      setNewCount(data.count ?? 0);
    } catch {}
  }

  // Запоминаем верхнюю видимую карточку и то, насколько она ушла за верх
  // экрана. В самом верху ленты запоминать нечего: при следующем открытии
  // там должны быть свежие новости, а не вчерашняя первая карточка.
  function savePosition() {
    if (!live || replacing.current) return;
    const atTop = !hasNewerRef.current && window.scrollY < 50;
    if (atTop && topLoadedAt.current && topLoadedAt.current > seenAt.current) markSeen(topLoadedAt.current);
    const top = atTop ? undefined : cards().find((el) => el.getBoundingClientRect().bottom > topInset);
    const cookie = `${positionCookieName(category)}=`;
    try {
      if (!top) {
        localStorage.removeItem(positionKey);
        document.cookie = `${cookie}; path=/; max-age=0; samesite=lax`;
        return;
      }
      const clusterId = Number(top.dataset.clusterId);
      localStorage.setItem(
        positionKey,
        JSON.stringify({ clusterId, offset: Math.round(top.getBoundingClientRect().top) })
      );
      document.cookie = `${cookie}${clusterId}; path=/; max-age=${POSITION_MAX_AGE}; samesite=lax`;
    } catch {}
  }

  function onIdle() {
    idleTimer.current = null;
    flushNewer();
    savePosition();
  }

  function scheduleIdle() {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(onIdle, IDLE_MS);
  }

  // Первая отрисовка: встаём на запомненное место. Сервер уже отдал ленту с
  // нужной карточки, остаётся сдвинуть её на прежнее расстояние от верха
  // экрана. Свою память прокрутки у браузера отключаем — она восстанавливала
  // бы число пикселей, а лента за это время изменилась.
  useLayoutEffect(() => {
    history.scrollRestoration = "manual";
    // Первая карточка — запомненная или, если та уже прочитана и скрыта,
    // следующая непрочитанная за ней. Запомненную ставим ровно как стояла,
    // следующую — в начало экрана.
    const first = restored ? cards()[0] : undefined;
    let saved: { clusterId?: number; offset?: number } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(positionKey) ?? "null");
    } catch {}
    if (first && saved?.clusterId === Number(first.dataset.clusterId)) {
      const offset = Number(saved.offset) || 0;
      window.scrollTo(0, Math.max(0, first.getBoundingClientRect().top + window.scrollY - offset));
    } else {
      window.scrollTo(0, 0);
    }
    return () => {
      history.scrollRestoration = "auto";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при монтировании
  }, []);

  useEffect(() => {
    if (restored) {
      // Открыли не с верха: новым считается всё, что появилось после того, как
      // пользователь в последний раз видел верх ленты.
      try {
        seenAt.current = localStorage.getItem(seenKey) ?? loadedAt;
      } catch {}
      checkNew();
    } else if (live) {
      markSeen(loadedAt);
    }

    function onScroll() {
      lastScrollAt.current = Date.now();
      scheduleIdle();
    }
    function onTouchStart() {
      touching.current = true;
    }
    // После отпускания пальца ещё идёт инерция — её scroll-события сами
    // отодвинут вставку дальше (см. onScroll).
    function onTouchEnd() {
      touching.current = false;
      scheduleIdle();
    }
    function onVisibility() {
      if (document.visibilityState === "visible") checkNew();
      else savePosition();
    }
    const poll = setInterval(checkNew, POLL_MS);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("pagehide", savePosition);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(poll);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("pagehide", savePosition);
      document.removeEventListener("visibilitychange", onVisibility);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- обработчики читают актуальное состояние через рефы, пересоздавать их не нужно
  }, []);

  // Подгрузка заранее: следим за карточкой в EDGE_CARDS от края загруженного
  // и, как только она показалась на экране, тянем следующие FEED_PAGE_SIZE.
  // Наблюдатель пересоздаётся после каждой подгрузки и сразу сообщает, видна
  // ли новая "пограничная" карточка, — так лента догружается дальше сама, если
  // пользователь уже у самого края.
  //
  // Следим за всеми EDGE_CARDS крайними карточками, а не за одной третьей от
  // края: на невысоком экране у самого верха ленты видны только первые две,
  // и третья не показалась бы никогда.
  useEffect(() => {
    const list = cards();
    const bottomEdge = new Set(hasOlder ? list.slice(-EDGE_CARDS) : []);
    const topEdge = new Set(hasNewer ? list.slice(0, EDGE_CARDS) : []);
    if (!bottomEdge.size && !topEdge.size) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (bottomEdge.has(entry.target as HTMLElement)) loadOlder();
        if (topEdge.has(entry.target as HTMLElement)) loadNewer();
      }
    });
    for (const el of new Set([...bottomEdge, ...topEdge])) observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadOlder/loadNewer работают через рефы
  }, [items, hasOlder, hasNewer]);

  // Карточки, вставленные сверху, сдвинули опорную вниз на свою высоту —
  // возвращаем её на прежнее место на экране. Именно "на прежнее место", а не
  // "на высоту вставленного": там, где браузер уже сам удержал прокрутку,
  // здесь выйдет ноль, и второй раз ничего не сдвинется.
  useLayoutEffect(() => {
    if (scrollToTopNext.current) {
      scrollToTopNext.current = false;
      window.scrollTo(0, 0);
      savePosition();
      return;
    }
    const snapshot = anchorSnapshot.current;
    if (!snapshot) return;
    anchorSnapshot.current = null;
    const anchor = listRef.current?.querySelector<HTMLElement>(`[data-cluster-id="${snapshot.id}"]`);
    if (!anchor) return;
    const drift = anchor.getBoundingClientRect().top - snapshot.viewTop;
    if (Math.abs(drift) >= 1) window.scrollTo(0, Math.max(0, window.scrollY + drift));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- savePosition читает состояние через рефы
  }, [items]);

  return (
    <>
      {trackReads && <FeedTabs tab={tab} category={category} unreadCount={unreadCount} />}

      {newCount > 0 && (
        <div className={trackReads ? "new-anchor below-tabs" : "new-anchor"}>
          <button type="button" className="new-toast" onClick={showNew}>
            {newLabel(newCount)}
          </button>
        </div>
      )}

      <div className="card-list" ref={listRef}>
        {items.map((item) => (
          <FeedCard
            key={item.clusterId}
            item={item}
            trackReads={trackReads}
            onRead={live ? () => setUnreadCount((count) => Math.max(0, count - 1)) : undefined}
          />
        ))}
      </div>

      <style jsx>{`
        /* Плашка висит над лентой по центру её колонки и не занимает места
           в потоке: sticky-обёртка нулевой высоты вместо position: fixed,
           который центрировался бы по окну, а не по колонке (на десктопе
           слева ещё сайдбар). */
        .new-anchor {
          position: sticky;
          top: 12px;
          height: 0;
          z-index: 20;
          display: flex;
          justify-content: center;
        }
        .new-anchor.below-tabs {
          top: 52px;
        }
        .new-toast {
          height: 32px;
          padding: 0 16px;
          border: none;
          border-radius: 16px;
          background: var(--accent);
          color: #fff;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 13px;
          line-height: 32px;
          white-space: nowrap;
          cursor: pointer;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
        }
      `}</style>
    </>
  );
}
