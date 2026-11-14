#!/usr/bin/env bash
# Stops everything ./start.sh started: the Go API and the Next.js frontend (and anything they spawned).
set -uo pipefail
cd "$(dirname "$0")"
RUN=.run
PORT="${PORT:-3000}"
API_PORT="${API_PORT:-8080}"

alive() { kill -0 "$1" 2>/dev/null; }

# Ends a process group: polite first, forceful after a few seconds.
stop_group() {
  local name="$1" pid="$2"
  alive "$pid" || { echo "$name was not running"; return; }
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  for _ in $(seq 1 20); do alive "$pid" || break; sleep 0.25; done
  if alive "$pid"; then
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
    echo "$name stopped (forced)"
  else
    echo "$name stopped"
  fi
}

stopped_any=0
for name in web api; do
  f="$RUN/$name.pid"
  if [ -f "$f" ]; then
    stop_group "$name" "$(cat "$f")"
    rm -f "$f"
    stopped_any=1
  fi
done
rm -f "$RUN/mode"

# A server this project started earlier without its pid file (e.g. from another terminal) still holds
# its port. Only end processes that are clearly ours: the compiled API, or Next in this project folder.
leftover() {
  local port="$1" pid cmd
  for pid in $(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null); do
    cmd="$(ps -o command= -p "$pid" 2>/dev/null)"
    case "$cmd" in
      *creator-os-api*|*"$PWD"*next*|*next-server*|*"next dev"*|*"next start"*)
        kill -TERM "$pid" 2>/dev/null && echo "Stopped leftover process $pid on port $port" && stopped_any=1 ;;
      *) echo "Port $port is used by something else ($pid) — left alone." ;;
    esac
  done
}
leftover "$API_PORT"
leftover "$PORT"

[ "$stopped_any" = 1 ] || echo "Nothing was running."
exit 0
