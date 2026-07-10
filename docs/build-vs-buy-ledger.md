# Build-vs-Buy Ledger

**Machine-checked by `.claude/hooks/build-vs-buy-gate.mjs` (ADR-032).** Before a new
capability file is hand-built under `lib/`, the gate requires a decision here whose
`Scope:` glob covers the file. This is the enforcement half of CLAUDE.md's advisory
"Market benchmark before building" + "reuse existing primitives" rules — it converts
them from prose the model skips under load into a hard checkpoint.

Recording an entry is **not a bypass** — it *is* the gate working: you did the reuse
scan, named what you considered, and chose build-vs-adopt on the record. The ledger
doubles as a durable, reviewable audit trail of every build-vs-buy call.

## How to add an entry

When the gate denies a new `lib/` file, do the scan, then append an entry:

1. **Check for an existing primitive** — `docs/REPO-MAP.md`, `lib/`, `components/shared/`.
2. **Check the vetted recipes** — the `/scale-up` recipe table (uploads, cron, jobs,
   realtime, PDF, …) and `docs/recipes.md`.
3. **Web-search for a library / open-source fit** — and weigh it against the Ask-before
   ">50 KB runtime dep needs an ADR or /scale-up recipe" rule.
4. Append the decision below. The `Scope:` line is what the gate matches (comma-separated
   globs; `*` = one path segment, `**` = any depth).

### Entry template

```
### YYYY-MM-DD — <capability>
Scope: lib/<area>/**
Considered: <option A — note>, <option B — note>, <library/open-source — note>.
Decision: <build | adopt | build-thin-wrapper-around-X> because <reason>. See <blueprint/ADR>.
```

---

## Decisions

### 2026-07-10 — PDF export (seed example)
Scope: lib/pdf/**
Considered: pdfkit (in-process; intentionally absent from lib/export.ts — fragile in
serverless per ADR-006), @react-pdf/renderer (heavy, >50 KB, own layout engine),
Stirling-PDF self-hosted sidecar (MIT core, REST API — adopted as a /scale-up recipe).
Decision: build a thin `lib/pdf/` HTTP client that POSTs to the Stirling-PDF sidecar
behind an internal-auth shared secret; no in-process PDF engine. Fills the deliberate
PDF-export gap without embedding a fragile serverless dependency. See ADR-032; a full
`docs/blueprints/pdf-export.md` is written when the recipe is actually built.
<!-- This seed entry is illustrative — lib/pdf/ is not yet built. Remove or supersede
     it when the real PDF recipe lands. It exists so the gate has a worked example and
     so `Scope: lib/pdf/**` demonstrates the match format. -->
