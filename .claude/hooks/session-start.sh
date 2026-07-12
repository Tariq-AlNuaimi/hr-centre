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

# 2. Install deps if MISSING OR STALE. npm install (not ci) so the container layer
#    cache picks it up on rebuilds. Stale check (package.json / lockfile newer than
#    node_modules) fixes the documented landmine: after checking out a branch whose
#    package.json moved ahead, "missing-only" left phantom missing modules at
#    typecheck (docs/agent-memory.md 2026-06-20).
if [ ! -d node_modules ] \
  || [ package.json -nt node_modules ] \
  || { [ -f package-lock.json ] && [ package-lock.json -nt node_modules ]; }; then
  echo "[harness] installing npm deps (missing or stale)..."
  npm install --no-audit --no-fund
fi

# 3. Generate the Prisma client if MISSING OR STALE (schema newer than the
#    generated client). Same landmine: a branch whose schema.prisma moved ahead
#    used to typecheck against stale generated types. Dummy DATABASE_URL so
#    generation does not require a running database.
if [ ! -d generated/prisma ] || [ prisma/schema.prisma -nt generated/prisma ]; then
  echo "[harness] generating prisma client (missing or stale)..."
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

# --- session handoff surface (session-automation Part 3, auto-start) ---
# Surface the program status handoff FIRST (higher priority than agent-memory) so
# a fresh session orients instantly on the grand table + in-progress/remaining
# cut instead of reconstructing status from prose. The tables are rendered from
# docs/session-state.json (scripts/render-handoff.mjs); we re-render here so the
# printed status is never stale, then print the standing directive + the
# auto-status block. Fail-open: any failure just skips the surface.
if [ -f docs/SESSION-HANDOFF.md ]; then
  node scripts/render-handoff.mjs >/dev/null 2>&1 || true
  echo "[harness] session handoff (docs/SESSION-HANDOFF.md) -- STANDING DIRECTIVE: show BOTH status tables (compact IN PROGRESS/REMAINING + full GRAND PROGRESS TABLE) before any work, then continue at Next actions:"
  awk '/<!-- BEGIN:auto-status/{f=1} f{print} /<!-- END:auto-status/{f=0}' docs/SESSION-HANDOFF.md 2>/dev/null || true
fi

# --- agent memory (ADR-022) ---
# Surface durable cross-session memory (decisions/gotchas/conventions) into the
# session up front. Whole file when within the context budget; otherwise the head
# + a pointer, so an un-pruned file can't tax every session. Fail-open, advisory.
if [ -f docs/agent-memory.md ]; then
  mem_lines="$( (wc -l < docs/agent-memory.md 2>/dev/null || echo 0) | tr -dc '0-9' )"
  echo "[harness] agent memory (docs/agent-memory.md) -- durable cross-session notes:"
  if [ "${mem_lines:-0}" -le 150 ]; then
    cat docs/agent-memory.md
  else
    head -n 60 docs/agent-memory.md
    echo "[harness] ...agent-memory.md is ${mem_lines} lines (over the ~150 budget) -- showing the head only; read the full file, then prune/promote per its curation rule"
  fi
fi
# Warn when many MCP servers are configured (schemas cost context; prune via /mcp).
# tr -dc collapses the count to a single integer -- under pipefail a no-match grep
# makes the subshell exit non-zero, so `|| echo 0` can append a second line.
mcp_count=$( ( (cat .mcp.json "$HOME/.claude.json" 2>/dev/null | grep -o '"command"' | wc -l) || echo 0 ) | tr -dc '0-9' )
if [ "${mcp_count:-0}" -gt 3 ]; then
  echo "[harness] NOTE: ~$mcp_count MCP server entries configured -- each loads tool schemas into context; disable unused ones via /mcp (docs/token-policy.md)"
fi

# --- template drift (advisory; forks only) ---
# If this fork has synced from the template before (.template-sync.json is
# present and tracked), occasionally check whether the template has moved ahead
# and nudge to run /sync-from-template. Gated on the marker so it NEVER runs in
# the template repo itself or in a never-synced fork. Throttled to once/24h via a
# gitignored stamp, short timeout, fail-open -- it must never block or slow
# session start, and stays silent when offline / up to date.
if [ -f .template-sync.json ]; then
  stamp=".claude/.template-check-stamp"
  now="$(date +%s)"
  last=0
  [ -f "$stamp" ] && last="$(cat "$stamp" 2>/dev/null || echo 0)"
  if [ "$(( now - last ))" -ge 86400 ]; then
    echo "$now" > "$stamp" 2>/dev/null || true
    if command -v timeout >/dev/null 2>&1; then
      drift="$(timeout 25 npm run --silent sync-template -- --check 2>/dev/null || true)"
    else
      drift="$(npm run --silent sync-template -- --check 2>/dev/null || true)"
    fi
    if echo "$drift" | grep -q "Behind by"; then
      n="$(echo "$drift" | grep -o 'Behind by [0-9]*' | grep -o '[0-9]*' | head -1)"
      echo "[harness] NOTE: the template has ${n:-some} new commit(s) since your last sync -- run 'npm run sync-template -- --check' to see what, then 'npm run sync-template' to pull them (/sync-from-template)"
    fi
  fi
fi

# --- browser-egress bridge auto-start (fail-open; docs/runbooks/browser-egress-in-web-sessions.md) ---
# In a web session the TLS-MITM egress proxy resets Chromium's ClientHello, so the
# browser MCP servers + /design-qa /uat /manual-uat can't reach any real site. `auto`
# starts the local mitmproxy chain ONLY if mitmproxy is already installed -- it never
# installs (keeps SessionStart fast) and is a silent no-op off-platform (no $HTTPS_PROXY)
# or when mitmproxy is absent. Run `make browser-up` once to install + enable it.
node scripts/browser-bridge.mjs auto >/dev/null 2>&1 || true
