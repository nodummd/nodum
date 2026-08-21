import Link from "next/link";

import type { CommunityTopicItem } from "@/lib/api/community-server";

/** One topic line — shared by the index, category and profile pages. */
export function TopicRow({ topic, showCategory = true }: { topic: CommunityTopicItem; showCategory?: boolean }) {
  const when = new Date(topic.last_post_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <li className="flex items-baseline gap-3 border-b border-white/5 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <Link
          href={`/community/t/${topic.id}/${topic.slug}`}
          className="text-[1rem] font-medium hover:underline"
        >
          {topic.is_pinned && <span className="mk-eyebrow mr-2">Pinned</span>}
          {topic.is_locked && <span className="mk-eyebrow mr-2">Locked</span>}
          {topic.title}
        </Link>
        <p className="mt-0.5 text-[0.8rem] opacity-60">
          {topic.author ? topic.author.name : "deleted user"}
          {showCategory && topic.category_slug ? (
            <>
              {" · "}
              <Link href={`/community/c/${topic.category_slug}`} className="hover:underline">
                {topic.category_slug}
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <span className="shrink-0 text-[0.8rem] tabular-nums opacity-60" title="Replies">
        {topic.reply_count} ↩
      </span>
      <span className="shrink-0 text-[0.8rem] tabular-nums opacity-60" title="Views">
        {topic.view_count} 👁
      </span>
      <span className="shrink-0 text-[0.8rem] tabular-nums opacity-60">{when}</span>
    </li>
  );
}

export function Pager({
  base,
  page,
  hasPrev,
  hasNext,
}: {
  base: string;
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  if (!hasPrev && !hasNext) return null;
  const sep = base.includes("?") ? "&" : "?";
  return (
    <nav className="mt-6 flex items-center justify-between" aria-label="Pages">
      {hasPrev ? (
        <a className="mk-navlink" href={`${base}${sep}page=${page - 1}`}>
          ← Newer
        </a>
      ) : (
        <span />
      )}
      {hasNext ? (
        <a className="mk-navlink" href={`${base}${sep}page=${page + 1}`}>
          Older →
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}
