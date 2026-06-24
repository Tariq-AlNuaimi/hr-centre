# Session handoff — harness-hardening sweep (15 operator complaints)

## Goal
Fix 15 operator complaints about the template/harness (skills not enforcing their
claims, lost cross-session state, missing docker skill, false "no access", weak
process/architecture, horrible UI, unenforced 5 pillars). Operator decisions:
all-in-one-sweep · native vetted design · tiered blocking gate · hard hooks.

## State
- Branch `claude/repo-skills-overview-baheeu`, **all work committed AND pushed**
  (verified 0 ahead after each push). `/ship` green on every push (incl. the new
  scalability gate).
- Last 4 commits this session: `129d443` (W4 design), `be7352a` (W2 QA),
  `6b9734d` (W1+W3 blueprint/pillars), `f18708c`→ (W5-W8 quick wins).
- **gitleaks** had to be installed to `~/.local/bin` (v8.21.2) for the pre-push
  gate — does NOT survive a fresh container (known landmine). Re-install + re-export
  PATH next session before any push.

## Done (all 8 workstreams landed)
- W6 `/docker` skill (wraps ADR-023 rail) · fixed stale `/handoff` re-containerize text.
- W7 deploy-default-to-live + "run preflight, trust verdict" (deploy/new-project
  SKILLs, CLAUDE.md, clearer new-project.mjs bail).
- W8 watchdog: not template-gated — real fork failure is settings.json being a
  sync REVIEW layer; documented in sync-from-template + known-traps.
- W5 `Stop` hook `.claude/hooks/session-stop.mjs` (warns on unpushed/uncommitted) +
  PreCompact reminder + verified-push in handoff-session/remember + CLAUDE.md rule.
- W1 `/blueprint` tiered pre-build gate + docs/blueprints/ + wired into
  quickstart/scaffold-entity/CLAUDE.md.
- W3 Five Pillars binding section in CLAUDE.md + ship.mjs scalability scan
  (unbounded findMany) + docs/findings-register.md + /qa won't green on open wave-offs.
- W2 manual-uat coverage matrix + uat Full benchmark/PDF required (not silent skip).
- W4 `/design-system` skill + docs/design-recipes.md (market-scanned, native) +
  rubric/scaffold/design-qa wiring.

## Decisions (promote to agent-memory)
- Native design system over importing external skills (ADR-022 consistency).
- Tiered blueprint gate; pillars as gates not rubric anchors.
- Pre-push hook runs full /ship, so a separate /ship call is redundant once gitleaks
  is on PATH.

## Next steps (the operator wants BLOCKING gates — this is the hardening roadmap)
1. **Make the Stop hook actually BLOCK on unpushed commits** (not just warn):
   emit `{"decision":"block","reason":...}` once (guard with `stop_hook_active` to
   avoid loops) in `.claude/hooks/session-stop.mjs`. Keep uncommitted-WIP as a warn.
2. **Make the 5 pillars a hard CLAUDE.md "Hard rule"** + promote the pillar
   affirmation in /ship from a checklist to a required, logged step (block green
   until each pillar is affirmed or waived in the register).
3. **Blueprint enforcement**: consider a PreToolUse/PreCompact check (or a /ship
   phase) that fails when an Ask-before-surface change has no `docs/blueprints/*`
   and no plan-mode trace — making the gate structural, not advisory.
4. **Tier check in /ship**: fail if `project.config.json` tier is still default while
   the change touches shared surfaces.
5. **Pending**: a senior-code-reviewer pass on `f18708c..HEAD` was running at handoff
   (agent id in session) — focus was session-stop.mjs (throw/loop safety, @{u}
   handling) + ship.mjs scanScalability (regex false-pos: "take" in a comment passes
   a genuinely-unbounded file; multiline findMany). Apply any P0/P1 it found.
6. Consider ADRs for: the blueprint gate, pillars-as-gates, native design-system.

## Open risk to verify next session
- `scanScalability` in ship.mjs matches bounding tokens anywhere in the file (incl.
  comments) — low false-NEGATIVE risk worth tightening to per-call-site if it bites.
