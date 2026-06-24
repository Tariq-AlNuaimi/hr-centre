---
name: audit
description: On-demand security scan of a target path -- gitleaks (secrets) + npm audit (dependency CVEs) + Semgrep (SAST). Mirrors the dormant CI security workflows so they run locally on any machine. Use before sharing anything externally, and as the FIRST step of /conform on foreign code. Trigger phrases: "audit", "security scan", "/audit", "scan this for secrets", "is this safe to share".
---

# /audit — On-demand security scan

The CI security workflows (`secrets-scan.yml` = gitleaks, `sast.yml` = Semgrep, the
`npm audit` step inside `verify.yml`) do **not** run on the free GitHub plan. `/audit`
runs the same three scans locally, on any machine, against a target path.

Two uses:
1. **Manual** — run it before sharing a project externally or before a handoff.
2. **Inside `/conform`** — it is the mandatory FIRST step on incoming foreign code.
   **Never trust foreign code; scan it before reading or running anything.**

`/audit` **reports**. It does not fix. (On foreign code, fixing only happens later in
`/conform`, with explicit per-change operator approval.)

## Input

A target path. Defaults to the repo root (`.`). For `/conform`, the path is the folder
the operator dropped foreign code into.

## Steps (run all three; report everything; do not stop early)

1. **Secrets — gitleaks.**
   - `gitleaks detect --source <path> --no-banner --redact` (this repo ships
     `.gitleaks.toml`; gitleaks extends the default ruleset).
   - **Scanning a sub-path:** both forms work — `gitleaks detect --source <path>`,
     or `cd <path> && gitleaks detect`. Pick whichever keeps the `file:line` paths
     readable for the report.
   - Reports any committed/embedded secret with `file:line` (redacted value).

2. **Dependency CVEs — npm audit.**
   - If `<path>` has a `package.json`: `npm audit --audit-level=high --omit=dev`
     (run with `--prefix <path>` or from inside it). Surfaces High+ CVEs in
     production dependencies.
   - **No lockfile?** `npm audit` cannot resolve the tree. Do **not** treat this as
     a failure — report it as `NOT RUN: no lockfile (run npm install first)` and
     recommend `npm install` so the tree is resolvable, then it can be re-run.

3. **SAST — Semgrep.**
   - `semgrep --config p/javascript --config p/typescript --config p/nextjs --config p/react --config p/owasp-top-ten --config p/secrets <path>`
     (the exact rulesets `sast.yml` uses).
   - **No local semgrep binary?** Run it via Docker — volume-mount the target path
     and point `--config` at the mount, e.g.
     `docker run --rm -v "$PWD:/src" semgrep/semgrep semgrep --config auto /src`
     (swap `--config auto` for the explicit `p/*` rulesets above to mirror `sast.yml`).
   - Reports findings with `file:line` and rule id.

## If a tool is not installed

**Do NOT silently skip.** Report which scan could not run and how to enable it, and
make clear the audit is **incomplete** until it can:

- **gitleaks** — macOS: `brew install gitleaks`; else download from
  https://github.com/gitleaks/gitleaks/releases
- **semgrep** — `pip install semgrep` or `brew install semgrep`, or run the
  `semgrep/semgrep` Docker image
- **npm** — ships with Node; if missing, install Node.

## Output

A single report, grouped by scanner, each finding line-referenced and severity-tagged:

```
/audit report — <path>
  Secrets (gitleaks):   <n findings | clean | NOT RUN: install gitleaks>
  Dependencies (npm):   <n High+ CVEs | clean | NOT RUN: no lockfile / npm missing>
  SAST (semgrep):       <n findings | clean | NOT RUN: install semgrep>

  <per-finding: file:line — rule — one-line description>
```

Then a one-line verdict: **clean / findings to review / could not complete (tool missing)**.

## Do NOT in this skill

- Do **not** fix anything. `/audit` is report-only. Fixes on foreign code go through
  `/conform`'s approval gate; fixes on this repo go through normal edits + `/ship`.
- Do **not** mark a target "clean" if any scanner could not run — say "incomplete."
- Do **not** run foreign code to test it as part of auditing it.
