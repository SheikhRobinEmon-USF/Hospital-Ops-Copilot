#!/usr/bin/env bash
# One command to run Hospital Ops Copilot locally: API (port 8000) + web app (port 3000).
# Usage: ./scripts/dev.sh        Stop with Ctrl+C (stops both).
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
api_up() { curl -s --max-time 1 http://localhost:8000/health >/dev/null; }
web_up() { curl -s --max-time 1 -o /dev/null http://localhost:3000; }

say "Python environment"
[ -d .venv ] || python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -e ".[dev]"

say "Web dependencies"
(cd web && npm install --no-audit --no-fund --loglevel=error)

if curl -s --max-time 2 http://localhost:11434/api/version >/dev/null; then
  say "Ollama is running: the copilot will use your local model"
else
  say "Ollama is not running: the copilot will use offline analyst mode (open the Ollama app for AI answers)"
fi

if web_up; then
  say "The web app is already running: opening http://localhost:3000"
  command -v open >/dev/null && open http://localhost:3000
  exit 0
fi

API_PID=""
cleanup() { [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
if api_up; then
  say "API already running on http://localhost:8000 (reusing it)"
else
  say "Starting API on http://localhost:8000"
  hoc api &
  API_PID=$!
  for _ in $(seq 1 60); do api_up && break; sleep 0.5; done
  api_up || { echo "API did not start. See the messages above."; exit 1; }
fi

say "Starting web app on http://localhost:3000 (Ctrl+C stops everything)"
( for _ in $(seq 1 60); do
    if curl -s --max-time 1 -o /dev/null http://localhost:3000; then
      command -v open >/dev/null && open http://localhost:3000 || true
      break
    fi
    sleep 0.5
  done ) &
cd web && NEXT_TELEMETRY_DISABLED=1 npm run dev
