/**
 * API client — same-origin fetch with in-memory access token.
 *
 * Auth pattern (docs/research/DECISIONS.md §1.4):
 * - Access token lives ONLY in memory (never localStorage).
 * - Refresh token is an httpOnly cookie scoped to /api/v1/auth, sent
 *   automatically because /api/* is proxied through the Next origin.
 * - On 401 we run a single-flight refresh and retry the request once.
 */

const BASE = "/api/v1";

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
let authExpiredHandler: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Called once by the auth store: invoked when a 401 retry's refresh fails,
 * i.e. the session is truly gone — the UI should transition to logged-out. */
export function onAuthExpired(handler: () => void): void {
  authExpiredHandler = handler;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Envelope<T> = { data: T };
type ErrorEnvelope = { error?: { code?: string; message?: string; details?: unknown } };

async function rawRequest(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(`${BASE}${path}`, { ...init, headers });
}

/** Single-flight refresh: many concurrent 401s share one refresh call. */
/** Refresh the access token, sharing the in-flight request. Exposed for the
 *  collab socket, which must re-present a live token on every reconnect. */
export function refreshAccessToken(): Promise<boolean> {
  return tryRefresh();
}

async function tryRefresh(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, { method: "POST" });
      if (!res.ok) return false;
      const body = (await res.json()) as Envelope<{ access_token: string }>;
      accessToken = body.data.access_token;
      return true;
    } catch {
      return false;
    } finally {
      // Allow the next refresh cycle after this one settles.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();
  return refreshPromise;
}

async function parseError(res: Response): Promise<ApiError> {
  let code = "unknown_error";
  let message = `Request failed (${res.status})`;
  let details: unknown;
  try {
    const body = (await res.json()) as ErrorEnvelope;
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
    details = body.error?.details;
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, code, message, details);
}

// Endpoints whose own 401 means "wrong credentials", not "token expired":
// refreshing and retrying those would be wrong (and, for login, would log the
// person out of nothing). Everything else under /auth — /auth/me, change
// password, delete-account — is a normal authenticated call and gets the
// refresh-and-retry like any other, so an answer given after the access token
// expired (the first-run tour, left open for a while) is not silently lost.
const CREDENTIAL_PATHS = [
  "/auth/refresh",
  "/auth/login",
  "/auth/signup",
  "/auth/logout",
  "/auth/verify-email",
  "/auth/resend-verification",
  "/auth/forgot-password",
  "/auth/reset-password",
  // not /auth/change-password: a wrong current password is a 403 there, so an
  // expired token is the only 401 it can return — and that must refresh.
];
function isCredentialPath(path: string): boolean {
  return CREDENTIAL_PATHS.some((p) => path === p || path.startsWith(`${p}?`));
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  { retryOn401 = true }: { retryOn401?: boolean } = {},
): Promise<T> {
  let res = await rawRequest(path, init);

  if (res.status === 401 && retryOn401 && !isCredentialPath(path)) {
    if (await tryRefresh()) {
      res = await rawRequest(path, init);
    } else {
      // Session is truly gone (refresh cookie expired/invalidated) — tell the
      // auth store so the app transitions to logged-out instead of silently
      // erroring on every request.
      accessToken = null;
      authExpiredHandler?.();
    }
  }

  if (!res.ok) throw await parseError(res);
  // 204 (and any empty body) has nothing to parse — calling res.json() on it
  // throws "Unexpected end of JSON input", which surfaced as a mystery error
  // toast on every DELETE that returns No Content.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return (JSON.parse(text) as Envelope<T>).data;
}

export function apiJson<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  payload?: unknown,
): Promise<T> {
  return api<T>(path, {
    method,
    headers: payload === undefined ? {} : { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}
