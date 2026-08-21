import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getProfile } from "@/lib/api/community-server";

import { TopicRow } from "../../topic-row";

export const metadata: Metadata = { robots: { index: false } };

/** A member's public forum profile. noindex — people pages are for people. */
export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getProfile(id);
  if (!profile) notFound();

  return (
    <section>
      <h2 className="mk-display text-[1.6rem]">
        {profile.name}
        {profile.is_staff && <span className="mk-eyebrow ml-3">Staff</span>}
      </h2>
      <p className="mb-6 text-[0.85rem] opacity-60">
        Joined {new Date(profile.joined_at).toLocaleDateString()} · {profile.topic_count} topics ·{" "}
        {profile.post_count} posts
      </p>
      <h3 className="mk-eyebrow mb-2">Recent topics</h3>
      {profile.recent_topics.length > 0 ? (
        <ul>
          {profile.recent_topics.map((t) => (
            <TopicRow key={t.id} topic={t} />
          ))}
        </ul>
      ) : (
        <p className="mk-card px-4 py-6 opacity-70">No topics yet.</p>
      )}
    </section>
  );
}
