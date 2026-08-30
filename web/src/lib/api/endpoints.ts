/** Typed API endpoint functions — the only place the app touches the network. */

import { api, ApiError, apiJson, apiStream } from "./client";
import type {
  AIChatReply,
  AIStreamEvent,
  AIConversationDetail,
  AIConversationMeta,
  AIStatus,
  AttachmentInfo,
  Backlink,
  CanvasData,
  CanvasFull,
  CanvasMeta,
  CommunityReportItem,
  FolderInfo,
  Graph,
  ApiKey,
  ApiKeyList,
  ApiKeyWithToken,
  McpToken,
  McpTokenList,
  Note,
  NoteMeta,
  OutgoingLink,
  NoteVersionDetail,
  NoteVersionMeta,
  QuickSwitchResult,
  SearchResult,
  TagCount,
  TokenPair,
  UnlinkedMention,
  User,
  Vault,
  VaultTree,
  VerificationRequired,
} from "./types";

// ── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  /** Returns a token pair, or — when the deployment verifies addresses — a
   *  `verification_required` marker and no tokens until the code comes back. */
  signup: (body: { email: string; password: string; name: string }) =>
    apiJson<TokenPair | VerificationRequired>("/auth/signup", "POST", body),
  login: (body: { email: string; password: string }) => apiJson<TokenPair>("/auth/login", "POST", body),
  verifyEmail: (body: { email: string; code: string }) =>
    apiJson<TokenPair>("/auth/verify-email", "POST", body),
  resendVerification: (body: { email: string }) =>
    apiJson<{ message: string }>("/auth/resend-verification", "POST", body),
  forgotPassword: (body: { email: string }) =>
    apiJson<{ message: string }>("/auth/forgot-password", "POST", body),
  resetPassword: (body: { email: string; code: string; new_password: string }) =>
    apiJson<TokenPair>("/auth/reset-password", "POST", body),
  requestAccountDeletion: () =>
    apiJson<{ message: string; expires_in_minutes: number }>("/auth/delete-account/request", "POST"),
  deleteAccount: (body: { code: string }) =>
    apiJson<{ message: string }>("/auth/delete-account", "POST", body),
  refresh: () => apiJson<TokenPair>("/auth/refresh", "POST"),
  logout: () => apiJson<{ message: string }>("/auth/logout", "POST"),
  me: () => api<User>("/auth/me"),
  providers: () => api<{ google: boolean }>("/auth/providers"),
  updateMe: (body: { name?: string; avatar_url?: string; settings?: Record<string, unknown> }) =>
    apiJson<User>("/auth/me", "PATCH", body),
  changePassword: (body: { current_password: string; new_password: string }) =>
    apiJson<{ message: string }>("/auth/change-password", "POST", body),
};

// ── Vaults ───────────────────────────────────────────────────────────────────

export const vaultApi = {
  list: () => api<Vault[]>("/vaults"),
  /** What the Demo Workspace is — public, for the onboarding card. */
  describeDemo: () => api<{ name: string; description: string; note_count: number }>("/vaults/demo"),
  /** Create the populated demo vault for this user. */
  createDemo: () =>
    apiJson<{ vault: Vault; open_note_id: string | null; imported: number }>("/vaults/demo", "POST"),
  create: (name: string) => apiJson<Vault>("/vaults", "POST", { name }),
  update: (vaultId: string, body: { name?: string; settings?: Record<string, unknown> }) =>
    apiJson<Vault>(`/vaults/${vaultId}`, "PATCH", body),
  remove: (vaultId: string) => apiJson<{ message: string }>(`/vaults/${vaultId}`, "DELETE"),
  tree: (vaultId: string) => api<VaultTree>(`/vaults/${vaultId}/tree`),
};

// ── Folders ──────────────────────────────────────────────────────────────────

export const folderApi = {
  create: (vaultId: string, body: { name: string; parent_id?: string | null }) =>
    apiJson<FolderInfo>(`/vaults/${vaultId}/folders`, "POST", body),
  rename: (vaultId: string, folderId: string, name: string) =>
    apiJson<FolderInfo>(`/vaults/${vaultId}/folders/${folderId}/rename`, "PATCH", { name }),
  move: (vaultId: string, folderId: string, newParentId: string | null) =>
    apiJson<FolderInfo>(`/vaults/${vaultId}/folders/${folderId}/move`, "PATCH", {
      new_parent_id: newParentId,
    }),
  remove: (vaultId: string, folderId: string) =>
    apiJson<{ message: string }>(`/vaults/${vaultId}/folders/${folderId}`, "DELETE"),
};

// ── Notes ────────────────────────────────────────────────────────────────────

export const noteApi = {
  create: (
    vaultId: string,
    body: { title: string; folder_id?: string | null; folder_path?: string; content?: string },
  ) => apiJson<Note>(`/vaults/${vaultId}/notes`, "POST", body),
  get: (vaultId: string, noteId: string) => api<Note>(`/vaults/${vaultId}/notes/${noteId}`),
  getByPath: (vaultId: string, path: string) =>
    api<Note>(`/vaults/${vaultId}/notes/by-path?path=${encodeURIComponent(path)}`),
  saveContent: (vaultId: string, noteId: string, content: string, baseUpdatedAt?: string) =>
    apiJson<Note>(`/vaults/${vaultId}/notes/${noteId}/content`, "PUT", {
      content,
      base_updated_at: baseUpdatedAt ?? null,
    }),
  rename: (
    vaultId: string,
    noteId: string,
    body: { title?: string; folder_id?: string | null; move_to_root?: boolean },
  ) => apiJson<NoteMeta>(`/vaults/${vaultId}/notes/${noteId}/rename`, "PATCH", body),
  setTags: (vaultId: string, noteId: string, body: { add?: string[]; remove?: string[] }) =>
    apiJson<Note>(`/vaults/${vaultId}/notes/${noteId}/tags`, "PATCH", body),
  remove: (vaultId: string, noteId: string) =>
    apiJson<{ message: string }>(`/vaults/${vaultId}/notes/${noteId}`, "DELETE"),
};

export const versionApi = {
  list: (vaultId: string, noteId: string) =>
    api<NoteVersionMeta[]>(`/vaults/${vaultId}/notes/${noteId}/versions`),
  get: (vaultId: string, noteId: string, versionId: string) =>
    api<NoteVersionDetail>(`/vaults/${vaultId}/notes/${noteId}/versions/${versionId}`),
  restore: (vaultId: string, noteId: string, versionId: string) =>
    apiJson<Note>(`/vaults/${vaultId}/notes/${noteId}/versions/${versionId}/restore`, "POST"),
};

// ── Links & graph ────────────────────────────────────────────────────────────

export const linkApi = {
  backlinks: (vaultId: string, noteId: string) =>
    api<{ note_id: string; backlinks: Backlink[] }>(`/vaults/${vaultId}/notes/${noteId}/backlinks`),
  outgoing: (vaultId: string, noteId: string) =>
    api<{ note_id: string; outgoing: OutgoingLink[] }>(`/vaults/${vaultId}/notes/${noteId}/outgoing`),
  unlinkedMentions: (vaultId: string, noteId: string) =>
    api<{ note_id: string; unlinked_mentions: UnlinkedMention[] }>(
      `/vaults/${vaultId}/notes/${noteId}/unlinked-mentions`,
    ),
  graph: (vaultId: string) => api<Graph>(`/vaults/${vaultId}/graph`),
  localGraph: (vaultId: string, noteId: string, depth: number) =>
    api<Graph>(`/vaults/${vaultId}/notes/${noteId}/local-graph?depth=${depth}`),
  related: (vaultId: string, noteId: string) =>
    api<{ related: { id: string; title: string; path: string; similarity: number }[] }>(
      `/vaults/${vaultId}/notes/${noteId}/related`,
    ),
};

// ── Search & tags ────────────────────────────────────────────────────────────

export const searchApi = {
  search: (vaultId: string, q: string, sort = "relevance", limit = 20, offset = 0) =>
    api<{ query: string; results: SearchResult[]; total: number }>(
      `/vaults/${vaultId}/search?q=${encodeURIComponent(q)}&sort=${sort}&limit=${limit}&offset=${offset}`,
    ),
  quickSwitch: (vaultId: string, q: string, limit = 10) =>
    api<QuickSwitchResult[]>(`/vaults/${vaultId}/quick-switch?q=${encodeURIComponent(q)}&limit=${limit}`),
  tags: (vaultId: string) => api<TagCount[]>(`/vaults/${vaultId}/tags`),
  notesByTag: (vaultId: string, tag: string) =>
    api<{ id: string; title: string; path: string }[]>(`/vaults/${vaultId}/tags/${tag}/notes`),
};

// ── Bookmarks ────────────────────────────────────────────────────────────────

export const clipperApi = {
  status: () => api<{ configured: boolean }>(`/clipper/token`),
  issue: () => apiJson<{ token: string }>(`/clipper/token`, "POST"),
  revoke: () => apiJson<void>(`/clipper/token`, "DELETE"),
};

export const bookmarkApi = {
  list: (vaultId: string) =>
    api<{ note_id: string; title: string; path: string }[]>(`/vaults/${vaultId}/bookmarks`),
  add: (vaultId: string, noteId: string) =>
    apiJson<{ bookmarked: boolean }>(`/vaults/${vaultId}/bookmarks/${noteId}`, "PUT"),
  remove: (vaultId: string, noteId: string) =>
    apiJson<{ bookmarked: boolean }>(`/vaults/${vaultId}/bookmarks/${noteId}`, "DELETE"),
};

// ── Daily notes & templates ──────────────────────────────────────────────────

/** The browser's wall clock as a naive local ISO string — "today" and
 *  {{time}} are the person's, not the server's (which runs in UTC). */
export function localNowIso(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export const dailyApi = {
  openDailyNote: (vaultId: string) =>
    apiJson<Note>(`/vaults/${vaultId}/daily-note`, "POST", { now: localNowIso() }),
  listTemplates: (vaultId: string) =>
    api<{ id: string; title: string; path: string }[]>(`/vaults/${vaultId}/templates`),
  insertTemplate: (vaultId: string, noteId: string, templateId: string) =>
    apiJson<Note>(`/vaults/${vaultId}/notes/${noteId}/insert-template/${templateId}`, "POST", {
      now: localNowIso(),
    }),
};

// ── Canvases ─────────────────────────────────────────────────────────────────

export const canvasApi = {
  list: (vaultId: string) => api<CanvasMeta[]>(`/vaults/${vaultId}/canvases`),
  create: (vaultId: string, name: string) =>
    apiJson<CanvasFull>(`/vaults/${vaultId}/canvases`, "POST", { name }),
  get: (vaultId: string, canvasId: string) =>
    api<CanvasFull>(`/vaults/${vaultId}/canvases/${canvasId}`),
  updateData: (vaultId: string, canvasId: string, data: CanvasData) =>
    apiJson<CanvasFull>(`/vaults/${vaultId}/canvases/${canvasId}/data`, "PUT", { data }),
  rename: (vaultId: string, canvasId: string, name: string) =>
    apiJson<CanvasFull>(`/vaults/${vaultId}/canvases/${canvasId}/rename`, "PATCH", { name }),
  remove: (vaultId: string, canvasId: string) =>
    apiJson<{ message: string }>(`/vaults/${vaultId}/canvases/${canvasId}`, "DELETE"),
};

// ── Publish ──────────────────────────────────────────────────────────────────

export interface PublicSite {
  slug: string;
  vault_name: string;
  notes: { title: string; path: string }[];
}

export const siteApi = {
  publish: (vaultId: string) =>
    apiJson<{ slug: string; enabled: boolean }>(`/vaults/${vaultId}/publish-site`, "POST"),
  status: (vaultId: string) =>
    api<{ enabled: boolean; slug: string | null }>(`/vaults/${vaultId}/publish-site`),
  unpublish: (vaultId: string) =>
    apiJson<{ message: string }>(`/vaults/${vaultId}/publish-site`, "DELETE"),
  readSite: (slug: string) => api<PublicSite>(`/public/sites/${slug}`),
  readNote: (slug: string, path: string) =>
    api<{ title: string; path: string; content: string; updated_at: string }>(
      `/public/sites/${slug}/note?path=${encodeURIComponent(path)}`,
    ),
};

export const publishApi = {
  publish: (vaultId: string, noteId: string) =>
    apiJson<{ token: string; published: boolean }>(`/vaults/${vaultId}/notes/${noteId}/publish`, "POST"),
  status: (vaultId: string, noteId: string) =>
    api<{ published: boolean; token: string | null }>(`/vaults/${vaultId}/notes/${noteId}/publish`),
  unpublish: (vaultId: string, noteId: string) =>
    apiJson<{ published: boolean }>(`/vaults/${vaultId}/notes/${noteId}/publish`, "DELETE"),
  readPublic: (token: string) =>
    api<{ title: string; content: string; updated_at: string; published_at: string }>(
      `/public/${token}`,
    ),
};

// ── Attachments ──────────────────────────────────────────────────────────────

export const attachmentApi = {
  upload: async (vaultId: string, file: File): Promise<AttachmentInfo> => {
    const form = new FormData();
    form.append("file", file);
    return api<AttachmentInfo>(`/vaults/${vaultId}/attachments`, { method: "POST", body: form });
  },
  list: (vaultId: string) => api<AttachmentInfo[]>(`/vaults/${vaultId}/attachments`),
  resolve: (vaultId: string, filename: string) =>
    api<{ url: string; expires_in: number }>(
      `/vaults/${vaultId}/attachments/resolve?filename=${encodeURIComponent(filename)}`,
    ),
  downloadUrl: (vaultId: string, attachmentId: string) =>
    api<{ url: string; expires_in: number }>(`/vaults/${vaultId}/attachments/${attachmentId}/url`),
  remove: (vaultId: string, attachmentId: string) =>
    apiJson<{ message: string }>(`/vaults/${vaultId}/attachments/${attachmentId}`, "DELETE"),
};

// ── AI (bring your own key) ──────────────────────────────────────────────────

export const aiApi = {
  /** With a vault id: that vault's own keys too, and which scope chat there uses. */
  status: (vaultId?: string) =>
    api<AIStatus>(vaultId ? `/ai/status?vault_id=${vaultId}` : "/ai/status"),
  saveCredential: (body: {
    provider: string;
    api_key?: string;
    model?: string;
    base_url?: string;
    /** Set = a key for this vault only (it wins there); omitted = the account's. */
    vault_id?: string;
  }) =>
    apiJson<{ provider: string; model: string; key_hint: string; scope: "vault" | "account" }>(
      "/ai/credentials",
      "PUT",
      body,
    ),
  removeCredential: (provider: string, vaultId?: string) =>
    apiJson<{ message: string }>(
      `/ai/credentials/${provider}${vaultId ? `?vault_id=${vaultId}` : ""}`,
      "DELETE",
    ),
  test: (provider: string, vaultId?: string) =>
    apiJson<{ provider: string; model: string; reply: string }>(
      `/ai/test/${provider}${vaultId ? `?vault_id=${vaultId}` : ""}`,
      "POST",
    ),
  chat: (body: { messages: { role: string; content: string }[]; context?: string }) =>
    apiJson<AIChatReply>("/ai/chat", "POST", body),
  /** Chat that can search, read, create and extend notes in this vault.
   *  Only the new message is sent — the server holds the transcript. */
  vaultChat: (
    vaultId: string,
    body: { message: string; conversation_id?: string; context?: string },
  ) => apiJson<AIChatReply>(`/ai/vaults/${vaultId}/chat`, "POST", body),
  /** The same turn, streamed: `onEvent` sees status / delta / action / reset
   *  events as they happen; the promise resolves with the stored reply (the
   *  `done` event) or rejects with the `error` event's message. */
  vaultChatStream: (
    vaultId: string,
    body: { message: string; conversation_id?: string; context?: string },
    onEvent: (event: AIStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<AIChatReply> =>
    new Promise<AIChatReply>((resolve, reject) => {
      let settled = false;
      apiStream(
        `/ai/vaults/${vaultId}/chat/stream`,
        body,
        (raw) => {
          const event = raw as unknown as AIStreamEvent;
          if (event.type === "done") {
            settled = true;
            const { type: _type, ...reply } = event;
            void _type;
            resolve(reply as AIChatReply);
          } else if (event.type === "error") {
            settled = true;
            reject(new ApiError(200, "ai_stream", event.message));
          } else {
            onEvent(event);
          }
        },
        signal,
      ).then(
        () => {
          if (!settled) reject(new ApiError(200, "ai_stream", "The provider closed the stream early."));
        },
        (err) => {
          if (!settled) reject(err);
        },
      );
    }),
  conversations: (vaultId: string) =>
    api<AIConversationMeta[]>(`/ai/vaults/${vaultId}/conversations`),
  conversation: (vaultId: string, id: string) =>
    api<AIConversationDetail>(`/ai/vaults/${vaultId}/conversations/${id}`),
  renameConversation: (vaultId: string, id: string, title: string) =>
    apiJson<{ id: string; title: string }>(
      `/ai/vaults/${vaultId}/conversations/${id}`,
      "PATCH",
      { title },
    ),
  deleteConversation: (vaultId: string, id: string) =>
    apiJson<{ message: string }>(`/ai/vaults/${vaultId}/conversations/${id}`, "DELETE"),
};

// ── MCP tokens ───────────────────────────────────────────────────────────────

export const mcpApi = {
  tokens: () => api<McpTokenList>("/mcp-tokens"),
  /** The token is in THIS response only — show it once. */
  createToken: (name: string) => apiJson<McpToken & { token: string }>("/mcp-tokens", "POST", { name }),
  revokeToken: (id: string) => apiJson<McpToken>(`/mcp-tokens/${id}`, "DELETE"),
};

// ── API keys (the public REST API's credential) ──────────────────────────────

// ── Community ────────────────────────────────────────────────────────────────

export const communityApi = {
  createTopic: (category: string, title: string, content: string) =>
    apiJson<{ id: string; slug: string }>("/community/topics", "POST", { category, title, content }),
  reply: (topicId: string, content: string) =>
    apiJson<{ id: string; post_number: number }>(`/community/topics/${topicId}/posts`, "POST", { content }),
  editPost: (postId: string, content: string) =>
    apiJson<{ id: string }>(`/community/posts/${postId}`, "PATCH", { content }),
  deletePost: (postId: string) => apiJson<{ deleted: string }>(`/community/posts/${postId}`, "DELETE"),
  deleteTopic: (topicId: string) => apiJson<{ deleted: string }>(`/community/topics/${topicId}`, "DELETE"),
  report: (postId: string, reason: string, detail: string) =>
    apiJson<{ id: string }>(`/community/posts/${postId}/report`, "POST", { reason, detail }),
  // Staff:
  moderateTopic: (topicId: string, patch: { pinned?: boolean; locked?: boolean; category?: string }) =>
    apiJson<{ id: string }>(`/community/topics/${topicId}`, "PATCH", patch),
  staffDeletePost: (postId: string) => apiJson<{ deleted: string }>(`/community/mod/posts/${postId}`, "DELETE"),
  staffDeleteTopic: (topicId: string) => apiJson<{ deleted: string }>(`/community/mod/topics/${topicId}`, "DELETE"),
  listReports: (status: "open" | "resolved") =>
    api<{ items: CommunityReportItem[]; total: number }>(`/community/mod/reports?status=${status}`),
  resolveReport: (reportId: string) =>
    apiJson<{ id: string; status: string }>(`/community/mod/reports/${reportId}/resolve`, "POST"),
};

export const apiKeysApi = {
  list: () => api<ApiKeyList>("/api-keys"),
  /** The key is in THIS response only — show it once. */
  create: (name: string, scopes: string[]) => apiJson<ApiKeyWithToken>("/api-keys", "POST", { name, scopes }),
  revoke: (id: string) => apiJson<ApiKey>(`/api-keys/${id}`, "DELETE"),
};

/** One importable source, as the picker renders it. */
export interface ImportSource {
  id: string;
  name: string;
  category: string;
  category_label: string;
  blurb: string;
  steps: string[];
  accepts: string[];
  icon: string;
  accent: string;
  popular: boolean;
  caveats: string[];
  connect_note: string | null;
}

export interface ImportResult {
  imported: number;
  renamed: number;
  imported_attachments?: number;
  imported_pdf_notes?: number;
  skipped_non_md?: number;
  skipped_too_large?: number;
  source: string;
  source_name: string;
  warnings: string[];
}

export const importApi = {
  /** The catalogue is static per deployment, so it caches happily. */
  sources: () => api<{ sources: ImportSource[]; categories: Record<string, string> }>("/integrations"),
  run: (vaultId: string, sourceId: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) {
      // webkitRelativePath carries "Export/Notes/x.md" when a folder is picked;
      // converters use it to rebuild the tree, so it must survive the upload.
      form.append("files", file, file.webkitRelativePath || file.name);
    }
    return api<ImportResult>(`/vaults/${vaultId}/import/${sourceId}`, { method: "POST", body: form });
  },
};

/** A syncable data source this instance can offer. */
export interface SyncProvider {
  id: string;
  name: string;
  blurb: string;
  caveats: string[];
  scopes: string[];
  available: boolean;
  self_hosted_only: boolean;
}

export interface SyncStreamStatus {
  stream: string;
  backfill_done: boolean;
  /** Cumulative records seen. A count, not a percentage — neither Google API
   *  reports a total, so a progress bar would be invented. */
  records_seen: number;
  last_success_at: string | null;
  syncing: boolean;
}

export interface ProviderConnection {
  id: string;
  provider: string;
  provider_name: string;
  vault_id: string;
  email: string;
  status: "active" | "transient_broken" | "needs_reauth" | "key_unavailable" | "paused";
  error_class: string;
  last_error: string;
  connected_at: string | null;
  last_success_at: string | null;
  settings: Record<string, unknown>;
  /** Outcome counts from the most recent run: created, updated, error… */
  last_run: Record<string, number>;
  /** Records the last run could not save. Non-zero means "not up to date". */
  failed_records: number;
  streams: SyncStreamStatus[];
}

export const connectionsApi = {
  providers: () =>
    api<{ configured: boolean; providers: SyncProvider[] }>("/connections/providers"),
  list: () => api<ProviderConnection[]>("/connections/connections"),
  /** Returns the Google consent URL for the browser to visit. */
  start: (vaultId: string, provider: string) =>
    apiJson<{ url: string; provider: string }>(
      `/connections/google/start?vault_id=${encodeURIComponent(vaultId)}&provider=${encodeURIComponent(provider)}`,
      "POST",
    ),
  syncNow: (connectionId: string) =>
    apiJson<Record<string, number>>(`/connections/connections/${connectionId}/sync`, "POST"),
  update: (connectionId: string, settings: Record<string, unknown>) =>
    apiJson<ProviderConnection>(`/connections/connections/${connectionId}`, "PATCH", settings),
  disconnect: (connectionId: string) =>
    apiJson<{ disconnected: string }>(`/connections/connections/${connectionId}`, "DELETE"),
};
