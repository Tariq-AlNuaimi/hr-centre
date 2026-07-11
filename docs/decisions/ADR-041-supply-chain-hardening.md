# ADR-041 — Supply-chain hardening (pinned scanners, SHA-pinned Actions, SAST, sign/verify)

**Status:** Accepted (enterprise pivot, operator-directed 2026-07-11)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-007 (the local `/ship` security floor: gitleaks + npm audit)
and ADR-030 (trivy image/config scan). Extends both to the enterprise CI supply
chain.

## Context

Two 2025-26 supply-chain events change the correct defaults. Both are
point-in-time facts, cited verbatim from `docs/research/v2/enterprise-benchmark-v2.html`,
category C11:

- **Trivy was compromised 2026-03-19 (CVE-2026-33634):** weaponized
  `v0.69.4 / .5 / .6` + `latest`, with 76/77 tags repointed to a credential
  stealer and `trivy-action` poisoned. **The repo runs trivy inside `/ship` and
  `/audit`** (ADR-030) — this is a direct hit, not a hypothetical. Fix: pin
  trivy **≤ 0.69.3**, `trivy-action` **v0.35.0**, `setup-trivy` **v0.2.6**.
- **tj-actions/changed-files (CVE-2025-30066):** a popular Action was
  compromised via a mutable tag — the reason every Action must be SHA-pinned,
  not tag-pinned. A tag is a movable pointer; a commit SHA is not.

The template's security floor already scans (ADR-007 gitleaks + npm audit,
ADR-030 trivy). What it does not yet defend is the *toolchain itself* — the
scanners and Actions the CI supply chain pulls at build time. When a scanner
the repo already runs is the thing that gets compromised, "we scan" is not
enough; the tools must be pinned, immutable, and cross-checked.

## Decision drivers

- An active compromise in a scanner the repo already runs — trivy in `/ship`
  and `/audit` (P0, must close now).
- A reproducible, immutable toolchain: no mutable tags anywhere in CI.
- Defense-in-depth: no single scanner is authoritative; one tool's blind spot
  must not be the whole program's blind spot.
- Provenance for what gets deployed: sign what we build, verify on deploy.

## Considered options

### Option 1 — Pin + SHA-pin + SAST + sign/verify (chosen)

- (a) Pin trivy **≤ 0.69.3**, `trivy-action` **v0.35.0**, `setup-trivy`
  **v0.2.6** — the last known-clean line before the compromised releases.
- (b) **SHA-pin EVERY GitHub Action** to a full 40-char commit SHA, with
  **zizmor** auditing workflows to flag any un-pinned or vulnerable Action —
  making a mutable ref a CI failure rather than a latent risk.
- (c) Add **SAST** — a Semgrep/Opengrep ruleset — as a hard blocking gate,
  activating the dormant `sast.yml`.
- (d) P1 depth: **Syft** image SBOM + **Grype** as a second, independent
  scanner + **Socket** behavioral install-time gate + **Renovate** to keep
  pinned dependencies current.
- (e) **cosign** signing + **SLSA** provenance, verified on deploy.
- Suppressions logged in SECURITY.md §12 — never silent.
- Good: closes the active hole and adds defense-in-depth across scan, SAST, and
  provenance. Bad: more CI surface to maintain.

### Option 2 — Trust floating `latest` / mutable tags

Keep pulling `latest` trivy and tag-pinned Actions. Bad: this is the exact
vector that compromised trivy (`latest` + repointed tags) and tj-actions (a
mutable tag). Rejected — it is the disease, not a treatment.

### Option 3 — Single scanner only

Rely on trivy alone as the authoritative scanner. Bad: one tool's blind spots
become the whole program's blind spots, and trivy's own compromise is the proof
— when the single scanner is the thing that fails, there is no second opinion.
Rejected in favor of a second scanner (Grype).

## Decision

Adopt Option 1. The deciding driver is the **active Trivy compromise**: a
scanner the repo already runs was weaponized, which forces immediate pinning to
the last clean line (trivy ≤ 0.69.3 / trivy-action v0.35.0 / setup-trivy
v0.2.6). The *same class of failure* — trusting a mutable ref — is what
compromised tj-actions, so the response generalizes: SHA-pin every Action to a
full commit SHA (zizmor enforces it) and stop trusting any single tool by adding
a second, independent scanner. Immediate (P0): the trivy pin, Action SHA-pinning,
and SAST turned on (`sast.yml` promoted from dormant to a hard blocking gate).
P1 (as the enterprise CI floor lands): Syft SBOM + Grype second scanner + Socket
install-time gate + Renovate, then cosign signing and SLSA provenance verified
on deploy. Every suppression is logged in SECURITY.md §12.

## Consequences

### Positive

- The active trivy compromise is closed at the pin; `/ship` and `/audit` no
  longer pull a poisoned scanner.
- No mutable refs anywhere in CI — builds are reproducible and immutable, and an
  un-pinned Action fails the build instead of silently drifting.
- Defense-in-depth: trivy + Grype cross-check each other, SAST covers code-level
  findings, and cosign/SLSA give provenance for what deploys.

### Negative

- More CI surface: additional scanners, a SAST gate, and signing steps add
  build time and maintenance.
- SHA-pins are opaque to read and rot over time as upstreams release.
- A second scanner (Grype) will raise findings that need triage through the
  register like any other gate.

### Mitigations

- **Renovate** keeps SHA-pins current so pinning does not rot — pins stay fresh
  without hand-editing 40-char hashes.
- **zizmor** makes an un-pinned or vulnerable Action a CI failure, so drift is
  caught mechanically, not by review vigilance.
- P1 scanners land with the enterprise CI floor, not the fast local `/ship`
  loop, so day-to-day iteration speed is preserved.
- Suppressions are adjudicated in SECURITY.md §12 — never silently dropped.

## Alternatives considered

- **Floating `latest` / mutable tags** — the exact compromise vector; rejected.
- **Single scanner only** — one tool's blind spot becomes the program's;
  rejected for trivy + Grype.
- **SAST advisory-only (non-blocking)** — findings that don't block get ignored;
  rejected in favor of a hard gate.

## Migration triggers

- Revisit the trivy pin (≤ 0.69.3) once a clean post-incident release line is
  verified — lift the ceiling to the first release the vendor confirms clean.
- Add scanners as new classes of finding emerge (e.g. IaC, container-runtime,
  license) rather than front-loading tools the current threat model doesn't
  need.
- Revisit SHA-pin ergonomics if Renovate churn on pins becomes noisy.

## Related

- ADR-007 — the local `/ship` security floor (gitleaks + npm audit) this extends.
- ADR-030 — trivy image/config scan (the direct hit; pin lands here).
- ADR-035, ADR-037 — the enterprise CI floor this hardening rides on.
- SECURITY.md §12 — suppression register (all waivers logged here).
- `docs/research/v2/11-supplychain-security.md` — supply-chain benchmark detail.
- `docs/research/v2/13-cicd-tooling.md` — CI/CD tooling benchmark detail.
