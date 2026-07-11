# C11 — Supply chain & security scanning

> Enterprise benchmark v2, exhaustive 4-lens pass. Ground truth = `package.json` + `scripts/ship.mjs`, not CLAUDE.md.
> Current gates in the repo: **gitleaks** (secret scan, phase B, hard-fail), **npm audit** (`--json --audit-level=high --omit=dev` + `audit-allowlist.json`, hard-fail), **trivy** image+config scan (`/ship --full` only, WARN/triage), **@cyclonedx/cyclonedx-npm** (SBOM, on-demand `npm run sbom`), **husky** (hooks). No SAST, no signing/provenance yet.
> Lens tags: `BT`=battle-tested · `HS`=highest-star/most-popular · `ENT`=enterprise-grade · `OSS`=best pure open-source.
> Star counts are point-in-time (as-of 2026-07); treat as approximate where the registry page wasn't scraped directly.

**Current-events headline (read first):** The **Trivy ecosystem was supply-chain-compromised on 2026-03-19** (CVE-2026-33634 / GHSA-69fq-xp46-6x23) — weaponized binaries `v0.69.4/.5/.6` + `latest` across GitHub Releases, GHCR, Docker Hub, ECR, deb/rpm and `get.trivy.dev`; **76 of 77 release tags retroactively repointed** to a credential stealer; `trivy-action` poisoned. This repo runs trivy **inside CI/`/ship`**, exactly the blast radius the attack targeted (CI secrets, cloud creds, K8s tokens). **Remediation + pinning guidance is in the Container-scan block below and is P0.**

---

### Secret scanning — gitleaks (current) vs trufflehog vs GitHub secret-scanning

**One line:** Pre-commit/CI secret detection. **Current: gitleaks** (MIT, phase-B hard-fail in `/ship`; `/audit` also runs a trufflehog pass per `ship.mjs:634`).

| # | Candidate | Lens | Stars (2026-07) | License | Maturity | Why it ranks |
|---|-----------|------|-----------------|---------|----------|--------------|
| 1 | **gitleaks** | BT·HS·OSS | ~26k [1] | MIT | 2018, stable | Fast regex/entropy, single Go binary, ideal pre-commit + CI gate; MIT (no copyleft trap) |
| 2 | **TruffleHog v3** | BT·HS·OSS | ~25.7k [1] | AGPL-3.0 | mature | **Credential *verification*** (live-tests the key) + 800+ detectors, scans S3/Docker/Slack; ~94% active-cred detection vs gitleaks 71%/86% tuned [1] |
| 3 | **GitHub secret scanning + push protection** | ENT·BT | n/a (SaaS) | GitHub (GHAS) | GA | Blocks the push server-side, partner-verified providers, org-wide dashboards; needs GHAS/paid or public repo |
| 4 | **Semgrep Secrets** | ENT | (part of Semgrep) | commercial | 2023+ | Validation + entropy in the same platform as SAST; paid |
| 5 | **detect-secrets (Yelp)** | OSS | ~4k | Apache-2.0 | mature | Baseline-file workflow, plugin arch; weaker verification |
| 6 | **Aikido / Socket / Puaro (SaaS)** | ENT | n/a | commercial | 2024+ | Managed secret+SCA; lower FP claims; lock-in |
| 7 | **git-secrets (AWS)** | BT·OSS | ~12k | Apache-2.0 | legacy | AWS-key-focused, minimal, largely superseded |

**Head-to-head:** gitleaks wins the **pre-commit gate** — millisecond regex scan, MIT, zero infra — which is precisely how this repo uses it. TruffleHog wins **depth**: it *verifies* whether a leaked key is still live (the 94% vs 71% gap) and scans non-git surfaces, but its **AGPL-3.0** license is a distribution/embedding consideration for an enterprise product (fine to run as an external CLI, riskier to vendor into shipped code). GitHub secret-scanning **push-protection** is the only one that stops the secret *before it reaches the remote* — but it's server-side GHAS and this repo's CI is dormant on the free plan. The mature pattern (and what appsec teams do) is **both**: gitleaks pre-commit for speed, trufflehog in CI for verified depth.

**Recommendation: KEEP+HARDEN.** Keep gitleaks as the `/ship` hard gate. **Add trufflehog's *verified* scan as a CI step** (already the `/audit` tool — promote it to a gate on push/PR) so a leaked key is caught *and* confirmed-live before it spreads. At `/handoff` to a GHAS-enabled org, **turn on GitHub push protection** (server-side, org-wide). **Fit 5/5.** ADR impact: extend the security-workflow ADR to name trufflehog-verify as the CI depth layer + push-protection at handoff.

---

### SBOM — CycloneDX `@cyclonedx/cyclonedx-npm` (current) vs Syft/SPDX

**One line:** Machine-readable bill-of-materials for the dependency tree. **Current: `@cyclonedx/cyclonedx-npm` v5** (`npm run sbom` → CycloneDX JSON, `--omit dev`).

| # | Candidate | Lens | Stars (2026-07) | License | Maturity | Why it ranks |
|---|-----------|------|-----------------|---------|----------|--------------|
| 1 | **@cyclonedx/cyclonedx-npm** | BT·OSS | (OWASP org) | Apache-2.0 | stable | Reads the npm resolver directly → **most accurate JS dep graph**; CycloneDX is the appsec-native format (VEX, npm metadata) [2] |
| 2 | **Syft (Anchore)** | BT·HS·OSS | ~8.4k [2] | Apache-2.0 | mature | Single binary, 40+ ecosystems, emits **both** CycloneDX + SPDX; scans image/dir/repo — pairs with Grype |
| 3 | **Trivy SBOM** | BT·OSS | ~28k | Apache-2.0 | mature | `trivy sbom` from image/fs; one-tool story — **but see Trivy compromise** |
| 4 | **cdxgen (CycloneDX)** | OSS | ~2.5k | Apache-2.0 | mature | Deepest multi-lang CycloneDX, build-time resolution; heavier |
| 5 | **SPDX (spdx-sbom-generator / tools)** | ENT·BT | n/a | Apache-2.0 | ISO/IEC 5962 | The **ISO standard**, license/NTIA-compliance native; procurement/gov preference |
| 6 | **FOSSA / Snyk SBOM** | ENT | n/a | commercial | GA | Managed SBOM + license governance + continuous VEX; paid |

**Head-to-head:** For a **pure-npm app**, `cyclonedx-npm` produces the most faithful graph because it reads npm's own resolution rather than inferring from a lockfile, and CycloneDX carries the security-oriented fields (VEX, provenance refs) that feed Dependency-Track. **Syft** is the better pick the moment you also want to SBOM the **Docker image** (this repo is Docker-first) and want **SPDX** output for compliance — one binary, both formats, and it feeds Grype natively. **SPDX** matters only where a customer/government contract demands it (ISO 5962). Trivy can also emit SBOMs but you would not add Trivy purely for that today.

**Recommendation: KEEP + ADD Syft as the image-layer SBOM.** Keep `cyclonedx-npm` for the app dependency SBOM. **Add Syft** to SBOM the built Docker image (the delivery artifact) and to emit **SPDX** on demand for compliance asks; wire both SBOMs as CI build artifacts and (enterprise) into **Dependency-Track** for continuous VEX. **Fit 5/5.** ADR impact: SBOM-policy ADR — CycloneDX = app graph, Syft = image graph + SPDX escape hatch, publish as signed release artifacts.

---

### Container + IaC scanning — Trivy (current) vs Grype vs Snyk vs Docker Scout vs Clair

**One line:** CVE + misconfig scanning of the image and IaC/Dockerfile. **Current: Trivy** (`/ship --full`: `trivy image` + `trivy config`, HIGH/CRITICAL, triage-to-register).

| # | Candidate | Lens | Stars (2026-07) | License | Maturity | Why it ranks |
|---|-----------|------|-----------------|---------|----------|--------------|
| 1 | **Trivy (Aqua)** | BT·HS·OSS | ~28k | Apache-2.0 | mature | Broadest (image+fs+repo+K8s+IaC+SBOM+secrets), 0.1–0.3s, no daemon — **but 2026-03 supply-chain compromise (see below)** |
| 2 | **Grype + Syft (Anchore)** | BT·OSS | ~11k | Apache-2.0 | mature | Purpose-built image/SBOM CVE scanner; SBOM-driven (scan the Syft SBOM, not the image); clean Trivy alternative |
| 3 | **Snyk (Container + IaC)** | ENT·HS | n/a | commercial | GA | Curated SnykVulnDB (~47d ahead of NVD), base-image fix advice, IDE/PR/Slack; per-dev pricing, lock-in |
| 4 | **Docker Scout** | ENT | n/a | commercial (free tier) | GA | Docker-native, zero learning curve; no proprietary advisory research |
| 5 | **Clair (Quay/RH)** | BT·ENT·OSS | ~10k | Apache-2.0 | mature | Registry-integrated (Quay), API-first; heavier to self-host, image-only |
| 6 | **Checkov (Bridgecrew/Prisma)** | BT·OSS | ~7k | Apache-2.0 | mature | **IaC-focused** (Dockerfile/K8s/Terraform), 1000s of policies; pair with a CVE scanner |
| 7 | **Wiz / Prisma Cloud / Aikido** | ENT | n/a | commercial | GA | Full CNAPP incl. registry+runtime; enterprise budget |

**⚠ Trivy supply-chain compromise (CVE-2026-33634, verified across Microsoft/Palo Alto/CrowdStrike/Aqua/InfoQ [3]):**
- **2026-03-19:** actor "TeamPCP" published weaponized `trivy` **v0.69.4** across every channel (GH Releases, GHCR, Docker Hub, ECR Public, deb/rpm, `get.trivy.dev`) + poisoned `trivy-action`; **76/77 release tags git-repointed** to a multi-stage credential stealer. **2026-03-22:** further malicious Docker images **v0.69.5/.6/latest** via separately-stolen Docker Hub creds. Exposure windows 3–12h per component.
- **Payload:** exfiltrates CI/CD secrets — API tokens, AWS/GCP/Azure creds, SSH keys, K8s tokens, Docker config, git creds. **Root cause:** a misconfigured `pull_request_target` workflow leaked a PAT (via bot "hackerbot-claw") ~3 weeks earlier; credential rotation was incomplete. Later entered an **extortion phase** (Vect ransomware).
- **Safe versions:** `trivy` binary **≤ v0.69.3**; `trivy-action` **v0.35.0** (commit `57a97c7`); `setup-trivy` **v0.2.6** (commit `3fb12ec`). DB updates were suspended during remediation — verify current status before relying on freshness.

**This directly implicates the general GitHub Actions attack class** — the **tj-actions/changed-files** compromise (2025-03) repointed 350+ tags, hit 23,000+ repos, dumped CI secrets [4]. **Mitigation is the same and is mandatory:** **pin every third-party action to a full 40-char commit SHA** (a tag/`@v1` is a mutable pointer the maintainer — or an attacker — can repoint), enforce with **zizmor** / `pinact` in CI, and enable GitHub's **SHA-pinning org policy** [4].

**Head-to-head:** Trivy is still the most capable OSS scanner and the compromise was distribution-side, not a code flaw — but for an **enterprise** repo, "our security scanner shipped a credential stealer" changes the risk calculus toward **defense-in-depth and pinning**, not blind trust. **Grype+Syft** is the cleanest same-license alternative (SBOM-first, image-only but that's the delivery unit here) and a sound **second scanner** so no single vendor is a single point of failure. **Snyk** wins on fix-advice + curated DB if budget exists. **Docker Scout** is fine for a solo dev, thin for enterprise. **Checkov** covers the IaC/Dockerfile lens Trivy-config also does.

**Recommendation: KEEP+HARDEN Trivy, ADD Grype as a second scanner.** (1) **Pin trivy/trivy-action/setup-trivy to the safe commit SHAs above; pin ALL actions to full SHAs + add zizmor to CI (P0).** (2) Run trivy from a **pinned, digest-referenced image** with a **verified DB**, and **scope CI secrets** so a scanner never has standing cloud creds. (3) **Add Grype+Syft** as a parallel CVE gate (diversify the supplier; SBOM-driven). (4) Promote the image scan from `--full`-only to a **CI PR gate** at handoff. **Fit 5/5.** ADR impact: supersede/extend ADR-030 with pinning + second-scanner + scanner-isolation policy; log the Trivy incident in SECURITY.md §12.

---

### Dependency audit — npm audit (current) vs Socket vs Snyk vs osv-scanner vs Dependabot vs Renovate

**One line:** Find known-vulnerable / malicious dependencies. **Current: `npm audit`** (`/ship` phase-B hard-fail, High+ with `audit-allowlist.json`).

| # | Candidate | Lens | Stars (2026-07) | License | Maturity | Why it ranks |
|---|-----------|------|-----------------|---------|----------|--------------|
| 1 | **npm audit** | BT·HS | (bundled) | Artistic-2.0 | mature | Zero-install, <5s, GitHub Advisory DB (same as Dependabot); the right default gate [5] |
| 2 | **OSV-Scanner (Google)** | BT·OSS | ~7k | Apache-2.0 | mature | OSV DB, reads lockfiles, **SARIF** output, free/fast; CVE-only (no supply-chain behavior) [5] |
| 3 | **Socket** | ENT·HS | n/a (SaaS) | commercial | 2022+ | **Behavioral supply-chain** — flags install scripts, network/fs access, obfuscation, typosquats; catches *malicious* pkgs npm audit can't [5] |
| 4 | **Dependabot** | BT·HS·ENT | (GitHub) | GitHub | GA | Auto-opens fix PRs, GH Advisory DB, zero infra; no reachability, treats all CVEs equal (noise) [5] |
| 5 | **Renovate** | BT·HS·OSS | ~19k | AGPL-3.0 (self-host) / free app | mature | Most configurable **update automation** (grouping, schedules, all platforms) — *updater, not scanner* [5] |
| 6 | **Snyk Open Source** | ENT·HS | n/a | commercial | GA | Curated DB + **reachability** + fix PRs + license policy; per-dev pricing |
| 7 | **OWASP Dependency-Check** | BT·OSS | ~6.7k | Apache-2.0 | mature | NVD-based, multi-lang, offline-capable; slower, noisier |

**Head-to-head:** These split into three jobs. **npm audit / OSV-scanner** answer *"do I depend on a known-CVE version?"* — npm audit is the zero-install default; OSV-scanner adds SARIF + a broader DB and is the better **CI-artifact** producer. **Socket** answers a *different, higher-value* question for 2026: *"is this package **malicious** (install-script exfiltration, typosquat, sudden behavior change)?"* — the actual shape of recent npm attacks, which CVE scanners miss entirely. **Renovate vs Dependabot** is the **update** axis: Dependabot is zero-config GitHub-native; Renovate is vastly more configurable (grouping, scheduling, auto-merge policy, self-hostable) and platform-agnostic — the enterprise pick, aligning with this repo's ADR-017 in-range-continuously cadence.

**Recommendation: KEEP npm audit + ADD Socket + ADD Renovate.** Keep npm audit as the `/ship` CVE gate. **Add Socket** as a PR gate — it's the layer that catches *malicious* dependencies (the Trivy/tj-actions/npm-worm threat class), which no CVE database covers. **Adopt Renovate** for update automation (grouped, scheduled PRs) over Dependabot for its configurability + self-host + non-GitHub portability; optionally add **OSV-scanner** for SARIF in CI. **Fit 5/5.** ADR impact: dependency-hygiene ADR — npm audit (CVE gate) + Socket (behavioral gate) + Renovate (update cadence).

---

### SAST (NET-NEW) — Semgrep vs CodeQL vs SonarQube vs Opengrep

**One line:** Static application security testing of first-party code. **NET-NEW — none yet** (the repo has 10 local ESLint security rules but no dataflow/taint SAST).

| # | Candidate | Lens | Stars (2026-07) | License | Maturity | Why it ranks |
|---|-----------|------|-----------------|---------|----------|--------------|
| 1 | **Semgrep (CE)** | BT·HS·OSS | ~12k | LGPL-2.1 (CE) / commercial Pro | mature | Rules look like code, seconds-fast, 30+ langs; free Pro Engine ≤10 devs/50 repos; CI-native [6] |
| 2 | **CodeQL (GitHub)** | BT·HS·ENT | (GitHub) | free public / GHAS private | GA | Deepest semantic/taint analysis (highest OWASP-Benchmark F1); GitHub-native; steeper query lang [6] |
| 3 | **Opengrep** | OSS·HS | (2025 fork) | LGPL-2.1 | 2025 | Community fork of Semgrep CE that **restores cross-file taint** removed from CE; backed by 10+ appsec vendors (Aikido/Endor/Jit/Orca) — no single-vendor takeback [6] |
| 4 | **SonarQube** | BT·ENT·HS | ~9k (server) | LGPL-3.0 (CE) / commercial | mature | 35+ langs, 6000+ rules, **quality-gate** enforcement + code quality; heavier server [6] |
| 5 | **Snyk Code** | ENT | n/a | commercial | GA | AI/DeepCode SAST, fast, IDE+PR; per-dev, lock-in |
| 6 | **Joern** | OSS | ~2.5k | Apache-2.0 | research | Code-property-graph, powerful/manual; niche |

**Head-to-head:** **CodeQL** is the depth leader (best benchmark accuracy, real taint) and is **free for the private-repo path only via GHAS** — natural at `/handoff` to a GitHub-Actions org, but it's slow and GitHub-coupled. **Semgrep CE** is the fast, writable-rules, CI-native option and is what a solo operator can run *today* for free — but Stripe-style **cross-file taint moved to the paid Pro Engine**, which is the exact gap **Opengrep** (the 2025 LGPL fork, multi-vendor governed) exists to close, making Opengrep the strongest *pure-OSS, no-takeback* pick for an enterprise that wants to self-host without a per-dev bill. **SonarQube** bundles security into code-quality quality-gates — attractive if you also want maintainability metrics, but it's a heavier self-hosted server.

**Recommendation: ADOPT (net-new) — Semgrep/Opengrep now, CodeQL at handoff.** Add **Semgrep** (or **Opengrep** for the fully-OSS, cross-file-taint, vendor-neutral path) as a CI SAST gate for JS/TS + custom rules encoding this repo's invariants (the auth-wrapper/zod/no-raw-SQL rules the ESLint plugin already asserts — Semgrep catches the dataflow cases ESLint can't). At `/handoff` to a GHAS org, **layer CodeQL** for deep taint. **Fit 5/5** (CI-native, no runtime dep). ADR impact: **new ADR — adopt SAST**; decide Semgrep-CE vs Opengrep on the copyleft/vendor-neutrality axis; wire the custom ruleset as a HARD gate.

---

### Git hooks — husky (current) vs lefthook vs pre-commit

**One line:** Run gates (lint/format/gitleaks) on commit/push. **Current: husky v9** (`prepare: husky`).

| # | Candidate | Lens | Stars (2026-07) | License | Maturity | Why it ranks |
|---|-----------|------|-----------------|---------|----------|--------------|
| 1 | **husky** | BT·HS·OSS | ~28k [7] | MIT | mature | De-facto Node standard, ~5M wk downloads, tiny `.husky/` shell hooks; pairs with lint-staged [7] |
| 2 | **lefthook (Evil Martians)** | BT·HS·OSS | ~5k [7] | MIT | mature | Go binary, **parallel** hooks (~10× faster, 45s→15s), monorepo-aware, no Node needed; single YAML [7] |
| 3 | **pre-commit (Python)** | BT·HS·OSS | ~14k | MIT | mature | Huge pre-built hook ecosystem + **language/env isolation** (runs hooks in langs not installed locally); Python dependency [7] |
| 4 | **lint-staged** | BT·HS | ~14k | MIT | mature | Not a hook manager — the *staged-files runner* husky/lefthook invoke |
| 5 | **simple-git-hooks** | OSS | ~2k | MIT | mature | Ultra-minimal husky alt; fewer features |

**Head-to-head:** husky is the safe incumbent — everyone knows `.husky/`, MIT, JS-ecosystem-native — but hooks run **serially** and it needs Node. **lefthook** is the enterprise-scale upgrade: a Go binary with **parallel** execution (the ~10× win matters as the pre-commit chain grows to gitleaks + lint + typecheck + tests), monorepo-aware, single declarative YAML, and no Node bootstrap — attractive for a **Docker-first** repo where not every context has Node. **pre-commit** wins only if you need its pre-built-hook catalogue + cross-language env isolation, at the cost of a Python runtime dependency (odd in an npm project).

**Recommendation: KEEP (lefthook = ADD-AS-OPTION).** husky is fine and low-risk; no forced change. **Evaluate lefthook** when the pre-commit chain grows enough that serial execution hurts, or to drop the Node requirement in container builds — the parallel speedup + single-binary/YAML is a clean win with a small migration. **Fit: husky 5/5, lefthook 4/5.** ADR impact: none to keep; a one-line ADR if migrating to lefthook.

---

### Signing / provenance (NET-NEW) — Sigstore/cosign, SLSA, npm provenance

**One line:** Cryptographically attest *what was built, from what source, by which pipeline* — and let consumers verify it. **NET-NEW — none yet.**

| # | Candidate | Lens | Stars (2026-07) | License | Maturity | Why it ranks |
|---|-----------|------|-----------------|---------|----------|--------------|
| 1 | **Sigstore / cosign** | BT·HS·OSS·ENT | ~5k (cosign) | Apache-2.0 | GA | **Keyless** signing via short-lived OIDC certs (no long-lived keys); signs container images + artifacts; verifies npm/GH provenance [8] |
| 2 | **SLSA + slsa-github-generator** | BT·ENT·OSS | ~1.5k | Apache-2.0 | GA (L3) | Tamper-proof **build provenance** (source→workflow→artifact); the framework enterprises/gov target (L3) [8] |
| 3 | **GitHub Artifact Attestations** | BT·ENT·HS | (GitHub) | GitHub | GA | `actions/attest-build-provenance` — SLSA provenance + Sigstore signing in one action, GH-native [8] |
| 4 | **npm provenance** | BT·HS·OSS | (npm) | npm | GA | `npm publish --provenance` → public transparency-log attestation linking pkg→repo→CI; cosign-verifiable [8] |
| 5 | **in-toto** | ENT·OSS | ~1k | Apache-2.0 | mature | The attestation spec underneath SLSA; low-level |
| 6 | **Notary v2 / Notation (CNCF)** | ENT·OSS | ~1k | Apache-2.0 | GA | Registry-native image signing; OCI-focused, key-based alt to cosign |

**Head-to-head:** These compose rather than compete. **SLSA** is the *goal* (build-integrity levels — L3 = non-falsifiable provenance); **Sigstore/cosign** is the *mechanism* (keyless signing + verification, no key-management burden — the historical blocker); **GitHub Artifact Attestations** is the *easy button* that emits SLSA provenance signed via Sigstore from one pinned action; **npm provenance** is the *registry-surfaced* form for anything published to npm. Key framing from the sources: **provenance doesn't *prevent* supply-chain attacks — it makes them *detectable***, which is exactly the missing control the Trivy incident exposes (a signed, verifiable build would have made the poisoned binaries fail verification).

**Recommendation: ADOPT (net-new) — this is the strategic gap.** For a **Docker-first** enterprise delivery: **sign the release image with cosign (keyless)** and **generate SLSA build provenance** via GitHub Artifact Attestations (both from **SHA-pinned** actions), then **verify signatures at deploy/pull time** so an unsigned/mismatched image is rejected. This is the direct structural defense against the C11 threat class the Trivy compromise demonstrated. **Fit 5/5** (CI + registry, no runtime dep). ADR impact: **new ADR — artifact signing & provenance** (cosign + SLSA L3 target + verify-on-deploy); pairs with the SBOM ADR (sign the SBOM too).

---

## Category verdict table

| Item | Current | Recommendation | Net-new deps/tools | ADR impact | Priority |
|------|---------|----------------|--------------------|-----------|----------|
| Secret scanning | gitleaks (gate) | **KEEP+HARDEN** — add trufflehog *verify* in CI; GH push-protection at handoff | trufflehog (CLI, already in `/audit`) | extend security-workflow ADR | **P1** |
| SBOM | cyclonedx-npm | **KEEP + ADD Syft** for image SBOM + SPDX; → Dependency-Track | syft | SBOM-policy ADR | P1 |
| Container/IaC scan | trivy (`--full`) | **KEEP+HARDEN + ADD Grype**; pin to safe SHAs; second scanner; scope secrets | grype (+syft) | supersede/extend ADR-030; SECURITY.md §12 | **P0** |
| Actions pinning | (tags/`@v`) | **PIN ALL actions to full commit SHA + zizmor in CI** | zizmor / pinact | hardening ADR | **P0** |
| Dependency audit | npm audit (gate) | **KEEP + ADD Socket (behavioral) + Renovate (updates)** | socket, renovate; opt. osv-scanner | dependency-hygiene ADR | **P1** |
| SAST | none (ESLint rules only) | **ADOPT** Semgrep/Opengrep now; CodeQL at handoff | semgrep or opengrep | **new SAST ADR** | **P1** |
| Git hooks | husky | **KEEP** (lefthook = option at scale) | — (lefthook if migrating) | none / 1-line | P2 |
| Signing/provenance | none | **ADOPT** cosign + SLSA + verify-on-deploy; npm provenance if publishing | cosign, slsa-github-generator/attest-build-provenance | **new signing ADR** | **P1** |

## Which become HARD CI gates for enterprise

**Blocking gates (fail the build / block merge):**
1. **gitleaks** secret scan — keep (already hard).
2. **npm audit** High+ (with adjudicated allowlist) — keep (already hard).
3. **Trivy image + config**, HIGH/CRITICAL — **promote from `/ship --full`-only to a blocking PR gate**, running a **pinned, verified** trivy; **add Grype** as the diversified second CVE gate.
4. **Action-pin enforcement (zizmor)** — **new hard gate**: fail if any workflow references a non-SHA action.
5. **SAST (Semgrep/Opengrep)** custom + baseline ruleset — **new hard gate** encoding the auth/zod/no-raw-SQL invariants as dataflow rules.
6. **Cosign signature + SLSA provenance verification at deploy/pull** — **new hard gate**: an unsigned or mismatched image is rejected.

**Non-blocking / advisory (report, don't fail):**
- **Socket** behavioral review (block only on confirmed-malicious, warn otherwise — FP-sensitive), **trufflehog-verify** (warn + triage), **SBOM generation** (build artifact), **Renovate/Dependabot** PRs (automation, not a gate), **husky/lefthook** local hooks (fast feedback, not authoritative).

**Cross-cutting P0 the Trivy incident forces:** pin every third-party action to a full 40-char SHA, run scanners from pinned digests with verified DBs, and **scope CI secrets** so no scanner holds standing cloud/K8s credentials — a scanner compromise must not equal a credential breach.

---

## Sources
1. AppSecSanta — *Gitleaks vs TruffleHog 2026*; DevSecOps.ae; Secrails — *TruffleHog vs Gitleaks vs GitHub Secret Scanning*; Jit; Aikido — *Gitleaks Alternatives 2026*. (star ~26k/25.7k; 94% vs 71%/86% detection; MIT vs AGPL-3.0)
2. Sbomify — *SBOM Generation Tools Compared (2026-01)*; AppSecSanta — *Syft vs Trivy*; HeroDevs — *SPDX vs CycloneDX*; OpenSSF — *Choosing an SBOM Generation Tool*. (Syft ~8.4k, Apache-2.0)
3. Microsoft Security Blog (2026-03-24); Palo Alto Networks (Unit 42); CrowdStrike — *trivy-action Supply Chain Compromise*; Aqua Security advisory; InfoQ (2026-04); `aquasecurity/trivy` GHSA-69fq-xp46-6x23 / Discussion #10425; Halcyon (extortion phase). (CVE-2026-33634; safe: trivy ≤v0.69.3, trivy-action v0.35.0 `57a97c7`, setup-trivy v0.2.6 `3fb12ec`)
4. GitHub Changelog (2025-08-15, SHA-pinning policy); StepSecurity — *Pinning GitHub Actions*; Lullabot ADR (2026-05); tj-actions/changed-files incident (2025-03, 350+ tags / 23,000+ repos); zizmor / pinact.
5. Tomoda Hinata — *Dependabot vs Snyk vs Trivy vs npm audit (2026)*; AppSecSanta — *Best SCA Tools for Node.js (2026)*; Rafter — *Snyk vs Dependabot vs Renovate*; shattered.io — *npm audit (2026)*; nesbitt.io — *Package Management Landscape (2026-01)*. (Renovate ~19k)
6. Rafter — *Semgrep vs SonarQube vs CodeQL (2026)*; Konvu — *Semgrep vs CodeQL*; AppSecSanta — *Semgrep Alternatives 2026* (Opengrep fork, LGPL-2.1, 10+ vendor consortium); OWASP Benchmark v1.2 study (CodeQL top F1); pricing convergence ~$30/mo/committer.
7. Andy Madge — *Git Hook Frameworks Comparison (2026-03)*; PkgPulse — *husky vs lefthook vs lint-staged (2026)*; Edopedia; DEV — *Saying Goodbye to Husky*. (husky ~28k / ~5M wk dl; lefthook Go, ~10× parallel)
8. Sigstore Blog — *cosign Verification of npm Provenance / GitHub Artifact Attestations*; DecryptionDigest — *Sigstore & Cosign 2026*; Pavan Rangani — *SLSA + Sigstore Guide 2026*; AquilaX — *Beyond SBOMs: Sigstore, SLSA, Build Provenance*. (keyless OIDC signing; SLSA L3; npm `--provenance`)
