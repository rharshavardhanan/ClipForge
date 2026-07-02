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
[ -d node_modules ]          || { say "Installing root dependencies…";     npm install; }
[ -d remotion/node_modules ] || { say "Installing Remotion renderer…";     (cd remotion && npm install); }
[ -d ui/node_modules ]       || { say "Installing GUI…";                   (cd ui && npm install); }

# ---------- 3. .env ----------
if [ ! -f .env ]; then
  cp .env.example .env
  say "Created .env from .env.example"
  echo "  ${dim}Add ANTHROPIC_API_KEY (primary scoring) and/or GEMINI_API_KEY (fallback) to .env${reset}"
fi

# ---------- 4. Build (only when src is newer than dist) ----------
if [ ! -f dist/cli/index.js ] || [ -n "$(find src -name '*.ts' -newer dist/cli/index.js 2>/dev/null | head -1)" ]; then
  say "Building TypeScript…"
  npm run build
fi

# ---------- 5. Launch ----------
if [ "${1:-}" = "--setup" ]; then
  say "Setup complete. Run ./start.sh to open the GUI."
  exit 0
fi

if [ $# -eq 0 ]; then
  say "Starting ClipForge GUI → http://localhost:3210  ${dim}(Ctrl-C to stop)${reset}"
  exec node dist/cli/index.js ui
else
  exec node dist/cli/index.js "$@"
fi
