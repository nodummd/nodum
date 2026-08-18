/** API payload types mirroring back/app/schemas. */

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  email_verified: boolean;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

/** Signup's other answer: the address has to be confirmed before any token
 *  is issued. */
export interface VerificationRequired {
  status: "verification_required";
  email: string;
  expires_in_minutes: number;
}

export function isVerificationRequired(
  result: TokenPair | VerificationRequired,
): result is VerificationRequired {
  return (result as VerificationRequired).status === "verification_required";
}

export interface Vault {
  id: string;
  name: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface FolderInfo {
  id: string;
  parent_id: string | null;
  name: string;
  path: string;
}

export interface NoteMeta {
  id: string;
  folder_id: string | null;
  title: string;
  path: string;
  word_count: number;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Note extends NoteMeta {
  content: string;
}

export type TreeItem =
  | { type: "folder"; id: string; name: string; path: string; children: TreeItem[] }
  | {
      type: "note";
      id: string;
      title: string;
      path: string;
      created_at: string;
      updated_at: string;
    };

export interface VaultTree {
  truncated?: boolean;
  vault_id: string;
  items: TreeItem[];
}

export interface Backlink {
  note_id: string;
  title: string;
  path: string;
  count: number;
  snippets: string[];
}

export interface OutgoingLink {
  target_title: string;
  target_note_id: string | null;
  resolved_title: string | null;
  resolved_path: string | null;
  is_embed: boolean;
  count: number;
}

export interface UnlinkedMention {
  note_id: string;
  title: string;
  path: string;
  snippets: string[];
}

export interface GraphNode {
  id: string;
  title: string;
  path: string;
  folder: string;
  degree: number;
  unresolved: boolean;
  tags: string[];
  /** ISO time; null for ghost nodes. */
  created_at: string | null;
}

export interface Graph {
  /** Set when the server capped the payload (huge vault). */
  truncated?: boolean;
  vault_id: string;
  nodes: GraphNode[];
  edges: [number, number][];
  center?: string;
}

export interface SearchResult {
  id: string;
  title: string;
  path: string;
  snippet: string;
  rank: number;
  created_at: string;
  updated_at: string;
}

export interface QuickSwitchResult {
  id: string;
  title: string;
  path: string;
  score: number;
  /** Present when the match came through a frontmatter alias. */
  alias?: string;
}

export interface NoteVersionMeta {
  id: string;
  title: string;
  created_at: string;
  size_chars: number;
}

export interface NoteVersionDetail extends NoteVersionMeta {
  content: string;
}

export interface TagCount {
  name: string;
  count: number;
}

export interface AttachmentInfo {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

// ── Canvas (JSON Canvas format) ─────────────────────────────────────────────

export interface CanvasNode {
  id: string;
  type: "text" | "file" | "link";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  url?: string;
  color?: string;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: "top" | "right" | "bottom" | "left";
  toSide?: "top" | "right" | "bottom" | "left";
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasMeta {
  id: string;
  name: string;
  updated_at: string;
}

export interface CanvasFull extends CanvasMeta {
  data: CanvasData;
}

// ── AI (bring your own key) ──────────────────────────────────────────────────

export interface AIProviderInfo {
  id: string;
  label: string;
  default_model: string;
  models: string[];
  key_url: string;
}

/** Never carries an API key — only a hint like `sk-ant…7f2a`. */
export interface AICredentialInfo {
  provider: string;
  model: string;
  key_hint: string;
  base_url: string;
}

export interface AIStatus {
  /** False when the server has no encryption key, so keys cannot be stored. */
  available: boolean;
  configured: boolean;
  active_provider: string | null;
  active_model: string;
  credentials: AICredentialInfo[];
  providers: AIProviderInfo[];
}

/** A change the assistant made to the vault during a turn. */
export interface AIAction {
  kind: "created" | "updated";
  title: string;
  note_id: string;
}

export interface AIChatReply {
  reply: string;
  provider: string;
  model: string;
  actions?: AIAction[];
  /** The thread this turn was appended to — a new one when none was sent. */
  conversation_id: string;
  title: string;
}

export interface AIConversationMeta {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AIConversationMessage {
  role: "user" | "assistant";
  content: string;
  actions: AIAction[];
}

export interface AIConversationDetail {
  id: string;
  title: string;
  updated_at: string;
  messages: AIConversationMessage[];
}
