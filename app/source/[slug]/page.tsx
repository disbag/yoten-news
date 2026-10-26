import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFeed } from "../../../src/lib/feed";
import { getViewerId } from "../../../src/lib/viewer";
import { sourceBySlug } from "../../../src/lib/sourceBySlug";
import { SOURCE_DESCRIPTIONS } from "../../../src/config/sourceDescriptions";
import { FEED_PAGE_SIZE } from "../../../src/lib/feedPosition";
import FeedList from "../../components/FeedList";
import SourceHeader from "../../components/SourceHeader";
import Sidebar from "../../components/Sidebar";
import MobileChrome from "../../components/MobileChrome";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const source = sourceBySlug((await props.params).slug);
  return {
    title: source ? `${source.name} — Yoten` : "Yoten",
    description: source ? SOURCE_DESCRIPTIONS[source.name] : undefined,
  };
}

// Страница издания (DIS-80): открывается по иконке издания в карточке.
// Все карточки, где есть его статья, по дате — без вкладок и тредов.
export default async function SourcePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const source = sourceBySlug(slug);
  if (!source) notFound();

  const loadedAt = new Date().toISOString();
  const rows = await getFeed({ source: source.name, limit: FEED_PAGE_SIZE + 1, userId: await getViewerId() });

  return (
    <div className="shell">
      <div className="mobile-only">
        <MobileChrome activeCategory="none" />
      </div>
      <div className="desktop-only">
        <Sidebar activeCategory="none" />
      </div>

      <main>
        <div className="source-top">
          <SourceHeader name={source.name} homepage={source.homepageUrl} description={SOURCE_DESCRIPTIONS[source.name]} />
        </div>
        <FeedList
          key={`${slug}:${loadedAt}`}
          initialItems={rows.slice(0, FEED_PAGE_SIZE)}
          initialHasOlder={rows.length > FEED_PAGE_SIZE}
          restored={false}
          loadedAt={loadedAt}
          tab="new"
          initialUnreadCount={0}
          source={slug}
        />
      </main>
    </div>
  );
}
