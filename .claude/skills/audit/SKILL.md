---
name: audit
description: On-demand security scan of a target path -- gitleaks (secrets) + npm audit (dependency CVEs) + Semgrep (SAST), plus optional deeper layers (osv-scanner lockfile-vs-OSV, trufflehog live-verified secrets, trivy image/config). Mirrors the dormant CI security workflows so they run locally on any machine. Use before sharing anything externally, and as the FIRST step of /conform on foreign code. Trigger phrases: "audit", "security scan", "/audit", "scan this for secrets", "is this safe to share".
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
   - **Bootstrap first (P-11).** If `semgrep` isn't on `PATH`, self-install before
     falling back to Docker — `pipx` is the cleanest (isolated venv, no global
     pollution), with `pip --user` as a fallback:
     `command -v semgrep >/dev/null || pipx install semgrep || pip install --user semgrep`
     (pypi.org is reachable in the Claude Code web sandbox's egress allowlist, so the
     _install_ succeeds; `~/.local/bin` must be on `PATH`). This removes the "SAST leg
     silently absent" gap the harness trials hit — only reach for the Docker image if the
     install itself is blocked. **Known container caveat:** in some base images (incl. this
     one) semgrep installs but crashes at runtime on a broken system `cryptography`/pyo3
     binding (`_cffi_backend` missing → `PanicException`); that's a base-image defect a
     `pip` bootstrap can't fix — fall back to the `semgrep/semgrep` Docker image there.
   - `semgrep --config p/javascript --config p/typescript --config p/nextjs --config p/react --config p/owasp-top-ten --config p/secrets <path>`
     (the exact rulesets `sast.yml` uses).
   - **Still no semgrep (install blocked)?** Run it via Docker — volume-mount the target
     path and point `--config` at the mount, e.g.
     `docker run --rm -v "$PWD:/src" semgrep/semgrep semgrep --config auto /src`
     (swap `--config auto` for the explicit `p/*` rulesets above to mirror `sast.yml`).
   - Reports findings with `file:line` and rule id.

4. **Dependency CVEs (deeper) — osv-scanner (OPTIONAL pass; V2-407).**
   - `npm audit` (step 2) checks npm's own advisory DB, npm-only. `osv-scanner` checks the
     **lockfile directly against Google's OSV database** (broader coverage, and it scans any
     manifest a fork adds — not just npm): `osv-scanner scan source --lockfile <path>/package-lock.json`
     (or `osv-scanner scan --recursive <path>` to sweep every manifest under the path). It
     COMPLEMENTS npm audit, it doesn't replace it — run both.
   - **Bootstrap first (self-install, like gitleaks — NEVER an npm dependency).** If `osv-scanner`
     isn't on `PATH`, install the Go binary before skipping:
     `command -v osv-scanner >/dev/null || GOBIN=$HOME/.local/bin GOTOOLCHAIN=auto go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest`
     (`~/.local/bin` must be on `PATH`; the release binary from
     https://github.com/google/osv-scanner/releases is the no-Go fallback).
   - **Not installed / no Go → skip WITH a note** (optional layer, like trufflehog/trivy):
     `osv-scanner: NOT RUN (optional; go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest, or a release binary)`.
     A missing osv-scanner does **not** make the audit incomplete.
   - **Needs egress** to the OSV database (`api.osv.dev`) to resolve advisories; if egress is
     blocked, report `NOT RUN: egress blocked` rather than trusting an empty result.

5. **Live-verified secrets — trufflehog (OPTIONAL pass; Wave A2, ADOPT 10-security).**
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

6. **Container image + config — trivy (OPTIONAL pass; Wave A2, ADOPT 10-security; ADR-030).**
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
- **semgrep** — `pipx install semgrep` (preferred; isolated venv), or
  `pip install --user semgrep` / `brew install semgrep`, or run the
  `semgrep/semgrep` Docker image (the SAST step above self-bootstraps via `pipx` first)
- **npm** — ships with Node; if missing, install Node.

## Output

A single report, grouped by scanner, each finding line-referenced and severity-tagged:

```
/audit report — <path>
  Secrets (gitleaks):    <n findings | clean | NOT RUN: install gitleaks>
  Dependencies (npm):    <n High+ CVEs | clean | NOT RUN: no lockfile / npm missing>
  Dependencies (osv):    <n vulns | clean | NOT RUN (optional) | NOT RUN: egress blocked>
  SAST (semgrep):        <n findings | clean | NOT RUN: install semgrep>
  Verified (trufflehog): <n LIVE creds — ROTATE | clean | NOT RUN (optional)>
  Container (trivy):     <n HIGH/CRITICAL image+config | clean | NOT RUN (optional)>

  <per-finding: file:line — rule — one-line description>
```

Then a one-line verdict: **clean / findings to review / could not complete (tool missing)**.

## CI slot evaluation — `anthropics/claude-code-security-review` (V2-407, deferred)

Evaluated for the **dormant CI security slot** (alongside `secrets-scan.yml` / `sast.yml`):
`anthropics/claude-code-security-review` is an AI-diff security reviewer (a GitHub Action that reasons
over a PR diff for logic/authz/injection flaws the deterministic scanners miss). Verdict: **valuable
and complementary, but deferred to CI activation** — it needs `ANTHROPIC_API_KEY` + Actions billing
(the same trigger that activates `/ship`'s CI and the `senior-code-reviewer` workflow), and it is a
_diff_ reviewer, not a local-path scanner, so it doesn't fit `/audit`'s "scan any folder offline"
model. Wire it into the CI security workflows when the CI-activation trigger fires (ADR-020 /
`docs/rules/harness.md`); until then the local scanners above are the coverage.

## Do NOT in this skill

- Do **not** fix anything. `/audit` is report-only. Fixes on foreign code go through
  `/conform`'s approval gate; fixes on this repo go through normal edits + `/ship`.
- Do **not** mark a target "clean" if any of the three CORE scanners could not run —
  say "incomplete." (A skipped optional trufflehog pass does not block "clean"; note
  it as NOT RUN.)
- Do **not** run foreign code to test it as part of auditing it.

## Verification

Before calling this done:

- [ ] All three core scanners (gitleaks, npm audit, Semgrep) either ran or are
      reported `NOT RUN: <reason>` — none silently skipped
- [ ] Every finding is line-referenced (`file:line`) and severity-tagged
- [ ] The report ends with an explicit verdict: clean / findings to review /
      incomplete
- [ ] Any accepted suppression is logged in `SECURITY.md` §12, not just noted in chat

**Emits:** the scan report output; any suppression logged in `SECURITY.md` §12.
