#!/bin/bash
set -euo pipefail

# NOTE (startup delay tradeoff): this hook runs SYNCHRONOUSLY — the web/cloud
# session won't start until `npm install` finishes (~7s). That guarantees deps
# are ready before any build/test runs (no race), at the cost of slower startup.
# To make startup instant instead, switch to ASYNC mode: add this as the first
# line *before* the install step:  echo '{"async": true, "asyncTimeout": 300000}'
# Tradeoff: session starts immediately, but install runs in the background, so a
# command might fire before node_modules exists.

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
