/**
 * Attachment URL resolution with expiry-aware caching.
 * `<img>` tags can't send Authorization headers, so widgets fetch a presigned
 * URL through the api client and then swap it into the src attribute.
 */

import { attachmentApi } from "@/lib/api/endpoints";

interface CachedUrl {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, CachedUrl>();
const inflight = new Map<string, Promise<string | null>>();

export async function resolveAttachmentUrl(vaultId: string, filename: string): Promise<string | null> {
  const key = `${vaultId}:${filename}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.url;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = attachmentApi
    .resolve(vaultId, filename)
    .then(({ url, expires_in }) => {
      // Refresh 60s before the presigned URL actually expires
      cache.set(key, { url, expiresAt: Date.now() + Math.max(expires_in - 60, 60) * 1000 });
      return url;
    })
    .catch(() => null)
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}
