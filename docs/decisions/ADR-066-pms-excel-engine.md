# ADR-066 — Excel engine for the PMS import layer: `read-excel-file` + `write-excel-file`

**Status:** Accepted (2026-08-24, Tariq Al-Naaimi)
**Date:** 2026-08-24
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

The Performance Management System spec (v1.0, §3.1) mandates that v1 employee and org data is
**loaded via Excel import**, written through an import layer into an internal employee table,
with Odoo becoming a second loader in v2. §11.7 additionally requires a **bonus Excel export**
for the payroll team. So the system needs to both read and write `.xlsx` server-side.

The template ships no Excel engine today. `docs/oss-catalog.md` lists **exceljs** as the
in-stack choice behind a `lib/export.ts` recipe — but `lib/export.ts` does not exist in this
fork, exceljs is not in `package.json`, and **ADR-051 (§ item 4) explicitly froze feature work
on exceljs**: it is unmaintained (Snyk flags it "inactive… could be considered discontinued"),
and community forks exist purely to patch critical and security bugs. ADR-051 recorded a
migration track to **SheetJS (`xlsx`)** installed from the vendor CDN tarball rather than the
frozen npm `xlsx@0.18`, but deliberately did not implement it.

So this ADR is the first time the question is live rather than deferred, and the decision has
to be made against a real requirement rather than a hypothetical export.

Verified 2026-08-24:

| Package              | Version | License    | Last publish                | Runtime deps                          |
| -------------------- | ------- | ---------- | --------------------------- | ------------------------------------- |
| `exceljs`            | 4.4.0   | MIT        | **2024-12-20 (~20 months)** | jszip, pako, + subtree                |
| SheetJS `xlsx` (CDN) | 0.20.3  | Apache-2.0 | vendor CDN only             | none                                  |
| `read-excel-file`    | 9.3.10  | MIT        | **2026-08-10 (2 weeks)**    | saxen, fflate, worker-f, unzipper-esm |
| `write-excel-file`   | 4.1.1   | MIT        | **2026-06-08**              | fflate                                |

The `exceljs` publish date confirms ADR-051's stalled finding independently, 13 months on.

## Decision drivers

- **The npm registry is where our supply-chain controls actually work.** ADR-051 built the
  posture: gitleaks, `npm audit` High+, a license allowlist, Renovate with a min-release-age
  cooldown, and lockfile integrity. Every one of those keys off a registry dependency. A
  dependency that bypasses the registry bypasses the controls that ADR-051 exists to provide.
- **Deploy availability.** `vercel.json` runs the build on every push. A dependency resolved
  from a single third-party CDN makes `cdn.sheetjs.com` a hard build-time dependency of every
  production deploy — an availability coupling the registry+lockfile path does not have.
- **The parsing surface is untrusted input.** HR uploads arbitrary `.xlsx` files. A maintained
  engine matters more here than in an export-only path, because a parser bug is reachable by
  an uploaded file.
- **What the spec actually needs is narrow.** §3.3 is eleven typed columns and §3.4 is five
  validation rules. This is "read a sheet into typed rows, report per-row errors", not
  arbitrary workbook manipulation.
- **ADR-051's freeze on exceljs is binding**, and its stated reason (unmaintained) has only
  strengthened.

## Considered options

### Option 1 — `read-excel-file` + `write-excel-file` (chosen)

Two focused, same-author MIT packages from the npm registry: one parses `.xlsx` into typed
rows against a declared schema, the other writes `.xlsx` from rows.

- Good, because both resolve from the npm registry, so ADR-051's whole control stack —
  `npm audit`, the license gate, Renovate cooldown, lockfile integrity — applies unchanged.
- Good, because both are actively maintained (last publishes 2 weeks and 3 months ago) against
  exceljs's 20-month silence.
- Good, because `read-excel-file`'s schema feature maps columns to typed fields and returns
  **per-row, per-cell errors** — which is structurally what §3.4 asks for ("a row failing any
  rule is rejected/flagged, never silently accepted"), rather than something we hand-roll on
  top of a generic cell grid.
- Good, because the dependency subtrees are small and legible (`saxen` SAX parser, `fflate`
  zip) versus exceljs's `jszip`/`pako` subtree that ADR-051 called a latent liability.
- Good, because no build-time CDN coupling: `npm ci` on Vercel resolves from the registry.
- Bad, because it is two dependencies rather than one.
- Bad, because it is a narrower tool — styled workbooks, formulas, or multi-sheet manipulation
  would need a different engine. (Nothing in the spec asks for those; §11.7 explicitly wants
  "clean, logically structured layout".)
- Bad, because both come from a single independent maintainer (bus factor), on GitLab.

### Option 2 — SheetJS (`xlsx`) from the vendor CDN

ADR-051's recorded migration track.

- Good, because it is one dependency covering read and write, Apache-2.0, and the most capable
  Excel engine in the ecosystem.
- Good, because it has no runtime dependencies at all.
- Bad, because installing from `https://cdn.sheetjs.com/...` puts the dependency outside the
  npm registry — Renovate cannot track it, `npm audit` has nothing to resolve, and the license
  gate cannot read it. It is precisely the "silently pulls something a gate can't see" failure
  ADR-051 was written to prevent, arrived at from the other direction.
- Bad, because it makes a single third-party CDN a hard build-time dependency of every
  production deploy.
- Bad, because the registry copy (`xlsx@0.18.5`) that Renovate _could_ see is frozen and
  carries known advisories — so the safe artifact and the visible artifact are different
  things, which is a confusing posture to hand a fork operator.
- Neutral: far more capability than §3.3/§3.4/§11.7 require.

### Option 3 — `exceljs`

The `docs/oss-catalog.md` in-stack listing.

- Good, because it is already the catalog's named choice and covers read and write.
- Bad, because **ADR-051 froze feature work on it**, and this would be new feature work.
- Bad, because 20 months without a publish, on a package that parses untrusted uploads.
- Bad, because it drags the `jszip`/`pako` subtree ADR-051 wanted a pruning path away from.

### Option 4 — Hand-write an `.xlsx` reader/writer

`.xlsx` is a zip of XML; `node:zlib` plus a central-directory parser is roughly 250 lines.

- Good, because zero new dependencies and a fully auditable parser.
- Bad, because it is a hand-rolled parser for untrusted input — the worst category of code to
  own without a security budget.
- Bad, because it fails the reuse-first rule (pillar 3) for a solved problem.
- Bad, because it would have to grow shared-strings, inline-strings, date-serial, and number-
  format handling to survive real HR exports from Excel, Google Sheets, and Odoo.

## Decision

**Option 1** — adopt `read-excel-file` (parse) and `write-excel-file` (emit), both from the npm
registry, both MIT.

This **deviates from ADR-051's recorded SheetJS track**, and the deviation is deliberate.
ADR-051 opened that track in 2026-07 on the reasoning "exceljs is stalled, SheetJS is the
capable successor" — that half still holds. But its own central thesis is that the binding
supply-chain control is _visibility to our gates_, not CVE count, and a CDN-resolved dependency
is invisible to every gate ADR-051 built. The first decision driver settles it: choosing SheetJS
here would mean building a new untrusted-input parsing path on the one dependency in the tree
that Renovate, `npm audit`, and the license gate cannot see, while also making every production
deploy depend on a third-party CDN being up. When the requirement turned out to be eleven typed
columns and five validation rules, the capability advantage that justified SheetJS stopped
paying for that cost.

Note that ADR-051's freeze on exceljs is **upheld, not overturned** — this ADR moves away from
exceljs, as ADR-051 intended; it only changes the destination.

Consumed through a thin in-house seam so the engine stays swappable:
`lib/pms/import/loaders/xlsx.ts` (the only file that imports `read-excel-file`) and
`lib/pms/export/xlsx.ts` (the only file that imports `write-excel-file`). Everything downstream
speaks the canonical `EmployeeSourceRow` shape (§3.1's import-layer mandate), so replacing the
engine — or adding the v2 Odoo loader — touches one file.

Both packages are server-side only; neither reaches the client bundle.

## Consequences

### Positive

- The Excel path is covered by ADR-051's existing controls instead of sitting outside them.
- Production deploys depend only on the npm registry, as every other dependency does.
- `read-excel-file`'s schema/error model does the §3.4 per-row rejection reporting natively.
- exceljs stays frozen and unused; the `jszip`/`pako` subtree is never introduced.
- The loader seam means the v2 Odoo sync (§14) replaces one file.

### Negative

- Two dependencies instead of one, both from a single independent maintainer (bus factor).
- Narrower capability: no styled workbooks, formulas, or complex multi-sheet manipulation.
- ADR-051's SheetJS track is now superseded for this use, so the catalog and that ADR's item 4
  are stale until updated.
- `read-excel-file` ships worker/browser builds we do not use, inflating installed size beyond
  what the server path needs.

### Mitigations

- Engine imports are confined to two files, so a maintainer going dark is a contained swap, not
  a refactor — SheetJS remains the named fallback if that happens.
- Upload caps (file size, sheet count, row count) are enforced **before** parsing, so a parser
  bug is reachable only within bounded input.
- `docs/oss-catalog.md` and ADR-051's item 4 are updated to point here.
- Payroll export (§11.7) is specified as a "clean, logically structured layout", well within
  `write-excel-file`'s range; if Odoo-importable formatting later demands rich styling, that is
  a migration trigger, not a workaround.

## Alternatives considered

1. **SheetJS from the vendor CDN** — rejected: invisible to every supply-chain gate ADR-051
   built, and makes a third-party CDN a build-time dependency of production deploys. See
   Considered options.
2. **exceljs** — rejected: frozen by ADR-051, 20 months unmaintained, parses untrusted uploads.
3. **Hand-written xlsx reader/writer** — rejected: owning a parser for untrusted input, against
   reuse-first. See Considered options.

## Migration triggers

Revisit when any of these become true:

- Either package goes 12+ months without a publish, or its advisory surface opens → swap the
  two seam files to SheetJS (still the named fallback).
- §11.7's payroll export is aligned to an Odoo-importable format (v2) and that format requires
  styling, named ranges, or multi-sheet structure beyond `write-excel-file`'s range.
- A second consumer outside the PMS needs general workbook manipulation → re-evaluate a single
  general engine rather than two focused ones.
- The v2 Odoo sync (§14) replaces the Excel loader entirely for import, leaving only the export
  path → re-scope to a write-only dependency.
