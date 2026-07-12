# ADR-051 — Supply-chain P1 hardening: install-time triad, license gate, provenance, exceljs→SheetJS track

**Status:** Accepted (2026-07-12, Tariq Al-Naaimi)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

The v2 libraries deep-cut (`docs/research/v2/19-libraries-deep.md`) benched the
**supply-chain health** of the current dependency tree, not just its CVE surface.
The headline finding: `npm audit` is **structurally blind** to the class of attack
that dominated 2025–26 npm. A freshly-trojanized package has **no CVE for hours**,
so a CVE scanner is the wrong _primary_ control against malicious packages. The
research cites:

- **Shai-Hulud (Sept 2025)** — the first self-propagating npm worm; 500+ packages,
  steals and republishes secrets on install [research §5, src 4/5].
- **chalk/debug maintainer-phish (Sept 8 2025)** — 18 packages, ~2B weekly
  downloads, trojanized for ~2 hours with a crypto-clipper [research §5, src 4]. A
  min-release-age cooldown would have made that 2-hour window a non-event.
- **s1ngularity / Nx (2025)** — build-tool compromise, credential exfil via a
  poisoned release [research §5, src 5].

The local scan (2026-07-11) is otherwise clean: `npm audit` → **0 vulns / 1480
deps**, and **every direct dependency is permissively licensed** (MIT / ISC /
Apache-2.0 / BSD-3 / MIT-0) with **zero AGPL / GPL-only / SSPL / BUSL / Elastic
anywhere in the shipped tree**. But "clean today" is not the invariant that matters
for a **redistributed template**: forks inherit the whole tree and are run by
non-experts, so the failure mode is a _future_ `npm install` silently pulling a
malicious version or a source-available license into a fork with no gate to catch it.

This ADR records the **P1 hardening layer beyond the P0 pins already landed** (the
exact `next-auth@5.0.0-beta.31` and `@sentry/nextjs@10.63.0` pins; the
trivy/action pinning from C11). The current posture already has: CycloneDX SBOM
(`npm run sbom`), gitleaks (hard gate), `npm audit` High+ (hard gate), trivy at
`/ship --full`, husky, and a committed `package-lock.json` with integrity hashes.
The **gaps** this ADR closes: no install-time behavioral scanning, no
min-release-age policy, no `--ignore-scripts` posture, no license-allowlist gate,
no second CVE source, no controlled update cadence, no provenance verification, and
an unmaintained Excel engine.

## Decision drivers

<!-- the forces that actually decide it -->

- **`npm audit` is blind to the 2025–26 malicious-package era.** The primary threat
  (trojanized versions with no CVE) is precisely what our existing hard gate cannot
  see. This is the most binding constraint.
- **The template is redistributed.** Forks inherit the entire dependency tree and
  are operated by non-developers — "no one will notice a license / a bad version" is
  the exact failure a gate must prevent, not a judgment call to leave to the fork.
- **Solo operator, free tier, `/ship` is the active gate.** Any control must run
  locally in `/ship` or as a free CI/app layer; nothing may assume paid CI budget or
  hand-auditing.
- **Reversibility + low disruption.** Controls should be config-only or additive
  gates that don't restructure the working scanner stack (gitleaks/npm-audit/trivy)
  or the `lib/` Ask-before surface.
- **ADR-017 alignment.** Dependency cadence must stay "in-range continuously"
  without hand-bumping, and without ingesting a version the hour it publishes.

## Considered options

### The install-time hardening triad

#### Option 1 — Socket + min-release-age cooldown + `--ignore-scripts` (chosen)

Behavioral install-time SCA (Socket, or a Socket-style scanner) as a PR gate, PLUS a
minimum-release-age / cooldown policy on dependency updates (3–7 days), PLUS an
`npm ci --ignore-scripts` posture in CI/Docker with an explicit allowlist for the
few scripts genuinely needed.

- Good, because behavioral scanning flags install scripts, network/fs access,
  obfuscation, typosquats, and sudden maintainer-behavior change — it **catches
  malicious versions `npm audit` cannot** (the Shai-Hulud / chalk class) [research
  §3 #1].
- Good, because a min-release-age cooldown is nearly free and single-handedly closes
  the "ingest the malicious version inside its short exposure window" attack — the
  ~2-hour chalk/debug window expires before the install can reach it [research §3 #2].
- Good, because `--ignore-scripts` blocks arbitrary install-time code execution — the
  worm's actual entry point — and is config-only.
- Good, because the three layers are defense-in-depth: behavioral detection + a time
  moat + execution denial cover detection, exposure, and payload independently.
- Bad, because Socket's richest tiers are commercial (free tier exists); and
  `--ignore-scripts` requires curating an allowlist for packages with legitimate
  postinstall (native bindings like `@node-rs/argon2`, `lightningcss`).

#### Option 2 — Stay on `npm audit` + gitleaks only

Keep the existing CVE + secret gates; add nothing at install time.

- Good, because zero new tooling, zero new config, no allowlist curation.
- Bad, because it leaves the **primary** 2025–26 threat completely uncovered — a
  trojanized version has no CVE for hours, so this is the wrong primary control
  against malicious packages [research §3 head-to-head]. Fails the top decision driver.
- Bad, because it offers no time moat: an install picks up a version the hour it
  publishes, inside the exposure window.

#### Option 3 — Digest-pin every dependency + fully vendor `node_modules`

Pin every dep to a content digest and commit the full dependency tree.

- Good, because a pinned digest cannot silently change; maximal reproducibility.
- Bad, because it does nothing against ingesting a _malicious pin in the first place_
  — you'd faithfully reproduce the trojaned version.
- Bad, because vendoring the tree is a heavy, high-friction burden for a
  fork-and-iterate template run by non-experts; fails the low-disruption /
  reversibility driver.

### The license-allowlist gate

#### Option 1 — License-allowlist gate wired into `/ship` (chosen)

A `/ship` phase that resolves every dependency's license and **fails RED** if any is
AGPL / SSPL / BUSL / Elastic / GPL-only (the copyleft + source-available set that is
a redistribution problem for a shipped template), via a checker such as
`license-checker-rseidelsohn` or a Syft+policy step.

- Good, because it directly protects the redistributed-template invariant — a fork
  cannot silently pull a source-available dep without tripping the gate [research §1b/§3 #8].
- Good, because it runs in the tool the operator already trusts as the release gate;
  no new human process.
- Good, because the current tree passes today (all permissive), so the gate starts
  green and only bites on a genuine future regression.
- Bad, because dual-licensed leaf packages (e.g. `jszip` = MIT OR GPL-3.0; `type-fest`
  = MIT OR CC0) require an explicit MIT-election allowlist entry so a valid permissive
  option isn't flagged; and 2 `UNKNOWN`-license leaf utils need a documented exception.

#### Option 2 — Manual license review at `/handoff` only

Review licenses once, by hand, when handing a fork to the IT team.

- Good, because no gate maintenance; nothing to curate mid-lifecycle.
- Bad, because the whole fork lifecycle (`/quickstart` → `/scale-up`) adds deps
  between forks and handoffs — a bad license lands and ships to stakeholders long
  before any `/handoff` review. Fails the redistributed-template driver.
- Bad, because it depends on a human remembering; the template's ethos is gate-not-vibe.

## Decision

**Adopt the P1 supply-chain hardening layer, in four parts, on top of the P0 pins
already landed.** The install-time-blindness and redistributed-template drivers tip
every part.

1. **Install-time hardening triad (§ install-time option 1).** Add **Socket**
   (or a Socket-style behavioral install-time scanner) as a PR gate — warn on
   findings, block on confirmed-malicious — PLUS a **minimum-release-age / cooldown
   policy** (3–7 days; via pnpm `minimumReleaseAge`, or a Socket / Renovate cooldown)
   so a version younger than the cooldown is never installed, PLUS an
   **`npm ci --ignore-scripts` posture** in CI and the Docker build, with an explicit
   allowlist for the native-binding postinstalls that genuinely need to run
   (`@node-rs/argon2`, `lightningcss`, `pg` optionals). This triad is the direct
   answer to `npm audit`'s structural blindness to the Shai-Hulud / chalk-class worm era.

2. **License-allowlist gate in `/ship` (§ license option 1).** A `/ship` phase that
   fails RED if any resolved dependency license is **AGPL / SSPL / BUSL / Elastic /
   GPL-only** — the flagged set from the research's license audit. It starts green
   (the current tree is 100% permissive: 645 MIT · 87 ISC · 29 Apache-2.0 · 18 BSD-2
   · 15 BSD-3 · 14 BlueOak · 4 MPL-2.0 · duals) and carries an election allowlist for
   the file-level weak-copyleft (MPL-2.0: `axe-core`, `lightningcss` — dev/build,
   consumed unmodified, no obligation) and the dual-licensed leaves (`jszip` MIT-elected,
   `type-fest` MIT/CC0), with the 2 `UNKNOWN`-license leaf utils noted in the SBOM.

3. **Renovate + osv-scanner + cosign/SLSA provenance.** Adopt **Renovate** for
   controlled, grouped, scheduled, min-age-gated dependency PRs — this is how ADR-017's
   "in-range continuously" is met without hand-bumping and without ingesting a
   just-published version (chosen over Dependabot for its configurable cooldown and
   self-host option). Add **osv-scanner** (Google) as a **second CVE source** emitting
   SARIF into code-scanning — diversifying beyond the GitHub-Advisory-only view of
   `npm audit`. Add **cosign (keyless) + SLSA provenance** to **verify-on-install /
   verify-on-deploy** of the release Docker image, so an unsigned or tampered artifact
   is rejected at the deploy boundary.

4. **exceljs → SheetJS migration track (record only; do NOT implement).** `exceljs`
   is **unmaintained** — no npm release in ~12 months; Snyk flags it "inactive… could
   be considered discontinued"; community forks (`@rmartin93/exceljs-fork`) spun up to
   patch **critical + security** bugs (unsafe-eval CSP, vulnerable deps) [research §2/§5,
   src 3]. It is the engine behind `lib/export.ts`. There is **no open CVE**, so this
   is not urgent — but no new export features should be built on it. We record the
   decision to **track a migration of `lib/export.ts` to SheetJS (`xlsx`, Apache-2.0,
   7.8M weekly downloads)** as a **future Ask-before change** (`lib/export.ts` is on the
   Ask-before surface per CLAUDE.md). **This ADR does not implement it** — it opens the
   track and freezes feature work on exceljs. Migration note for whoever picks it up:
   install SheetJS from the vendor CDN tarball, **not** the frozen npm `xlsx@0.18`;
   replacing exceljs also prunes the `jszip`/`pako` sub-tree.

## Consequences

### Positive

- The primary 2025–26 threat (malicious versions with no CVE) is finally covered by a
  control that can actually see it — behavioral scanning + a time moat + script denial.
- The redistributed-template license invariant becomes a gate, not a hope: a fork
  cannot silently ship an AGPL/SSPL/BUSL/Elastic dep.
- Dependency cadence is automated and cooldown-gated (Renovate), satisfying ADR-017
  without hand-bumping and without inside-the-window ingestion.
- A second CVE source (osv-scanner) removes the single-DB blind spot of `npm audit`.
- The release image gains verifiable provenance (cosign/SLSA), rejecting tampered
  artifacts at deploy.
- The unmaintained Excel engine is frozen and has a named successor; the `jszip`/`pako`
  latent-liability sub-tree has a pruning path.

### Negative

- New moving parts: Socket account/config, a cooldown policy, an `--ignore-scripts`
  allowlist to curate, a license allowlist to maintain, Renovate PRs to triage, and
  cosign keyless signing in the deploy path. Some (Socket's richer tiers) have a paid axis.
- The min-release-age cooldown deliberately delays legitimate updates by 3–7 days —
  including urgent security patches, which must have a documented fast-path override.
- `--ignore-scripts` will break any dependency with a legitimate, unlisted postinstall
  until it is allowlisted — a curation burden on native modules.
- The license gate can false-positive on dual-licensed / `UNKNOWN`-field leaves until
  the election allowlist is complete.

### Mitigations

- **Cooldown fast-path:** an explicit, adjudicated override to pull a security patch
  younger than the cooldown (logged in `docs/findings-register.md`), so the time moat
  never blocks an urgent fix.
- **Script allowlist seeded** with the known native-binding postinstalls
  (`@node-rs/argon2`, `lightningcss`, `pg` optionals); the Docker build already installs
  `--omit=dev` with platform-scoped optionals.
- **License election allowlist** documents the MPL-2.0 (unmodified, dev/build) and
  dual-license MIT elections (`jszip`, `type-fest`) up front, and notes the 2 `UNKNOWN`
  leaves in the SBOM, so the gate starts and stays green until a real regression.
- **Phase in as warn-then-block:** Socket and the license gate land as warnings first,
  flip to blocking once the allowlists are proven against a green baseline — mirroring
  how the format gate (ADR-046) was normalized once before enforcing.
- **exceljs stays frozen, not ripped out:** no `lib/export.ts` change in this ADR; the
  migration is a separate, signed-off Ask-before change with a build-vs-buy ledger entry.

## Alternatives considered

1. **`npm audit` + gitleaks only (no install-time layer)** — rejected: leaves the
   primary malicious-package threat uncovered; wrong primary control. See Considered options.
2. **Digest-pin + vendor the whole tree** — rejected: reproduces malicious pins
   faithfully and is far too heavy for a fork-and-iterate template. See Considered options.
3. **Manual license review at `/handoff` only** — rejected: bad licenses ship to
   stakeholders long before handoff; not a gate. See Considered options.
4. **Dependabot instead of Renovate** — rejected: Renovate's configurable cooldown +
   grouping + self-host fit the min-release-age posture; Dependabot's cooldown is less
   configurable [research §3 #4].
5. **Implement the SheetJS migration now** — rejected for this ADR: `lib/export.ts` is
   Ask-before, there is no open CVE, and a rushed swap of the export engine is exactly
   the kind of change that wants its own blueprint + sign-off. Tracked, not done.

## Migration triggers

Revisit / act when any of these fire:

- **exceljs → SheetJS becomes urgent:** a CVE is filed against `exceljs`, or a fork
  needs a new export format/feature — promote the tracked migration to an active
  Ask-before change (blueprint + ledger entry already staged below).
- **A dependency trips the license gate** (an AGPL/SSPL/BUSL/Elastic license resolves
  in the tree) — adjudicate: drop the dep, find a permissive alternative, or record a
  waived exception with legal sign-off.
- **A Socket / behavioral finding blocks a PR** — triage confirmed-malicious vs.
  false-positive; feeds the allowlist.
- **The cooldown blocks a security patch** — exercise the documented fast-path override.
- **CI activates** (`/handoff` to a team with Actions, Actions billing unblocks, or a
  second regular contributor — the same line that flips CI + shared tier): wire
  osv-scanner SARIF, Renovate, Harden-Runner, and cosign verify-on-deploy into the
  now-live workflows, and consider the P2 adds (Dependency-Track continuous VEX,
  Harden-Runner egress filtering).
- **Redis/Valkey or ioredis health shifts** — orthogonal but tracked in the same
  research pass (§2/§5); ioredis stays (Valkey sidesteps the Redis relicense).

## Related

- **ADR-046** (WS-7 stack bumps) — house style for a multi-item stack ADR; the
  format-gate phase-in pattern reused here for the license/Socket warn-then-block rollout.
- **ADR-017** (dependency cadence: in-range continuously; majors via quarterly
  stack-refresh) — Renovate + the min-release-age cooldown are the automation that meets it.
- **ADR-001** (locked stack) — unchanged; this ADR adds gates and a replace-track, not
  a stack swap. The exceljs→SheetJS track, when activated, is an Ask-before change.
- **ADR-020 / senior-review**, gitleaks/npm-audit/trivy gates — the existing scanner
  layer this hardening sits on top of.
- **`docs/research/v2/19-libraries-deep.md`** — the source license audit + supply-chain
  hardening top-10 + net-new shortlists this ADR records (§1 licenses, §2 maintenance,
  §3 install-time triad + top-10, §5 current-events).
- **`SECURITY.md` §12** (suppression log) — where any waived license/Socket/cooldown
  exception is recorded.
