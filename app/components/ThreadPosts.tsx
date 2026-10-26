"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ThreadPost } from "../../src/lib/feed";
import { faviconUrl, timeAgo } from "./FeedCard";
import { sourcePath } from "../../src/lib/sourceSlug";

// Продолжение треда под первой карточкой (DIS-36): каждая следующая карточка
// — издание, время и только то новое, что она добавила к треду. Ссылка на
// издание ведёт на саму статью.
export default function ThreadPosts({ posts }: { posts: ThreadPost[] }) {
  return (
    <ol className="thread">
      {posts.map((post) => (
        <Post key={post.clusterId} post={post} />
      ))}
      <style jsx>{`
        .thread {
          list-style: none;
          margin: 0;
          padding: 0 0 0 11px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          border-left: 2px solid var(--border);
        }
      `}</style>
    </ol>
  );
}

function Post({ post }: { post: ThreadPost }) {
  // Дата — только на клиенте, как в FeedCard.tsx: иначе расхождение
  // сервер/браузер на минуту ломает гидратацию.
  const [dateLabel, setDateLabel] = useState("");
  useEffect(() => setDateLabel(timeAgo(post.publishedAt)), [post.publishedAt]);
  const favicon = faviconUrl(post.homepage);
  return (
    <li className="post">
      <div className="head">
        <Link href={sourcePath(post.source)} className="favicon-link" aria-label={`Все посты ${post.source}`}>
          {favicon ? (
            // eslint-disable-next-line @next/next/no-img-element -- маленькие статичные файлы из public/favicons
            <img src={favicon} alt="" className="favicon" />
          ) : (
            <span className="favicon placeholder" />
          )}
        </Link>
        <a href={post.link} target="_blank" rel="noopener noreferrer" className="source">
          {post.source}
        </a>
        <span className="date">{dateLabel}</span>
      </div>
      <p className={post.text ? "text" : "text empty"}>{post.text ?? "Без новых подробностей"}</p>
      <style jsx>{`
        .post {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .head {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .head :global(.favicon-link) {
          display: flex;
          flex-shrink: 0;
        }
        .favicon {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }
        .placeholder {
          background: var(--border);
        }
        .source {
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 12px;
          line-height: 14px;
          color: var(--text);
          text-decoration: none;
        }
        .source:hover {
          color: var(--accent);
        }
        .date {
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 10px;
          line-height: 12px;
          color: var(--text-dim);
        }
        .text {
          margin: 0;
          font-family: var(--font-news), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: calc(14px * var(--font-scale));
          line-height: calc(19px * var(--font-scale));
          color: var(--text);
        }
        .text.empty {
          color: var(--text-dim);
          font-style: italic;
        }
      `}</style>
    </li>
  );
}
