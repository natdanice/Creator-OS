# syntax=docker/dockerfile:1
#
# Creator OS in one image: the Go API (backend/) and the Next.js web app, started together.
#
#   ./docker-build.sh              # build and push 3dsinteractive/creator-os:latest
#   docker build -t creator-os .
#   docker run --rm -p 127.0.0.1:3000:3000 -v creator-os-data:/app/data creator-os            # demo data
#   docker run --rm -p 127.0.0.1:3000:3000 -v creator-os-data:/app/data \
#       -e APP_MODE=live -e APP_PASSWORD=... -e AUTH_SECRET=... creator-os                      # your real data
#
# (or `docker compose up --build`; see docker-compose.yml and the README)

ARG NODE_VERSION=24
ARG GO_VERSION=1.26

# ── 1. Go API: one static binary (the SQLite driver is pure Go, so no C compiler) ──
FROM golang:${GO_VERSION}-bookworm AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/creator-os-api ./cmd/server

# ── 2. Production dependencies only (what `next start` and the SQLite driver need) ──
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 # fail the build now, not at first start, if the native SQLite driver didn't come through
 && node -e "new (require('better-sqlite3'))(':memory:').prepare('select 1').get()"

# ── 3. tsx, kept apart so the seed/migrate scripts can run without the dev dependencies ──
FROM node:${NODE_VERSION}-bookworm-slim AS tools
WORKDIR /opt/tsx
RUN npm init -y >/dev/null && npm install tsx@4

# ── 4. Build the web app ──
FROM node:${NODE_VERSION}-bookworm-slim AS web
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && rm -rf .next/cache

# ── 5. Runtime ──
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    API_PORT=8080 \
    API_HOST=127.0.0.1
# tini forwards signals and reaps processes; curl is for the health check and the entrypoint.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=tools /opt/tsx /opt/tsx
COPY --from=api   /out/creator-os-api /usr/local/bin/creator-os-api
COPY --from=web   --chown=node:node /app/.next ./.next
# Source the seed/migrate scripts import, plus the SQL migrations and the sample CSVs.
COPY package.json next.config.ts tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY drizzle ./drizzle
COPY data/samples ./data/samples
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint

# Only data/ (the database and uploads) and .next need to be writable, so chown just those: a chown over the
# whole app would copy node_modules into another image layer.
RUN mkdir -p data/uploads && chown -R node:node data
USER node
VOLUME /app/data

# 3000 = the web app. The Go API (8080) stays inside the container unless you set API_HOST=0.0.0.0 and API_TOKEN.
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/" && curl -fsS -o /dev/null "http://127.0.0.1:${API_PORT}/api/v1/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint"]
