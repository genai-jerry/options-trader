#!/usr/bin/env bash
# Start the options-trader stack.
#
# Default mode (dev):  spawns the API server (apps/server) and the Vite dev
#                      server (apps/web) in the background. PIDs and logs
#                      land in .run/ so stop.sh can clean up.
# --prod:              builds the web app, then runs the API server with
#                      WEB_STATIC_DIR pointing at the build so a single
#                      Express process serves /api + the SPA.
# --docker:            `docker compose up -d --build`.
#
# Usage:
#   scripts/start.sh                 # local dev (default)
#   scripts/start.sh --prod          # local prod-style single-process run
#   scripts/start.sh --docker        # docker compose
#   scripts/start.sh --help

set -euo pipefail

MODE="dev"
for arg in "$@"; do
  case "$arg" in
    --dev)    MODE="dev" ;;
    --prod)   MODE="prod" ;;
    --docker) MODE="docker" ;;
    -h|--help)
      sed -n '1,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown flag: $arg" >&2
      exit 2
      ;;
  esac
done

# Resolve repo root (scripts/ lives one level under it).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RUN_DIR="$ROOT/.run"
mkdir -p "$RUN_DIR"

is_running() {
  local pidfile="$1"
  [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

# Spawn $@ in a new session so the captured PID is the leader of its own
# process group. stop.sh then kills the whole tree by walking pgrep -P.
spawn_bg() {
  local logfile="$1"
  shift
  if command -v setsid >/dev/null 2>&1; then
    setsid -- "$@" >"$logfile" 2>&1 < /dev/null &
  else
    # macOS without util-linux: fall back to plain & — stop.sh's recursive
    # walk still finds children via pgrep -P.
    "$@" >"$logfile" 2>&1 < /dev/null &
  fi
  echo "$!"
}

case "$MODE" in
  dev)
    if is_running "$RUN_DIR/server.pid" || is_running "$RUN_DIR/web.pid"; then
      echo "Already running. Run scripts/stop.sh first or check .run/." >&2
      exit 1
    fi

    echo "[start] dev mode — server (apps/server) + web (apps/web)"
    if [[ ! -d node_modules ]]; then
      echo "[start] node_modules missing — running npm install"
      npm install
    fi

    # API server.
    spawn_bg "$RUN_DIR/server.log" \
      npm --workspace apps/server run dev > "$RUN_DIR/server.pid"

    # Web (Vite) — proxies /api to the server.
    spawn_bg "$RUN_DIR/web.log" \
      npm --workspace apps/web run dev > "$RUN_DIR/web.pid"

    sleep 1
    echo "  server pid $(cat "$RUN_DIR/server.pid")  →  http://localhost:4000/api/health"
    echo "  web    pid $(cat "$RUN_DIR/web.pid")  →  http://localhost:5173"
    echo "  logs:    .run/server.log  .run/web.log"
    echo "  stop:    scripts/stop.sh"
    ;;

  prod)
    if is_running "$RUN_DIR/server.pid"; then
      echo "Already running. Run scripts/stop.sh first." >&2
      exit 1
    fi

    echo "[start] prod mode — building web bundle"
    npm run build:web

    export WEB_STATIC_DIR="$ROOT/apps/web/dist"
    export NODE_ENV="${NODE_ENV:-production}"

    echo "[start] launching server (serving SPA from $WEB_STATIC_DIR)"
    spawn_bg "$RUN_DIR/server.log" \
      npm --workspace apps/server run start > "$RUN_DIR/server.pid"

    sleep 1
    echo "  pid $(cat "$RUN_DIR/server.pid")  →  http://localhost:${PORT:-4000}"
    echo "  log .run/server.log"
    echo "  stop: scripts/stop.sh --prod"
    ;;

  docker)
    if ! command -v docker >/dev/null; then
      echo "docker not installed." >&2
      exit 1
    fi
    echo "[start] docker compose up -d --build"
    docker compose up -d --build
    docker compose ps
    echo "  url:  http://localhost:${HOST_PORT:-4000}"
    echo "  logs: docker compose logs -f"
    echo "  stop: scripts/stop.sh --docker"
    ;;
esac
