#!/usr/bin/env bash
# Starts Creator OS: the Go API (backend/) and the Next.js frontend, in the background.
#
#   ./start.sh              demo mode (fictional data), development servers
#   ./start.sh live         your real data (data/creator-os-live.db)
#   ./start.sh --prod       build first, then run the production servers (also: ./start.sh live --prod)
#
# Logs: .run/api.log and .run/web.log. Stop everything with ./stop.sh.
# Settings (optional env vars): PORT (frontend, 3000), API_PORT (8080), HOST (frontend address, 127.0.0.1).
set -euo pipefail
cd "$(dirname "$0")"

MODE=demo
PROD=0
for arg in "$@"; do
  case "$arg" in
    live) MODE=live ;;
    demo) MODE=demo ;;
    --prod|prod) PROD=1 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try ./start.sh --help)" >&2; exit 2 ;;
  esac
done

PORT="${PORT:-3000}"
API_PORT="${API_PORT:-8080}"
HOST="${HOST:-127.0.0.1}" # local only by default: live mode holds real data
RUN=.run
mkdir -p "$RUN"

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

# ── Already running? ─────────────────────────────────────────────
alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
if alive "$RUN/api.pid" || alive "$RUN/web.pid"; then
  die "Creator OS is already running. Run ./stop.sh first."
fi
rm -f "$RUN/api.pid" "$RUN/web.pid" "$RUN/mode"

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
port_busy "$PORT" && die "Port $PORT is already in use (set another with PORT=3001 ./start.sh)."
port_busy "$API_PORT" && die "Port $API_PORT is already in use (set another with API_PORT=8081 ./start.sh)."

# ── Tools ────────────────────────────────────────────────────────
[ -d /usr/local/go/bin ] && export PATH="$PATH:/usr/local/go/bin"
command -v go >/dev/null || die "Go is not installed (or not on PATH). Install it from https://go.dev/dl/"
command -v node >/dev/null || die "Node.js is not installed."
[ -d node_modules ] || { say "Installing frontend packages…"; npm install; }

# ── Database ─────────────────────────────────────────────────────
if [ "$MODE" = live ]; then
  [ -f data/creator-os-live.db ] || die "No live database yet. Run: npm run setup:live"
  APP_MODE=live npm run -s migrate >/dev/null # keeps your data, adds any new columns
else
  [ -f data/creator-os.db ] || { say "Creating the demo database…"; npm run -s seed >/dev/null; }
  npm run -s migrate >/dev/null
fi

# ── Build the API ────────────────────────────────────────────────
say "Building the Go API…"
(cd backend && go build -o bin/creator-os-api ./cmd/server)

# Job control gives each background job its own process group, so ./stop.sh can end a server and
# everything it spawned in one go.
set -m

# ── Start the API ────────────────────────────────────────────────
APP_MODE_ENV=""
[ "$MODE" = live ] && APP_MODE_ENV="live"
(
  cd backend
  APP_MODE="$APP_MODE_ENV" API_PORT="$API_PORT" exec ./bin/creator-os-api
) >"$RUN/api.log" 2>&1 &
echo $! >"$RUN/api.pid"

say "Waiting for the API…"
for _ in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null 2>&1 && break
  alive "$RUN/api.pid" || { tail -n 15 "$RUN/api.log" >&2; rm -f "$RUN/api.pid"; die "The API stopped right after starting."; }
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null 2>&1 || { ./stop.sh >/dev/null 2>&1 || true; die "The API did not answer in time. See $RUN/api.log"; }

# ── Start the frontend ───────────────────────────────────────────
if [ "$PROD" = 1 ]; then
  say "Building the frontend (this takes a minute)…"
  APP_MODE="$APP_MODE_ENV" API_URL="http://127.0.0.1:$API_PORT" npm run -s build >"$RUN/build.log" 2>&1 || { tail -n 20 "$RUN/build.log" >&2; ./stop.sh >/dev/null 2>&1 || true; die "Frontend build failed. See $RUN/build.log"; }
  WEB_CMD=(node_modules/.bin/next start -H "$HOST" -p "$PORT")
else
  WEB_CMD=(node_modules/.bin/next dev -H "$HOST" -p "$PORT")
fi
(
  APP_MODE="$APP_MODE_ENV" API_URL="http://127.0.0.1:$API_PORT" exec "${WEB_CMD[@]}"
) >"$RUN/web.log" 2>&1 &
echo $! >"$RUN/web.pid"
echo "$MODE" >"$RUN/mode"

say "Waiting for the frontend…"
ready=0
for _ in $(seq 1 120); do
  if curl -fsS -o /dev/null "http://$HOST:$PORT/login" 2>/dev/null || curl -sS -o /dev/null "http://$HOST:$PORT/" 2>/dev/null; then ready=1; break; fi
  alive "$RUN/web.pid" || break
  sleep 0.5
done
if [ "$ready" != 1 ]; then
  tail -n 15 "$RUN/web.log" >&2
  ./stop.sh >/dev/null 2>&1 || true
  die "The frontend did not start. See $RUN/web.log"
fi

say ""
say "Creator OS is running ($MODE mode$([ "$PROD" = 1 ] && echo ', production'))"
say "  App  http://$HOST:$PORT"
say "  API  http://127.0.0.1:$API_PORT/api/v1/health"
say "  Logs $RUN/api.log · $RUN/web.log"
say "  Stop ./stop.sh"
if [ "$MODE" = live ] && ! grep -qE '^APP_PASSWORD=.+' .env.local 2>/dev/null; then
  say ""
  say "Note: APP_PASSWORD is not set, so the app has no login. It only listens on this computer."
fi
