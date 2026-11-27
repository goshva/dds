#!/usr/bin/env bash
# DSS local development launcher for Git Bash on Windows.
# Place this file in the repository root, next to package.json.
# Run: bash ./start-dss.sh
#
# Current package.json scripts (verified from user's terminal output):
#   API:      api:start
#   Frontend: ui:dev

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

API_HOST="${DSS_API_HOST:-127.0.0.1}"
API_PORT="${DSS_API_PORT:-8787}"
WEB_HOST="${DSS_WEB_HOST:-127.0.0.1}"
WEB_PORT="${DSS_WEB_PORT:-5173}"
LOG_DIR="${DSS_LOG_DIR:-.logs}"

API_PID=""
WEB_PID=""

say()  { printf '\033[1;36m[DSS]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

command -v bun >/dev/null 2>&1 || fail "Bun не найден. Проверь установку Bun и PATH в Git Bash."
[[ -f package.json ]] || fail "package.json не найден. Скрипт должен лежать в корне репозитория."

# Verify the exact scripts before starting either process.
bun -e '
const scripts = require("./package.json").scripts || {};
for (const name of ["api:start", "ui:dev"]) {
  if (!Object.prototype.hasOwnProperty.call(scripts, name)) {
    console.error(`Missing package.json script: ${name}`);
    process.exitCode = 1;
  } else {
    console.log(`${name}: ${scripts[name]}`);
  }
}
' || fail "Не найдены ожидаемые scripts api:start и ui:dev."

mkdir -p "$LOG_DIR"
API_LOG="$LOG_DIR/api.log"
WEB_LOG="$LOG_DIR/web.log"

stop_processes() {
  local code=$?
  trap - INT TERM EXIT
  say "Останавливаю frontend и API..."
  if [[ -n "$WEB_PID" ]]; then kill "$WEB_PID" 2>/dev/null || true; fi
  if [[ -n "$API_PID" ]]; then kill "$API_PID" 2>/dev/null || true; fi
  if [[ -n "$WEB_PID" ]]; then wait "$WEB_PID" 2>/dev/null || true; fi
  if [[ -n "$API_PID" ]]; then wait "$API_PID" 2>/dev/null || true; fi
  say "Остановлено. Логи находятся в $LOG_DIR/"
  exit "$code"
}
trap stop_processes INT TERM EXIT

say "Проект: $ROOT_DIR"
say "Запускаю API: bun run api:start"
# Server's current default address is expected to be 127.0.0.1:8787.
export HOST="$API_HOST"
export PORT="$API_PORT"
export DSS_API_HOST="$API_HOST"
export DSS_API_PORT="$API_PORT"

bun run api:start >"$API_LOG" 2>&1 &
API_PID=$!

sleep 2
if ! kill -0 "$API_PID" 2>/dev/null; then
  warn "API не запустился. Последние строки $API_LOG:"
  tail -n 60 "$API_LOG" || true
  exit 1
fi

say "Запускаю frontend: bun run ui:dev"
# Explicit host/port ensure Vite is reachable from the local browser.
bun run ui:dev -- --host "$WEB_HOST" --port "$WEB_PORT" --strictPort >"$WEB_LOG" 2>&1 &
WEB_PID=$!

sleep 2
if ! kill -0 "$WEB_PID" 2>/dev/null; then
  warn "Frontend не запустился. Последние строки $WEB_LOG:"
  tail -n 60 "$WEB_LOG" || true
  exit 1
fi

printf '\n'
say "Оба процесса запущены."
printf '  Frontend: http://%s:%s\n' "$WEB_HOST" "$WEB_PORT"
printf '  API:      http://%s:%s\n' "$API_HOST" "$API_PORT"
printf '  API log:  %s\n' "$API_LOG"
printf '  Web log:  %s\n' "$WEB_LOG"
printf '\n'
say "Для остановки нажми Ctrl+C."

# Keep this launcher alive and report if either process exits unexpectedly.
while true; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    warn "API-процесс завершился. Лог $API_LOG:"
    tail -n 60 "$API_LOG" || true
    exit 1
  fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    warn "Frontend-процесс завершился. Лог $WEB_LOG:"
    tail -n 60 "$WEB_LOG" || true
    exit 1
  fi
  sleep 2
done
