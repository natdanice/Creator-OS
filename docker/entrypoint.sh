#!/bin/bash
# Container entrypoint: prepares the database, then runs the Go API and the Next.js web app together.
#
#   APP_MODE=demo (default)  fictional story data; seeded on first start (RESET_DEMO=1 re-seeds on every start)
#   APP_MODE=live            your real data; the empty live database is created on first start
#
# The database lives in /app/data (mount a volume there, or everything is lost with the container).
# Exits as soon as either process exits, so a restart policy can bring both back.
set -euo pipefail

# These defaults match the Dockerfile; they are variables only so the script can be tested outside Docker.
APP_DIR="${APP_DIR:-/app}"
TSX="${TSX_BIN:-/opt/tsx/node_modules/.bin/tsx}"
API_BIN="${API_BIN:-creator-os-api}"
WEB_HOST="${WEB_HOST:-0.0.0.0}"
PORT="${PORT:-3000}"
API_PORT="${API_PORT:-8080}"
export API_PORT API_HOST="${API_HOST:-127.0.0.1}" API_URL="${API_URL:-http://127.0.0.1:$API_PORT}"

# An empty value (e.g. from `-e NAME=` or a compose default) must behave exactly like an unset one:
# the app only falls back to its safe defaults for unset variables (an empty PSEUDONYM_SALT would be a real salt).
for v in APP_PASSWORD AUTH_SECRET CRON_SECRET PSEUDONYM_SALT ANTHROPIC_API_KEY API_TOKEN RESET_DEMO MCP_READ_ONLY; do
  [ -n "${!v-}" ] || unset "$v"
done

cd "$APP_DIR"
mkdir -p data/uploads
say() { printf '[creator-os] %s\n' "$*"; }

# ── Database ─────────────────────────────────────────────────────
if [ "${APP_MODE:-demo}" = live ]; then
  export APP_MODE=live
  if [ ! -f data/creator-os-live.db ]; then say "Creating the empty live database"; "$TSX" scripts/setup-live.ts; fi
  "$TSX" scripts/migrate.ts # keeps your data, adds any new columns
  [ -n "${APP_PASSWORD:-}" ] || say "WARNING: APP_PASSWORD is not set, so the app has NO login. Set it before exposing the port to anyone."
  [ -n "${AUTH_SECRET:-}" ] || say "WARNING: AUTH_SECRET is not set (needed to connect accounts and keep logins secure)."
  [ -n "${PSEUDONYM_SALT:-}" ] || say "WARNING: PSEUDONYM_SALT is not set, so fan pseudonyms use the public default salt. Set your own BEFORE the first import."
else
  unset APP_MODE
  if [ ! -f data/creator-os.db ] || [ "${RESET_DEMO:-}" = 1 ]; then say "Seeding the demo database"; "$TSX" scripts/seed.ts >/dev/null; else "$TSX" scripts/migrate.ts; fi
fi

# ── Processes ────────────────────────────────────────────────────
"$API_BIN" &
api=$!
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/api/v1/health" 2>/dev/null && break
  kill -0 "$api" 2>/dev/null || { say "The API stopped right after starting"; exit 1; }
  sleep 0.5
done

node_modules/.bin/next start -H "$WEB_HOST" -p "$PORT" &
web=$!

stopping=0
stop() { kill -TERM "$api" "$web" 2>/dev/null || true; }
trap 'stopping=1; stop' TERM INT

# Supervise: leave as soon as either process exits or we are asked to stop. (A polling loop rather than
# `wait -n`, so the script behaves the same on any bash.) `sleep & wait` lets the trap fire immediately.
set +e
while [ "$stopping" = 0 ] && kill -0 "$api" 2>/dev/null && kill -0 "$web" 2>/dev/null; do
  sleep 1 &
  wait $!
done

code=0
if [ "$stopping" = 0 ]; then
  if kill -0 "$api" 2>/dev/null; then wait "$web"; else wait "$api"; fi
  code=$?
  say "A process exited (code $code); stopping the other"
fi
stop
wait 2>/dev/null
exit "$code" # a requested stop (docker stop) is a clean exit 0
