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
}

export interface Graph {
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
