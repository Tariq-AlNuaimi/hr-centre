# ADR-050 — CI supply-chain blast-radius hardening (SHA-pin + zizmor gate, Harden-Runner egress, dormant-gate promotion at handoff)

**Status:** Proposed
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Relates to:** ADR-041 (supply-chain hardening — the scanner-pin + SHA-pin + SAST +
sign/verify decision this layers a blast-radius-containment posture on top of),
ADR-030/ADR-035 (Docker-first delivery — the image that gets signed/verified),
ADR-006 (Vercel + Neon as the default deploy path — unchanged), ADR-007 (the local
`/ship` security floor — image-free, unchanged), ADR-037 (the enterprise CI floor
this activation model rides on).

## Context

The v2 supply-chain benchmark (`docs/research/v2/11-supplychain-security.md` §"Which
become HARD CI gates", `docs/research/v2/19-libraries-deep.md` §3 top-10) named a
class of risk ADR-041 opened but did not fully close: **even a correctly-pinned CI
still has a blast radius.** ADR-041 pinned the scanners (trivy ≤ 0.69.3 after the
2026-03 compromise, CVE-2026-33634) and mandated SHA-pinning with zizmor, but the
_containment_ posture — what a compromised build step can still reach, and how the
pinning mandate is mechanically enforced and activated — was left as P1 prose. Three
gaps remain:

1. **The SHA-pin mandate has no enforcing gate wired as a CI-lint that fails the
   build.** ADR-041 says "SHA-pin every Action; zizmor enforces it," but a mandate
   without a failing check is a convention. The **tj-actions/changed-files compromise
   (CVE-2025-30066, 2025-03)** repointed 350+ mutable tags across 23,000+ repos and
   dumped CI secrets — the direct proof that a mutable `@v4` ref is an attacker-movable
   pointer. zizmor also flags **dangerous triggers** (`pull_request_target` with a
   checkout of untrusted head) — and a misconfigured `pull_request_target` leaking a
   PAT was the _root cause_ of the trivy compromise itself. The gate must fail on both
   unpinned actions AND dangerous triggers, not merely advise.

2. **A compromised build step can still exfiltrate.** Every 2025-26 attack in the
   research — **Shai-Hulud** (Sept 2025, first self-propagating npm worm, 500+ packages,
   steals + republishes secrets), the **chalk/debug maintainer-phish** (Sept 8 2025, 18
   packages / ~2B weekly downloads, trojanized for ~2h), **s1ngularity/Nx** (2025,
   credential exfil via poisoned release) — shares one terminal step: **egress to an
   attacker endpoint** carrying CI secrets, cloud creds, or tokens. Pinning reduces the
   chance of ingesting a bad step; it does nothing to cap what a bad step that slips
   through can _send_. The runner needs an egress policy.

3. **The lifecycle security gates are dormant, and their promotion to HARD CI checks
   is undocumented.** The scanners run locally in `/ship`/`/audit` today (image-free,
   fast — ADR-007), and the CI workflows (`sast.yml`, `secrets-scan.yml`, `codeql.yml`,
   `docker-build.yml`, `release.yml`, `verify.yml`) are all **DORMANT** —
   `workflow_dispatch`-only so they don't fail-in-2s on the billing-blocked free plan.
   There is no recorded contract for _which_ gates become blocking, and on _what_
   trigger, when Actions turns on. Without that contract, "activate CI" is a guess.

This ADR governs the **CI tier only**. The fast local `/ship` loop stays image-free and
unchanged (ADR-007); nothing here adds a phase to the ~55s warm local gate.

## Decision drivers

- **Blast-radius containment, not just ingestion prevention.** Pinning lowers the odds
  of pulling a poisoned step; it does not bound what a poisoned step can exfiltrate. The
  research's #5 (Harden-Runner) addresses exactly the gap #6 (SHA-pin) leaves open.
- **Enforce mechanically, not by review vigilance.** A SHA-pin mandate that isn't a
  failing gate rots the first time someone pastes a `@v4` from a README.
- **A recorded activation contract.** The dormant→blocking transition must be written
  down (which gate, which trigger, at what lifecycle event) so activating CI at handoff
  is deterministic, not archaeology.
- **Zero cost to the local loop and to the Vercel build.** This is a CI-tier decision;
  the image-free `/ship` gate (ADR-007) and the byte-for-byte Vercel build (ADR-006/030)
  must be untouched.

## Considered options

### Option 1 — SHA-pin + zizmor CI-lint gate + Harden-Runner egress (chosen)

Pin every third-party Action to a full 40-char commit SHA; make **zizmor** a CI-lint
gate that **fails the build** on any unpinned action or dangerous trigger; run
**StepSecurity Harden-Runner** on CI jobs to audit and block runner egress; and record
the dormant→blocking promotion contract for the lifecycle gates (gitleaks, npm audit,
pinned trivy, SAST, cosign/SLSA verify-on-deploy) at handoff.

- Good, because it closes the containment gap ADR-041's pinning leaves open — a
  compromised step (Shai-Hulud / chalk-class) can't exfiltrate past an egress-blocked
  runner, capping blast radius even when ingestion prevention fails.
- Good, because zizmor-as-gate converts the SHA-pin _mandate_ into a mechanical failure
  (the tj-actions/CVE-2025-30066 vector becomes a red build, not a latent risk), and it
  catches the `pull_request_target` misconfig that was the trivy compromise's own root
  cause.
- Good, because the recorded activation contract makes "turn CI on at handoff"
  deterministic — each dormant workflow states its blocking trigger.
- Bad, because Harden-Runner's egress allowlist needs an initial audit-mode pass to
  enumerate legitimate destinations, and a too-tight policy can break a build until the
  allowlist is tuned.
- Bad, because it adds CI-tier surface (one more action to keep SHA-pinned, one more
  lint gate to keep green) — though none of it touches the local loop.

### Option 2 — Trust marketplace tags, rely on scanning to catch a bad version

Keep referencing Actions by mutable tag (`uses: actions/checkout@v4`) and lean on the
existing scanners to notice if something goes wrong.

- Good, because it's the lowest-effort status quo — tags read cleanly and auto-adopt
  patch releases.
- Bad, because a mutable tag is an attacker-movable pointer: this is precisely the
  tj-actions/changed-files vector (CVE-2025-30066) and the trivy `latest`/repointed-tag
  vector (CVE-2026-33634) — it is the disease, not a treatment. Fails the
  "enforce mechanically" and "blast-radius containment" drivers outright.
- Bad, because CVE scanning is structurally blind to a freshly-trojanized version — a
  poisoned `chalk` had no CVE for the ~2h exposure window; scanning-after-the-fact does
  not cap egress during it.

### Option 3 — Vendor (fork/copy) all third-party Actions in-repo

Copy every third-party Action's source into the repo and reference the local copy, so
nothing is pulled from the marketplace at build time.

- Good, because it removes the external-fetch supply chain entirely — the build depends
  only on in-repo code.
- Bad, because it transfers the entire maintenance + security-patch burden onto the
  operator: every upstream security fix must be manually re-vendored, and a stale vendored
  Action silently misses patches — trading a pinning problem for a worse patch-lag problem.
- Bad, because it's disproportionate for a non-developer-operated template whose forks
  inherit the whole tree; SHA-pin + Renovate (ADR-041) keeps pins _both_ immutable and
  current at a fraction of the cost, and Harden-Runner still contains whatever is pulled.

## Decision

Adopt **Option 1**. The deciding driver is **blast-radius containment**: ADR-041 already
chose the pins and the SHA-pin mandate, but pinning is an _ingestion_ control — it lowers
the chance of pulling a poisoned step and does nothing to bound what a step that slips
through can send. Harden-Runner's runner-egress policy is the containment layer that caps
exactly that, and it is the one control in the research (§3 #5) that directly blunts the
terminal exfiltration step shared by Shai-Hulud, the chalk/debug phish, and s1ngularity/Nx.
Paired with it, **zizmor is promoted from ADR-041's "enforcer" prose to a wired CI-lint
gate that fails the build** on any unpinned action or dangerous trigger — turning the
SHA-pin mandate (the tj-actions/CVE-2025-30066 lesson) into a mechanical red build and
catching the `pull_request_target` misconfiguration class that was the trivy compromise's
own root cause.

The **lifecycle gates are promoted to HARD CI checks at handoff** on this contract:
**gitleaks** (secret scan) and **npm audit** (High+, adjudicated allowlist) become
blocking PR gates; **trivy** (pinned ≤ 0.69.3 per ADR-041, image + config) is promoted
from `/ship --full`-only to a blocking PR gate; **SAST** (Semgrep/Opengrep, activating
the dormant `sast.yml`) becomes a blocking gate; **cosign signature + SLSA provenance
verification** becomes a blocking **verify-on-deploy** gate that rejects an unsigned or
mismatched image. Each currently-dormant workflow (`workflow_dispatch`-only today so it
does not fail-in-2s on the billing-blocked free plan) records the trigger it restores at
activation.

This is a **CI-tier decision**. The fast local `/ship` loop stays image-free and
unchanged (ADR-007); the Vercel build stays byte-for-byte untouched (ADR-006/030).
Implementation (editing the workflow files) is a later wave — this ADR is the decision of
record; **no workflow files are changed here.** Every suppression is logged in
SECURITY.md §12, adjudicated in `docs/findings-register.md` — never silent.

## Consequences

### Positive

- A compromised build step (Shai-Hulud / chalk-class malicious version) **cannot
  exfiltrate** past an egress-blocked runner — blast radius is bounded even when
  ingestion prevention fails, closing the gap ADR-041's pinning left open.
- The SHA-pin mandate is now a **failing gate**: an unpinned `@v` ref or a dangerous
  `pull_request_target` is a red build (zizmor), not a latent risk — the tj-actions
  (CVE-2025-30066) and trivy-root-cause vectors are caught mechanically.
- **Deterministic CI activation:** the dormant→blocking promotion contract names each
  gate and its trigger, so turning CI on at handoff is a checklist, not archaeology.
- The local loop and the Vercel build are untouched — day-to-day iteration speed and
  deploy path are preserved.

### Negative

- Harden-Runner's egress allowlist requires an initial audit-mode pass to enumerate
  legitimate destinations; a mis-tuned policy can break a build until tuned.
- More CI-tier surface: one more action to keep SHA-pinned (Harden-Runner itself), one
  more lint gate (zizmor) to keep green, and blocking gates that will raise findings
  needing triage through the register.
- SHA-pins are opaque to read and rot as upstreams release (shared with ADR-041).

### Mitigations

- **Run Harden-Runner in `audit` mode first** to enumerate the real egress set, then
  switch to `block` once the allowlist is proven — the policy is derived from observed
  traffic, not guessed.
- **Renovate** (ADR-041) keeps every SHA-pin — including Harden-Runner's and zizmor's —
  current, so pinning does not rot without hand-editing 40-char hashes.
- **zizmor** makes an unpinned or dangerous-trigger workflow a CI failure, so drift is
  caught by the gate, not by review vigilance.
- All of this lands on the **CI tier at handoff**, not the fast local `/ship` loop, so
  iteration speed is preserved; suppressions are adjudicated in SECURITY.md §12 /
  `docs/findings-register.md`, never silently dropped.

## Alternatives considered

1. **Trust marketplace tags + rely on scanning** — a mutable tag is the exact
   tj-actions / trivy compromise vector, and CVE scanning is blind to a freshly-trojanized
   version during its exposure window; rejected.
2. **Vendor all Actions in-repo** — removes the external fetch but transfers the entire
   security-patch burden onto the operator and rots silently; disproportionate versus
   SHA-pin + Renovate + Harden-Runner. Rejected. (See Considered options.)

## Migration triggers

- **CI activation is the trigger for this whole ADR.** It stays dormant/advisory until
  the FIRST of: (a) `/handoff` to a team with GitHub Actions, (b) Actions billing
  unblocking on the current account, or (c) a second regular contributor (the same line
  that flips tier `personal`→`shared`). At that event, wire the zizmor gate + Harden-Runner
  and restore each dormant workflow's blocking trigger per the promotion contract.
- **Revisit the trivy pin ceiling** (≤ 0.69.3, ADR-041) once a clean post-incident
  release line is vendor-confirmed — lift to the first confirmed-clean release.
- **Tighten Harden-Runner from audit→block** once the egress allowlist is proven stable
  over a handful of green runs; revisit the allowlist when a new legitimate destination
  (new registry, new SaaS gate) is added to CI.
- **Revisit if a runner-native egress control ships upstream** (GitHub-hosted egress
  policy) that subsumes Harden-Runner — prefer the platform-native control if it reaches
  parity.

## Related

- ADR-041 — supply-chain hardening (scanner pins, SHA-pin mandate, zizmor, SAST,
  cosign/SLSA); this ADR wires zizmor as a failing gate, adds the Harden-Runner
  containment layer, and records the dormant→blocking activation contract on top of it.
- ADR-030 / ADR-035 — Docker as a mandatory build artifact; the image cosign signs and
  verify-on-deploy checks. ADR-006 — Vercel + Neon default deploy path (unchanged).
- ADR-007 — the image-free local `/ship` security floor (gitleaks + npm audit), unchanged
  by this CI-tier decision.
- ADR-037 — the enterprise CI floor this activation model rides on.
- `docs/research/v2/11-supplychain-security.md` — §"Which become HARD CI gates for
  enterprise" (the blocking-gate list) + the Trivy CVE-2026-33634 / tj-actions
  CVE-2025-30066 detail.
- `docs/research/v2/19-libraries-deep.md` — §3 top-10 hardening controls (#5
  Harden-Runner, #6 SHA-pin + zizmor) and §5 current-events catches (Shai-Hulud,
  chalk/debug phish, s1ngularity/Nx).
- SECURITY.md §12 — suppression register (all waivers logged here);
  `docs/findings-register.md` — adjudication of any waived gate.
- `.github/workflows/` — the dormant workflows (`sast.yml`, `secrets-scan.yml`,
  `codeql.yml`, `docker-build.yml`, `release.yml`, `verify.yml`) this contract promotes.
