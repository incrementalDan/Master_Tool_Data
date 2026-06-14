#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web (remote) sessions — local machines
# already have node_modules installed.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install JS dependencies so build/dev work in the fresh remote container.
# `npm install` (not `npm ci`) so the cached container state is reused on
# later sessions instead of wiping and reinstalling from scratch every time.
npm install --no-audit --no-fund
