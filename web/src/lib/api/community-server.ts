/**
 * Server-side reads of the public community endpoints.
 *
 * Same construction as public-server.ts (see its rationale): straight to the
 * API origin, envelope unwrapped, null on any failure so pages render their
 * own empty states. One difference — `revalidate: 30` instead of `no-store`:
 * forum pages are read far more often than they change, nothing here is a
 * privacy action, and thirty seconds of staleness is what every Discourse
 * front page already lives with.
 *
 * Server-only by construction — no "use client" file may import it, and the
 * endpoints need no credentials, so nothing here can leak a session.
 */

const API_ORIGIN = (process.env.API_PROXY_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export interface CommunityAuthor {
  id: string;
  name: string;
  avatar_url: string | null;
}

export interface CommunityCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  is_staff_only_posting: boolean;
  topic_count: number;
  post_count: number;
}

export interface CommunityTopicItem {
  id: string;
  category_id: string;
  category_slug?: string;
  title: string;
  slug: string;
  author: CommunityAuthor | null;
  is_pinned: boolean;
  is_locked: boolean;
  reply_count: number;
  last_post_number: number;
  view_count: number;
  created_at: string;
  last_post_at: string;
}

export interface CommunityTopicList {
  items: CommunityTopicItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface CommunityPostItem {
  id: string;
  post_number: number;
  is_deleted: boolean;
  author?: CommunityAuthor | null;
  content?: string;
  like_count?: number;
  edited_at?: string | null;
  created_at?: string;
}

export interface CommunityPostPage {
  items: CommunityPostItem[];
  has_more: boolean;
  limit: number;
  after: number;
}

export interface CommunityProfile {
  id: string;
  name: string;
  avatar_url: string | null;
  is_staff: boolean;
  joined_at: string;
  topic_count: number;
  post_count: number;
  recent_topics: CommunityTopicItem[];
}

async function getCommunity<T>(path: string, fresh = false): Promise<T | null> {
  try {
    const res = await fetch(`${API_ORIGIN}/api/v1/community${path}`, {
      headers: { Accept: "application/json" },
      // Lists tolerate 30s of staleness; a thread you just replied to must
      // show the reply on the very next render.
      ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: 30 } }),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "data" in body) {
      return (body as { data: T }).data;
    }
    return null;
  } catch {
    return null;
  }
}

export const getCategories = () => getCommunity<CommunityCategory[]>("/categories");

export const getTopics = (params: { category?: string; top?: string; limit?: number; offset?: number }) => {
  const q = new URLSearchParams();
  if (params.category) q.set("category", params.category);
  if (params.top) q.set("top", params.top);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  return getCommunity<CommunityTopicList>(`/topics?${q}`);
};

export const getTopic = (id: string) => getCommunity<CommunityTopicItem>(`/topics/${id}`, true);

export const getPosts = (topicId: string, after = 0, limit = 50) =>
  getCommunity<CommunityPostPage>(`/topics/${topicId}/posts?after=${after}&limit=${limit}`, true);

export const getProfile = (userId: string) => getCommunity<CommunityProfile>(`/users/${userId}`);
