import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import { LikeButton, ThreadEngagement } from "@/components/forum/engagement";
import { PostBody } from "@/components/forum/post-body";
import { ReportButton, StaffPostDelete, StaffTopicControls } from "@/components/forum/staff-tools";
import { PostControls, ReplyBox } from "@/components/forum/thread-actions";
import { getPosts, getTopic } from "@/lib/api/forum-server";

import { Pager } from "../../../topic-row";

const PAGE_SIZE = 50;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const topic = await getTopic(id);
  if (!topic) return {};
  return {
    title: `${topic.title} · Nodum Community`,
    description: `${topic.reply_count} replies in ${topic.category_slug ?? "the community"}.`,
    alternates: { canonical: `/forum/t/${topic.id}/${topic.slug}` },
  };
}

/** A thread. URLs are id-first; a wrong or missing slug 308s to canonical. */
export default async function TopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; slug?: string[] }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id, slug } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const topic = await getTopic(id);
  if (!topic) notFound();
  if ((slug?.[0] ?? "") !== topic.slug) {
    permanentRedirect(`/forum/t/${topic.id}/${topic.slug}${page > 1 ? `?page=${page}` : ""}`);
  }
  const posts = await getPosts(topic.id, (page - 1) * PAGE_SIZE, PAGE_SIZE);
  if (!posts) notFound();

  return (
    <article>
      <p className="mb-1">
        {topic.category_slug && (
          <Link href={`/forum/c/${topic.category_slug}`} className="mk-navlink px-0">
            ← {topic.category_slug}
          </Link>
        )}
      </p>
      <h2 className="mk-display text-[1.6rem]">
        {topic.is_pinned && <span className="mk-eyebrow mr-2">Pinned</span>}
        {topic.is_locked && <span className="mk-eyebrow mr-2">Locked</span>}
        {topic.title}
      </h2>
      <p className="mb-6 text-[0.85rem] opacity-60">
        {topic.author ? (
          <Link href={`/forum/u/${topic.author.id}`} className="hover:underline">
            {topic.author.name}
          </Link>
        ) : (
          "deleted user"
        )}
        {" · "}
        {new Date(topic.created_at).toLocaleDateString()} · {topic.reply_count} replies · {topic.view_count} views
      </p>
      <StaffTopicControls topicId={topic.id} pinned={topic.is_pinned} locked={topic.is_locked} />

      <ThreadEngagement topicId={topic.id} maxPostNumber={posts.items.length ? posts.items[posts.items.length - 1].post_number : 1}>
      <ol className="space-y-6">
        {posts.items.map((post) => (
          <li key={post.id} id={`post-${post.post_number}`} className="mk-card px-4 py-3">
            {post.is_deleted ? (
              <p className="text-[0.85rem] italic opacity-50">#{post.post_number} — removed</p>
            ) : (
              <>
                <p className="mb-2 text-[0.8rem] opacity-60">
                  {post.author ? (
                    <Link href={`/forum/u/${post.author.id}`} className="font-medium hover:underline">
                      {post.author.name}
                    </Link>
                  ) : (
                    "deleted user"
                  )}
                  {" · "}
                  <a href={`#post-${post.post_number}`} className="tabular-nums hover:underline">
                    #{post.post_number}
                  </a>
                  {" · "}
                  {post.created_at && new Date(post.created_at).toLocaleDateString()}
                  {post.edited_at && <em> · edited</em>}
                  {" · "}
                  <LikeButton postId={post.id} initialCount={post.like_count ?? 0} />
                  {" · "}
                  <ReportButton postId={post.id} authorId={post.author?.id ?? null} />
                  <StaffPostDelete postId={post.id} authorId={post.author?.id ?? null} />
                </p>
                <PostBody content={post.content ?? ""} />
                <PostControls
                  postId={post.id}
                  postNumber={post.post_number}
                  authorId={post.author?.id ?? null}
                  topicId={topic.id}
                  content={post.content ?? ""}
                  locked={topic.is_locked}
                />
              </>
            )}
          </li>
        ))}
      </ol>
      </ThreadEngagement>
      <Pager
        base={`/forum/t/${topic.id}/${topic.slug}`}
        page={page}
        hasPrev={page > 1}
        hasNext={posts.has_more}
      />
      {topic.is_locked && <p className="mt-6 opacity-60">This topic is locked — no new replies.</p>}
      {!posts.has_more && <ReplyBox topicId={topic.id} locked={topic.is_locked} />}
    </article>
  );
}
