# Web Stack Research — Production Next.js App (Aug 2026)

Researched 2026-08-12. Versions verified against npm / endoflife.date / official docs on that date.

## 1. Exact versions

| Package | Version (Aug 2026) | Notes |
|---|---|---|
| `next` | **15.5.23** (latest 15.x, 2026-08-06) | App Router. **15.x EOL is 2026-10-21.** Next 16.3.0 is the current stable line (16.x released Oct 2025) — see note below. |
| `react` / `react-dom` | **19.2.8** | Latest stable 19.x (19.3 only in canary). |
| `typescript` | **5.x** (latest 5.9.x) | Next 15.5 explicitly rejects TS >= 7.0; stay on 5.x. |
| `tailwindcss` | **4.3.3** | v4 CSS-first config, no `tailwind.config.js`. |
| `@tailwindcss/postcss` | **4.3.3** (match `tailwindcss`) | v4 split the PostCSS plugin out of the core package. |
| `shadcn` (CLI) | **4.13.1** — use `npx shadcn@latest` | CLI v3+ added namespaced registries; v4 (Mar 2026) current. Full Tailwind v4 + React 19 support; components have no `forwardRef`, use `data-slot`. |
| `zustand` | **5.0.14** | v5 API (no default export changes vs v4 patterns, `create()` + selectors). |
| `@tanstack/react-query` | **5.101.4** | v5 stable line; add `@tanstack/react-query-devtools` at same version. |
| `cmdk` | **1.1.1** | Stable, slow-moving. shadcn's `Command` component wraps it — prefer `npx shadcn@latest add command` over hand-rolling. |
| Node (runtime/Docker) | **node:22-alpine** | Node 22 is active LTS; fine for Next 15/16. |

**Next 15 vs 16 decision:** the task pins 15.x, which is fine today, but 15.x loses security support 2026-10-21 (~2 months). If this is a greenfield production app, strongly consider starting on **16.3.x** (same App Router mental model; 15.5 already prints Next-16 deprecation warnings, so a 15.5.23 codebase that heeds the warnings upgrades cleanly). If staying on 15.x, plan the 16 upgrade before October.

## 2. Project setup (Next 15 App Router + Tailwind v4)

```bash
npx create-next-app@15.5.23 web \
  --typescript --app --src-dir --tailwind --eslint --turbopack --import-alias "@/*"
```

`create-next-app` with `--tailwind` now scaffolds Tailwind **v4**:

- `postcss.config.mjs`:
  ```js
  export default { plugins: { "@tailwindcss/postcss": {} } };
  ```
- `src/app/globals.css` (no `tailwind.config.js`, no `content` array — auto content detection):
  ```css
  @import "tailwindcss";

  @theme {
    --color-brand-500: oklch(0.65 0.2 250);
    --font-sans: "Inter", ui-sans-serif, system-ui;
  }
  ```
- Config that used to live in `tailwind.config.js` moves into `@theme` / `@theme inline`. Plugins load via `@plugin "..."` in CSS if needed.

## 3. shadcn/ui

```bash
npx shadcn@latest init        # detects Tailwind v4 + React 19, writes components.json, adds cn() util, CSS vars
npx shadcn@latest add button dialog dropdown-menu command sonner ...
```

- On a Tailwind v4 project the CLI generates v4-style output: theme tokens as CSS variables under `@theme inline`, HSL→OKLCH colors, no `tailwind.config`.
- `add command` pulls in `cmdk` automatically — that is the supported command-palette path (wrap in a `Dialog`, bind Cmd+K yourself).
- React 19: no `forwardRef` in generated components; every primitive exposes `data-slot="..."` for styling overrides.

## 4. State/data layer

- **zustand 5.0.14** — client/UI state only (sidebar, palette open, optimistic UI, in-memory auth token). Keep stores small; do not persist secrets (`persist` middleware only for benign prefs).
- **@tanstack/react-query 5.101.4** — all server state from the FastAPI backend. Mount `QueryClientProvider` in a `"use client"` `providers.tsx` rendered from the root layout. Sensible defaults: `staleTime: 30_000`, `retry: 1`, mutations invalidate by query key. v5 API notes: single-object signatures (`useQuery({ queryKey, queryFn })`), `isPending` (not `isLoading`) on mutations, `gcTime` (not `cacheTime`).
- **cmdk 1.1.1** via shadcn `Command` for the palette; drive its open state from a zustand store so any component can toggle it.

## 5. Docker: standalone output, multi-stage, non-root

`next.config.ts`:

```ts
const nextConfig = { output: "standalone" };
export default nextConfig;
```

`Dockerfile` (canonical vercel/next.js pattern, node:22-alpine, non-root):

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# --- deps ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- build ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* build args go here if the client bundle needs them
RUN npm run build

# --- runtime ---
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
```

Key points:

- `output: "standalone"` makes `next build` emit `.next/standalone` with a pruned `node_modules` + `server.js`; the runtime image contains no build toolchain (~150–200 MB total vs 1 GB+ naive).
- `.next/static` and `public/` are **not** included in standalone output — copy them explicitly (as above) unless a CDN serves them.
- Non-root `nextjs:nodejs` (uid/gid 1001) is the accepted hardening baseline; combine with a read-only root FS and dropped capabilities at the orchestrator level if possible.
- `HOSTNAME=0.0.0.0` is required or the standalone server binds localhost only inside the container.
- Add a `.dockerignore` (`node_modules`, `.next`, `.git`, `docs`) and a healthcheck hitting a lightweight route (e.g. `/api/health`).
- Runtime secrets via env at `docker run`/compose; only `NEXT_PUBLIC_*` values are baked at build.

## 6. Auth: Next.js SPA-style client against FastAPI

Two workable patterns; pick one, don't mix.

### Pattern A — httpOnly refresh cookie + in-memory access token (recommended here)

FastAPI stays the single auth authority; Next.js is a mostly-static SPA shell.

- **Login** (`POST /api/auth/login` on FastAPI): returns short-lived access JWT (**10–15 min**) in the JSON body, and sets the refresh token as a cookie:
  `Set-Cookie: refresh=...; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh; Max-Age=<7-30d>`
  — scoping `Path` to the refresh endpoint means the token rides on no other request.
- **Client**: access token lives **in memory only** (a zustand store; never localStorage — XSS-exfiltratable). Attach as `Authorization: Bearer` via a fetch wrapper / react-query `queryFn` helper.
- **Silent refresh**: on app boot and on any 401, call `POST /api/auth/refresh` with `credentials: "include"`; queue/replay in-flight requests once (react-query `retry` + a single-flight refresh promise). Hard redirect to login when refresh itself 401s.
- **Server side (FastAPI)**: rotate refresh tokens on every use, store a hash per token family (Redis/DB), and revoke the whole family on reuse detection. Keep access JWTs stateless (no DB hit).
- **CSRF**: the refresh endpoint is the only cookie-authenticated mutating route. `SameSite=Lax` + strict `Origin`/`Referer` allowlist check on FastAPI covers it; a double-submit token is optional belt-and-braces.
- **Topology**: serve FastAPI same-site — either `api.example.com` (cookie `Domain=.example.com`, CORS with `Access-Control-Allow-Credentials: true` and an exact origin) or, cleaner, reverse-proxy `/api/*` → FastAPI at the ingress/nginx level so cookies are first-party and CORS disappears entirely. Prefer the proxy.
- **Tradeoff**: page reload always costs one refresh round-trip; access token is invisible to SSR, so authenticated rendering is client-side (fine for an app-behind-login dashboard).

### Pattern B — BFF (Next.js route handlers proxy FastAPI)

- Browser only ever talks to Next; tokens (or a session id) live in an httpOnly cookie set by Next route handlers; handlers attach the bearer token when calling FastAPI server-to-server.
- Wins: no token in browser JS at all; SSR/RSC can render authenticated data (`cookies()` in server components); trivial same-origin cookie story.
- Costs: every API call double-hops through the Next server; you now own session/token storage in Next (encrypted cookie e.g. `jose`/`iron-session`, or Redis) plus refresh logic in two places; Next server becomes stateful-ish infra you must scale.

**Verdict for a SPA-style client (this project):** Pattern A. It keeps FastAPI as the only auth code, works unchanged for future non-Next clients (CLI, mobile), and the standalone Next container stays a dumb static-ish frontend. Choose B only if authenticated SSR/RSC rendering becomes a real requirement.

**Regardless of pattern:** do not treat Next middleware as the security boundary (the 2025 `x-middleware-subrequest` bypass, CVE-2025-29927, made this concrete — patched, but the lesson stands). Middleware may redirect for UX; FastAPI must enforce authz on every endpoint. Keep Next on the latest patch (15.5.23+ includes 2026 fixes for middleware/proxy bypass, SSRF, and cache-confusion advisories).

## 7. Sources

- https://endoflife.date/nextjs — 15.5.23 latest 15.x (2026-08-06), 15.x EOL 2026-10-21, 16.3.0 current
- https://nextjs.org/blog/next-15-5 — 15.5 deprecations ahead of Next 16
- https://www.npmjs.com/package/react — 19.2.8 stable
- https://www.npmjs.com/package/tailwindcss / https://tailwindcss.com/blog/tailwindcss-v4-1 — 4.3.3; v4 PostCSS split, CSS-first config
- https://nextjs.org/docs/app/getting-started/css — Tailwind v4 + Next setup
- https://ui.shadcn.com/docs/tailwind-v4, https://ui.shadcn.com/docs/react-19, https://ui.shadcn.com/docs/changelog/2026-03-cli-v4 — shadcn CLI 4.13.1, Tailwind v4/React 19 support
- https://www.npmjs.com/package/zustand (5.0.14), https://www.npmjs.com/package/@tanstack/react-query (5.101.4), https://www.npmjs.com/package/cmdk (1.1.1)
- https://blog.arcjet.com/security-advice-for-self-hosting-next-js-in-docker/ — non-root, standalone hardening
- https://github.com/vercel/next.js/discussions/16995 + official `with-docker` example — multi-stage Dockerfile pattern
- https://www.thewidlarzgroup.com/blog/nextjs-ssr---jwt-access-refresh-token-authentication-with-external-backend, https://www.david-crimi.com/blog/user-auth — Next + external-backend JWT patterns
