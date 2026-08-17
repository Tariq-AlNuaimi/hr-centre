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

# 3b. Bootstrap gitleaks if MISSING. `npm run ship` treats an absent gitleaks as a
#     hard FAILURE with install instructions (never a silent skip) -- correct, but in a
#     fresh remote container the binary is never there, so every push hit a RED /ship
#     for a reason that had nothing to do with the change and the honest workaround was
#     `git push --no-verify`, which skips the WHOLE gate. Fetching it here keeps the
#     secret scan a real gate instead of a routinely-bypassed one.
#     FAIL-OPEN by design: no egress / a moved release URL must not block the session.
#     /ship stays RED if this doesn't land, so the security floor is unchanged -- the
#     only difference is you get a readable reason now instead of a surprise at push.
if ! command -v gitleaks >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/gitleaks" ]; then
  gl_version="8.30.0"
  case "$(uname -s)" in
    Linux) gl_os="linux" ;;
    Darwin) gl_os="darwin" ;;
    *) gl_os="" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) gl_arch="x64" ;;
    arm64 | aarch64) gl_arch="arm64" ;;
    *) gl_arch="" ;;
  esac
  if [ -n "$gl_os" ] && [ -n "$gl_arch" ] && command -v curl >/dev/null 2>&1; then
    gl_url="https://github.com/gitleaks/gitleaks/releases/download/v${gl_version}/gitleaks_${gl_version}_${gl_os}_${gl_arch}.tar.gz"
    # `|| true` matters: this block is documented FAIL-OPEN, but a bare statement
    # under `set -euo pipefail` aborts the WHOLE hook on failure (read-only $HOME,
    # full disk, locked-down container) — skipping repo-map, the handoff surface,
    # agent-memory, and the drift checks below. Never let a gitleaks convenience
    # step take the session down.
    mkdir -p "$HOME/.local/bin" 2>/dev/null || true
    if curl -fsSL --max-time 60 "$gl_url" 2>/dev/null | tar -xz -C "$HOME/.local/bin" gitleaks 2>/dev/null; then
      chmod +x "$HOME/.local/bin/gitleaks" 2>/dev/null || true
      echo "[harness] installed gitleaks v${gl_version} -> ~/.local/bin (npm run ship can now run the secret scan)"
    else
      echo "[harness] WARNING: could not fetch gitleaks (no egress, or the release URL moved)."
      echo "[harness]          'npm run ship' will be RED at the gitleaks phase until it is on PATH:"
      echo "[harness]          Linux/macOS: https://github.com/gitleaks/gitleaks/releases (or 'brew install gitleaks')"
    fi
  else
    echo "[harness] WARNING: no gitleaks and no supported fetch for $(uname -s)/$(uname -m); 'npm run ship' will be RED at the gitleaks phase."
  fi
fi
# A binary at ~/.local/bin is only useful if that directory is on the PATH the LATER
# `npm run ship` process inherits. `export` here cannot do that -- the hook is its own
# process -- so verify rather than assume (senior review, 2026-07-25). ~/.local/bin is
# on PATH by default in the standard container; say so plainly when it is not, instead
# of installing a binary that /ship will never find.
if [ -x "$HOME/.local/bin/gitleaks" ] && ! command -v gitleaks >/dev/null 2>&1; then
  echo "[harness] WARNING: gitleaks is at ~/.local/bin but that directory is NOT on PATH."
  echo "[harness]          'npm run ship' will still be RED at the gitleaks phase. Add it:"
  echo "[harness]          export PATH=\"\$HOME/.local/bin:\$PATH\"   (in your shell profile)"
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
# session-state.json skeleton regen (harness-v2 V2-006): session-state.json is BRANCH-ONLY
# in-flight state (like SESSION-HANDOFF.md, ADR-019) -- committed on working branches, never
# merged to main, pruned from forks -- so a fresh fork/checkout may lack it. Regenerate a
# minimal VALID skeleton when absent so render-handoff + the status tooling keep working and
# a fork boots clean instead of crashing. Fail-open (|| true).
if [ ! -f docs/session-state.json ] && [ -d docs ]; then
  cat >docs/session-state.json <<'SEED' || true
{
  "program": "",
  "branch": "",
  "updated": "",
  "lastShip": { "sha": "", "status": "", "date": "" },
  "autoSpawn": { "enabled": false, "cap": 3, "consecutiveCount": 0, "lastSpawnSha": null },
  "directives": [],
  "workstreams": [],
  "categories": [],
  "deferred": [],
  "inProgress": [],
  "nextActions": []
}
SEED
  echo "[harness] docs/session-state.json was absent -- wrote a fresh skeleton (branch-only in-flight state; V2-006)."
fi
if [ -f docs/SESSION-HANDOFF.md ]; then
  node scripts/render-handoff.mjs >/dev/null 2>&1 || true
  echo "[harness] session handoff (docs/SESSION-HANDOFF.md) -- STANDING DIRECTIVE: show BOTH status tables (compact IN PROGRESS/REMAINING + full GRAND PROGRESS TABLE) before any work, then continue at Next actions:"
  awk '/<!-- BEGIN:auto-status/{f=1} f{print} /<!-- END:auto-status/{f=0}' docs/SESSION-HANDOFF.md 2>/dev/null || true
fi

# --- agent memory (ADR-022) ---
# Surface durable cross-session memory (decisions/gotchas/conventions) into the
# session up front. Whole file when within the context budget; otherwise the head
# + a pointer, so an un-pruned file can't tax every session. Fail-open, advisory.
# agent-memory is retrieval-on-demand (V2-102): surface ONLY the <!-- BEGIN/END:digest --> block
# (section headers + one-liners); the full `##` sections are grep/read on demand. Then run the
# mechanical budget check (warn only) so an over-budget digest/section surfaces without blocking.
if [ -f docs/agent-memory.md ]; then
  echo "[harness] agent memory (docs/agent-memory.md) -- SessionStart digest (full sections on demand; V2-102):"
  awk '/<!-- BEGIN:digest/{f=1} f{print} /<!-- END:digest/{f=0}' docs/agent-memory.md 2>/dev/null || true
  memwarn="$(node scripts/memory-digest.mjs 2>/dev/null || true)"
  if printf '%s' "$memwarn" | grep -q "BUDGET WARNINGS"; then
    printf '%s\n' "$memwarn" | sed -n '/BUDGET WARNINGS/,$p'
    echo "[harness] ...agent-memory over budget -- prune/promote per its curation rule, then 'npm run memory-digest'"
  fi
fi

# --- velocity pillar check (a): SessionStart context-size (V2-103) ---
# The always-on SessionStart tax (constitution + agent-memory digest + handoff) has a budget
# (constitution <=8KB, total <=20KB). Surface a WARN when it's over so context bloat is visible
# up front. Advisory/fail-open; the same budget is a hard /ship phase-A hook test.
if [ -f scripts/context-tax.mjs ]; then
  ctxwarn="$(node scripts/context-tax.mjs 2>/dev/null || true)"
  if printf '%s' "$ctxwarn" | grep -q "OVER"; then
    echo "[harness] velocity WARN -- SessionStart context over budget:"
    printf '%s\n' "$ctxwarn" | grep -E "OVER|WARN:"
  fi
fi
# Warn when many MCP servers are configured (schemas cost context; prune via /mcp).
# tr -dc collapses the count to a single integer -- under pipefail a no-match grep
# makes the subshell exit non-zero, so `|| echo 0` can append a second line.
mcp_count=$( ( (cat .mcp.json "$HOME/.claude.json" 2>/dev/null | grep -o '"command"' | wc -l) || echo 0 ) | tr -dc '0-9' )
if [ "${mcp_count:-0}" -gt 3 ]; then
  echo "[harness] NOTE: ~$mcp_count MCP server entries configured -- each loads tool schemas into context; disable unused ones via /mcp (docs/ARCHITECTURE.md)"
fi

# --- Superpowers plugin presence (harness-v2 V2-004) ---
# CLAUDE.md defers real multi-file features (brainstorm -> spec -> plan -> TDD) to the
# Superpowers plugin. That reference is only trustworthy if the plugin is actually loaded,
# so verify it at SessionStart and warn LOUDLY when it is absent (fail-open: never blocks).
# Ground truth = an installed/enabled "superpowers" entry in the plugin config or settings.
# Override the config path for testing via SUPERPOWERS_PLUGIN_CONFIG.
sp_config="${SUPERPOWERS_PLUGIN_CONFIG:-$HOME/.claude/plugins/installed_plugins.json}"
if grep -qi 'superpowers' "$sp_config" 2>/dev/null ||
  grep -qi '"superpowers[@"]' "$CLAUDE_PROJECT_DIR/.claude/settings.json" 2>/dev/null; then
  echo "[harness] Superpowers plugin: present (verified)."
else
  echo "[harness] WARNING: Superpowers plugin NOT detected this session. CLAUDE.md routes real"
  echo "          multi-file features (brainstorm -> spec -> plan -> TDD) through it. Install it"
  echo "          (/plugin marketplace add <superpowers-source> && /plugin install superpowers),"
  echo "          or fall back to the built-in /blueprint + writing-plans path for planning."
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
