# ============================================================
# Nodum Web — Multi-stage Dockerfile (Next.js standalone)
# ============================================================

# ── Base ──────────────────────────────────────────────────
FROM node:22-alpine AS base
WORKDIR /app

# ── Dependencies ──────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── Development ───────────────────────────────────────────
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

# ── Build ─────────────────────────────────────────────────
FROM base AS build
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ARG NEXT_PUBLIC_SENTRY_DSN=
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
# Rewrites are inlined into the routes manifest AT BUILD TIME — the proxy
# target must be a build arg (compose default: the api service).
ARG API_PROXY_URL=http://api:8000
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV API_PROXY_URL=$API_PROXY_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Production ────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Base patches, then strip npm out of the runtime. This stage runs
# `node server.js` against a self-contained standalone bundle and never
# installs anything, but the npm that ships in the base image carries its own
# vendored tree (brace-expansion, tar, picomatch, sigstore, ip-address) which
# accounted for every fixable HIGH/CRITICAL Trivy found here — none of them
# reachable, none of them fixable by updating our dependencies.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm \
              /usr/local/bin/npm /usr/local/bin/npx \
              /root/.npm

RUN addgroup -S nodum && adduser -S nodum -G nodum

COPY --from=build --chown=nodum:nodum /app/.next/standalone ./
COPY --from=build --chown=nodum:nodum /app/.next/static ./.next/static
COPY --from=build --chown=nodum:nodum /app/public ./public

USER nodum
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
