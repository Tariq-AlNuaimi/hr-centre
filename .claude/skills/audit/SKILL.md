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

4. **Live-verified secrets — trufflehog (OPTIONAL pass; Wave A2, ADOPT 10-security).**
   - `trufflehog git file://<path> --only-verified --fail` (git history), and/or
     `trufflehog filesystem <path> --only-verified --fail` (working tree).
   - `--only-verified` calls the provider API to confirm a candidate credential is
     **live right now** — near-zero false positives. It COMPLEMENTS gitleaks (step 1
     tells you "this looks like a key"; this pass tells you "this key still works"),
     so run gitleaks regardless.
   - Any verified finding is a **rotate-now incident** (SECURITY.md §8), not just a
     report line.
   - **Not installed → skip WITH a note** (external binary, like gitleaks; never add
     it as an npm dependency): report `trufflehog: NOT RUN (optional; brew install
     trufflehog, or https://github.com/trufflesecurity/trufflehog/releases)`. Unlike
     the three core scans, a missing trufflehog does **not** make the audit
     incomplete — it is an optional verification layer on top of them.
   - Needs egress to the credential providers' APIs to verify; if egress is blocked,
     report `NOT RUN: egress blocked` rather than trusting an empty result.

5. **Container image + config — trivy (OPTIONAL pass; Wave A2, ADOPT 10-security; ADR-030).**
   - A standard build artifact is a **scanned** artifact (ADR-030): scan both the
     image and the IaC/Dockerfile.
   - **Image** (if a Docker image is available or buildable): `trivy image
     --severity HIGH,CRITICAL <tag>` — scans OS + language dependency layers for
     known CVEs. Build it first with `make docker-build` (tag `app:local`) if no
     tag exists yet.
   - **Config**: `trivy config --severity HIGH,CRITICAL <path>` — scans the
     Dockerfile / compose / any IaC for misconfigurations (root user, missing
     healthcheck, etc.).
   - **Not installed → skip WITH a note** (external binary, like gitleaks/trufflehog;
     never an npm dependency): report `trivy: NOT RUN (optional; brew install trivy,
     or https://github.com/aquasecurity/trivy/releases)`. A missing trivy does **not**
     make the audit incomplete — it is an optional layer on top of the three core scans.
   - This is the SAME scan the `/ship --full` docker phase runs (ADR-030); running it
     here lets you scan before an image is wired into the full gate.

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
  Verified (trufflehog): <n LIVE creds — ROTATE | clean | NOT RUN (optional)>
  Container (trivy):    <n HIGH/CRITICAL image+config | clean | NOT RUN (optional)>

  <per-finding: file:line — rule — one-line description>
```

Then a one-line verdict: **clean / findings to review / could not complete (tool missing)**.

## Do NOT in this skill

- Do **not** fix anything. `/audit` is report-only. Fixes on foreign code go through
  `/conform`'s approval gate; fixes on this repo go through normal edits + `/ship`.
- Do **not** mark a target "clean" if any of the three CORE scanners could not run —
  say "incomplete." (A skipped optional trufflehog pass does not block "clean"; note
  it as NOT RUN.)
- Do **not** run foreign code to test it as part of auditing it.
