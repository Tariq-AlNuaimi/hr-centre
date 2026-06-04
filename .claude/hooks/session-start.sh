#!/bin/bash
set -euo pipefail

# SessionStart hook for the fullstack-vibe-template harness.
# Runs synchronously so the session does not accept its first prompt until deps are ready.
# Idempotent: every step gates on "missing", so re-running is a no-op.

cd "${CLAUDE_PROJECT_DIR:-.}"

# 1. Bootstrap .env from example so the zod env parser in lib/env.ts does not throw on import.
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "[harness] copied .env.example -> .env"
fi

# 2. Install deps if missing. npm install (not ci) so the container layer cache picks it up on rebuilds.
if [ ! -d node_modules ]; then
  echo "[harness] installing npm deps..."
  npm install --no-audit --no-fund
fi

# 3. Generate the Prisma client if missing. Uses a dummy DATABASE_URL so client
#    generation does not require a running database.
if [ ! -d generated/prisma ]; then
  echo "[harness] generating prisma client..."
  DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate >/dev/null
fi

echo "[harness] ready -- run 'make db-up' to start dev containers when you need the DB"
