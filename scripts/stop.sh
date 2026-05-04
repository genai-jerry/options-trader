#!/usr/bin/env bash
# Stop the options-trader stack.
#
# Default mode (dev):  reads .run/server.pid and .run/web.pid (written by
#                      start.sh) and sends SIGTERM, escalating to SIGKILL
#                      after a brief grace period if needed.
# --prod:              same, but only stops the server PID.
# --docker:            `docker compose down`.
#
# Usage:
#   scripts/stop.sh                  # dev (default)
#   scripts/stop.sh --prod
#   scripts/stop.sh --docker
#   scripts/stop.sh --help

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

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
RUN_DIR="$ROOT/.run"

# Recursively gather PIDs: a node and every descendant. Leaves come first
# so a depth-first kill takes them out before the parents reap.
collect_tree() {
  local pid="$1"
  local children
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  for c in $children; do
    collect_tree "$c"
  done
  echo "$pid"
}

# Kill the parent + every descendant. SIGTERM first, then SIGKILL after a
# 5s grace period for anything that didn't shut down. Cleans up the
# pidfile even if the process was already gone.
kill_tree() {
  local pidfile="$1"
  local label="$2"
  if [[ ! -f "$pidfile" ]]; then
    echo "  [$label] no pidfile"
    return 0
  fi
  local pid
  pid="$(cat "$pidfile")"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "  [$label] pid $pid not running"
    rm -f "$pidfile"
    return 0
  fi

  local pids
  pids="$(collect_tree "$pid")"
  echo "  [$label] SIGTERM $(echo "$pids" | tr '\n' ' ')"
  for p in $pids; do kill -TERM "$p" 2>/dev/null || true; done

  for _ in 1 2 3 4 5; do
    local alive=0
    for p in $pids; do
      if kill -0 "$p" 2>/dev/null; then alive=1; break; fi
    done
    if [[ $alive -eq 0 ]]; then
      rm -f "$pidfile"
      return 0
    fi
    sleep 1
  done

  echo "  [$label] SIGKILL stragglers"
  for p in $pids; do kill -KILL "$p" 2>/dev/null || true; done
  rm -f "$pidfile"
}

case "$MODE" in
  dev)
    echo "[stop] dev mode"
    kill_tree "$RUN_DIR/web.pid"    "web"
    kill_tree "$RUN_DIR/server.pid" "server"
    echo "[stop] done"
    ;;

  prod)
    echo "[stop] prod mode"
    kill_tree "$RUN_DIR/server.pid" "server"
    echo "[stop] done"
    ;;

  docker)
    if ! command -v docker >/dev/null; then
      echo "docker not installed." >&2
      exit 1
    fi
    echo "[stop] docker compose down"
    docker compose down
    ;;
esac
