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

# 4. Drift check (advisory). If the current working branch has fallen behind
#    origin/main, say so up front -- caught at session start it's a clean
#    fast-forward; caught after stacking days of work it's a manual reconcile
#    (see the merge that prompted this). Never blocks, never auto-merges, and
#    stays silent when on main / offline / no remote, so it can't get in the way.
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
  if [ -n "$branch" ] && [ "$branch" != "main" ] && [ "$branch" != "HEAD" ]; then
    # Fetch quietly with a short timeout so an offline/slow remote never stalls
    # the synchronous hook. A failed fetch just skips the check.
    if command -v timeout >/dev/null 2>&1; then
      fetched="$(timeout 15 git fetch --quiet origin main 2>/dev/null && echo ok || echo no)"
    else
      fetched="$(git fetch --quiet origin main 2>/dev/null && echo ok || echo no)"
    fi
    if [ "$fetched" = ok ]; then
      behind="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
      if [ "${behind:-0}" -gt 0 ]; then
        echo "[harness] WARNING: '$branch' is $behind commit(s) behind origin/main -- consider 'git merge origin/main' before stacking more work (avoids a big reconcile later)"
      fi
    fi
  fi
fi


# --- token thrift (ADR-019) ---
# Regenerate the orientation map when schema/app/lib changed since last build.
if [ ! -f docs/REPO-MAP.md ] || [ -n "$(find prisma/schema.prisma app lib -newer docs/REPO-MAP.md -print -quit 2>/dev/null)" ]; then
  node scripts/repo-map.mjs >/dev/null 2>&1 && echo "[harness] repo-map refreshed (docs/REPO-MAP.md)"
fi
# Warn when many MCP servers are configured (schemas cost context; prune via /mcp).
mcp_count=$( (cat .mcp.json "$HOME/.claude.json" 2>/dev/null | grep -o '"command"' | wc -l) || echo 0 )
if [ "${mcp_count:-0}" -gt 3 ]; then
  echo "[harness] NOTE: ~$mcp_count MCP server entries configured -- each loads tool schemas into context; disable unused ones via /mcp (docs/token-policy.md)"
fi
