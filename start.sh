#!/usr/bin/env bash
#
# ClipForge one-shot launcher.
#
#   ./start.sh              → set up (if needed) and open the GUI at http://localhost:3210
#   ./start.sh all <url>    → set up (if needed) and run any CLI command directly
#   ./start.sh --setup      → install/build only, don't launch anything
#
# Idempotent: skips installs/builds that are already done, so after the first run
# it starts in a couple of seconds.
set -euo pipefail
cd "$(dirname "$0")"

bold=$(tput bold 2>/dev/null || true); dim=$(tput dim 2>/dev/null || true); reset=$(tput sgr0 2>/dev/null || true)
say()  { echo "${bold}▸${reset} $*"; }
fail() { echo "✗ $*" >&2; exit 1; }

# ---------- perception-setup (Python AI perception microservice) ----------
# Isolated: its own venv under perception/.venv; Node touches it only via the CLI.
if [ "${1:-}" = "perception-setup" ]; then
  command -v ffmpeg >/dev/null || fail "ffmpeg not found — brew install ffmpeg"
  # TF/torch wheels lag the newest python — prefer 3.12 when present.
  PY=python3; command -v python3.12 >/dev/null && PY=python3.12
  command -v "$PY" >/dev/null || fail "python3 not found — install Python 3.10+ (brew install python@3.12)"
  if command -v uv >/dev/null; then
    say "Setting up perception service with uv (perception/.venv)…"
    (cd perception && { [ -d .venv ] || uv venv --python "$PY" .venv; } && uv pip install --python .venv/bin/python -e ".[dev,real]")
  else
    say "Setting up perception service with venv+pip (perception/.venv)…"
    [ -d perception/.venv ] || "$PY" -m venv perception/.venv
    perception/.venv/bin/pip install --upgrade pip >/dev/null
    perception/.venv/bin/pip install -e "perception[dev,real]"
  fi
  # HF_TOKEN (free) unlocks pyannote diarization; yamnet/clip warm without it.
  if [ -f .env ] && grep -qE '^HF_TOKEN=.+' .env; then
    export "$(grep -E '^HF_TOKEN=.+' .env | head -1)"
  else
    echo "  ${dim}No HF_TOKEN in .env — pyannote diarization will be skipped. Get a free token at"
    echo "  hf.co/settings/tokens and accept the terms at hf.co/pyannote/speaker-diarization-3.1"
    echo "  and hf.co/pyannote/segmentation-3.0, then re-run ./start.sh perception-setup.${reset}"
  fi
  say "Pre-downloading models (first run only — this can take several minutes)…"
  perception/.venv/bin/clipforge-perception warm || true
  say "Perception ready. Verify: perception/.venv/bin/clipforge-perception --help"
  exit 0
fi

# ---------- 1. Required tools ----------
command -v node    >/dev/null || fail "node not found — install Node 20+ (nvm install 24)"
command -v npm     >/dev/null || fail "npm not found"
command -v ffmpeg  >/dev/null || fail "ffmpeg not found — brew install ffmpeg"
command -v ffprobe >/dev/null || fail "ffprobe not found — brew install ffmpeg"
command -v yt-dlp  >/dev/null || echo "⚠ yt-dlp not found (brew install yt-dlp) — YouTube ingest won't work; local files still will"
command -v whisper-cli >/dev/null 2>&1 || command -v whisper-cpp >/dev/null 2>&1 || \
  echo "⚠ whisper-cpp not found (brew install whisper-cpp) — only needed for local files / videos without captions"

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || fail "Node $NODE_MAJOR is too old — need Node 20+ (nvm use 24)"

# ---------- 2. Dependencies (root, remotion renderer, GUI) ----------
# Reinstall when package.json is newer than node_modules (e.g. after a git pull),
# not just when node_modules is missing. touch marks the install as current.
fresh_deps() { [ -d "$1/node_modules" ] && [ ! "$1/package.json" -nt "$1/node_modules" ]; }
fresh_deps .        || { say "Installing root dependencies…"; npm install && touch node_modules; }
fresh_deps remotion || { say "Installing Remotion renderer…"; (cd remotion && npm install && touch node_modules); }
fresh_deps ui       || { say "Installing GUI…";               (cd ui && npm install && touch node_modules); }

# ---------- 3. .env ----------
if [ ! -f .env ]; then
  cp .env.example .env
  say "Created .env from .env.example"
  echo "  ${dim}Add ANTHROPIC_API_KEY (primary scoring) and/or GEMINI_API_KEY (fallback) to .env${reset}"
fi

# ---------- 4. Build (whenever any src file or tsconfig is newer than the last build) ----------
if [ ! -f dist/cli/index.js ] \
   || [ tsconfig.json -nt dist/cli/index.js ] \
   || [ -n "$(find src -name '*.ts' -newer dist/cli/index.js 2>/dev/null | head -1)" ]; then
  say "Building TypeScript…"
  npm run build
fi

# ---------- 5. Launch ----------
if [ "${1:-}" = "--setup" ]; then
  say "Setup complete. Run ./start.sh to open the GUI."
  exit 0
fi

# Keep the Mac awake while ClipForge runs so long renders/batches aren't paused by
# display or idle sleep. `caffeinate -dimsu` covers display+disk+idle+system(on AC)+user-active.
# NOTE: closing the laptop lid still sleeps on battery — keep it plugged in (or lid open)
# for unattended overnight runs. Set CLIPFORGE_NO_CAFFEINATE=1 to opt out.
KEEP_AWAKE=()
if [ "${CLIPFORGE_NO_CAFFEINATE:-}" != "1" ] && [ "$(uname)" = "Darwin" ] && command -v caffeinate >/dev/null; then
  KEEP_AWAKE=(caffeinate -dimsu)
  say "Keeping the Mac awake while ClipForge runs (caffeinate) ${dim}— plug in for lid-closed runs${reset}"
fi

if [ $# -eq 0 ]; then
  say "Starting ClipForge GUI → http://localhost:3210  ${dim}(Ctrl-C to stop)${reset}"
  exec "${KEEP_AWAKE[@]}" node dist/cli/index.js ui
else
  exec "${KEEP_AWAKE[@]}" node dist/cli/index.js "$@"
fi
