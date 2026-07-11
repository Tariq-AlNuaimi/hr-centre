# C13 — CI/CD, Lint, Formatting & Quality Gates (Enterprise Benchmark v2)

> Exhaustive 4-lens top-10 pass. Lens tags: **BT** battle-tested · **HS** highest-star/most-popular · **ENT** enterprise-grade · **OSS** best pure open-source. Stars/versions/licenses verified via web on **2026-07-11** (dated inline). Scored against the fixed stack in `METHODOLOGY.md`; honors the pivot (enterprise-only, deploy-per-tenant, Docker-first, compose-now/k8s-later).

**Current gate inventory (from `package.json` + `scripts/ship.mjs`):** ESLint 9 flat config + 10 local security rules · knip 6 · jscpd 5 · size-limit 12 (+`@size-limit/file`) · `@next/bundle-analyzer` · react-scan · `@lhci/cli` · husky 9 · `@changesets/cli` · style-dictionary 5 · tsx. `/ship` phases: typecheck → lint → tests → build → gitleaks → trivy → npm-audit, plus `scalability`, `wave-offs`, `tier`, `blueprint`, `db-structure`, `knip`, `duplication`, `complexity`, `coverage`, `size-limit`, `docker`. **CI (`.github/workflows/*`: codeql, sast, secrets-scan, senior-review, docker-build, release, uat, verify) is present but DORMANT on the free plan** — the enterprise pivot must turn these live and make the local `/ship` gates HARD CI fails.

---

### Linter — ESLint 9 (flat config + 10 local security rules)

**One line:** JS/TS static analysis + our 10 in-repo `rihal-template/*` security rules (`no-prisma-in-client`, `no-any-cast-on-session`, `no-secret-env-in-console`, `no-bare-internal-route`, `no-raw-hex-color`, `no-unaudited-bulk-write`, `no-raw-sql-unsafe`, `no-rate-limit-inside-auth`, `no-restricted-export-column`, `no-prisma-unfiltered-import`). Current: **ESLint 9 flat config** (`eslint@^9`, `eslint-config-next`).

| #   | Candidate                                | Lens          | Stars (2026-07-11) | License         | Maturity                        | Why it ranks                                                                                                |
| --- | ---------------------------------------- | ------------- | ------------------ | --------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | **ESLint 9** (flat config)               | BT·HS·ENT·OSS | 27.5k              | MIT             | 2013; flat config default in 9  | Only linter with a real custom-rule API + 4000-plugin ecosystem; our 10 rules run natively today            |
| 2   | **Oxlint** (oxc)                         | HS·OSS        | 21.9k (oxc)        | MIT             | 2023; oxlint v1.73 (Jul 6 2026) | 50–100× faster (Rust); JS-plugin API (ESLint-compatible) went **alpha 2026-03** — custom rules now portable |
| 3   | **Biome** (linter)                       | HS·OSS        | 25.4k              | MIT/Apache-2.0  | 2023; v2.5.3 (Jul 8 2026)       | All-in-one lint+format, ~200 rules, type-aware in v2; **no custom-rule API** — our 10 rules cannot move     |
| 4   | typescript-eslint                        | BT·ENT·OSS    | (part of ESLint)   | MIT             | mature                          | Type-aware rules ESLint-native; the reason ESLint still wins TS depth                                       |
| 5   | `eslint-plugin-security` / `-no-secrets` | BT·OSS        | —                  | MIT             | mature                          | Off-the-shelf security rules; complement, not replacement for our bespoke Prisma/audit rules                |
| 6   | Semgrep (SAST-as-lint)                   | BT·ENT        | 11k+               | LGPL/commercial | mature                          | Pattern SAST; already the `sast.yml` layer, not a JS linter swap                                            |
| 7   | Rome (archived)                          | —             | —                  | MIT             | **dead** — became Biome         | Historical; do not adopt                                                                                    |
| 8   | deno lint                                | OSS           | (part of Deno)     | MIT             | mature                          | Rust, fast, but Deno-runtime bound; N/A for Node 22                                                         |
| 9   | quick-lint-js                            | OSS           | 1k+                | Apache-2.0      | niche                           | Editor-speed JS only; no TS/plugin depth                                                                    |
| 10  | XO (ESLint wrapper)                      | OSS           | 7k+                | MIT             | mature                          | Opinionated ESLint preset; still ESLint underneath                                                          |

**Head-to-head:** The whole decision hinges on the **10 custom rules**. Biome **cannot** run them (no plugin API in 2026) — a move to Biome means deleting our enforced security floor or reimplementing it as brittle regex/Grit, a non-starter given the CLAUDE.md hard-rules depend on these at `error`. Oxlint changed the calculus in **March 2026**: its JS-plugin API is now ESLint-v9-compatible (alpha), so in principle our AST rules _could_ port — but it is alpha, our rules touch Prisma/type context that Oxlint's type-aware story doesn't yet fully cover, and moving a security floor onto an alpha API is unjustifiable risk. ESLint keeps type-aware rules + the mature custom-rule API; its only loss is speed, which is a non-issue at this repo's size and is already mitigated by `/ship` caching.

**Recommendation:** **KEEP+HARDEN.** Stay on ESLint 9; it is the _only_ option that runs our 10 rules as first-class `error`s today. **Harden:** (a) add Oxlint as an _optional fast pre-commit pass_ for the built-in rules only (speed win, zero risk to the security floor) once its JS-plugin API leaves alpha; (b) pin the ESLint + plugin versions and add a `no-inline-role-check`-style rule to the local plugin set as authZ hardens; (c) make `lint` a **hard CI fail** (see verdict). **Fit: 5/5.** **ADR impact:** none to keep; a future "linter-speed" ADR if Oxlint is added as an optional layer (build-vs-buy-ledger entry).

---

### Formatter — Prettier vs Biome vs dprint

**One line:** Deterministic code formatting. Current: **NONE** — the repo has no Prettier/formatter today; format is enforced only implicitly by ESLint + editor config.

| #   | Candidate             | Lens          | Stars (2026-07-11) | License        | Maturity                                  | Why it ranks                                                                                       |
| --- | --------------------- | ------------- | ------------------ | -------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | **Prettier**          | BT·HS·ENT·OSS | 52.2k              | MIT            | 2017; ~45M weekly dl                      | The de-facto standard; every editor/CI supports it; widest language coverage (CSS/MD/YAML/GraphQL) |
| 2   | **Biome** (formatter) | HS·OSS        | 25.4k              | MIT/Apache-2.0 | v2.5.3 (Jul 8 2026); >96% Prettier-compat | 25–35× faster (Rust); one binary does lint+format; no MD/YAML/GraphQL                              |
| 3   | **dprint**            | OSS           | 3k+                | MIT            | mature                                    | Fastest + most configurable (Wasm plugins); smallest ecosystem, more config burden                 |
| 4   | oxfmt (oxc)           | OSS           | 21.9k (oxc)        | MIT            | v0.58 (Jul 2026)                          | Very new; 3× Biome format speed; not yet production-proven as sole formatter                       |
| 5   | ESLint Stylistic      | OSS           | 1k+                | MIT            | mature                                    | Format-in-lint; discouraged (slow, not a real formatter)                                           |

**Head-to-head:** For a repo with **no formatter today**, the choice is Prettier (max compatibility, zero surprises, formats the MD/YAML/token JSON that Biome/dprint skip) vs Biome (blazing, folds into a single lint+format tool — but we are _keeping_ ESLint for the custom rules, so Biome-as-formatter means running _two_ linters' worth of config). Prettier is the low-risk enterprise default: it never conflicts with ESLint (via `eslint-config-prettier`), covers every file type in this repo, and is universally recognized in handoff/IT contexts. Biome's speed edge is irrelevant at this scale; its coverage gaps (no YAML/MD/GraphQL) actively hurt a repo full of docs and token JSON.

**Recommendation:** **ADOPT (net-new) → Prettier.** Add `prettier` + `eslint-config-prettier` (turns off ESLint stylistic rules so the two never fight) + a `.prettierrc` and `format:check` script. Wire `prettier --check` into `/ship` phase A and as a **hard CI fail**; run `prettier --write` in the git-hook. This closes a real enterprise gap (no formatter = inconsistent diffs = noisy reviews). **Fit: 5/5.** **ADR impact:** small ADR "adopt Prettier as the formatter, ESLint keeps semantics only" + build-vs-buy-ledger entry (net-new `lib`-adjacent tooling dep, <50KB config-only).

---

### CI platform — GitHub Actions vs GitLab CI vs Buildkite vs Dagger

**One line:** Pipeline orchestration for the (currently dormant) gates. Current: **GitHub Actions** (`.github/workflows/*`, dormant on free plan).

| #   | Candidate              | Lens       | Stars/scale (2026-07-11) | License/model               | Maturity                      | Why it ranks                                                                                                                           |
| --- | ---------------------- | ---------- | ------------------------ | --------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **GitHub Actions**     | BT·HS·ENT  | 20k+ marketplace actions | SaaS + self-hosted runners  | mature                        | Native to our repo host; 8 workflows already written; largest ecosystem; enterprise SSO/SAML via GH Enterprise                         |
| 2   | **GitLab CI/CD**       | BT·ENT·OSS | (GitLab, self-hostable)  | MIT-core + commercial tiers | mature                        | Best single-vendor SCM+CI+security+registry; strong for air-gap/self-host enterprise                                                   |
| 3   | **Buildkite**          | BT·ENT     | agent 1.5k+              | commercial + OSS agent      | mature                        | Hybrid: cloud control-plane + **your-infra agents**; best for scale/security-sensitive enterprises                                     |
| 4   | **Dagger**             | OSS·ENT    | 16.1k                    | Apache-2.0                  | 2022; container-native engine | **Portable pipelines-as-code** (Go/Py/TS) that run inside _any_ CI — insurance against host lock-in; needs a trigger (not a CI itself) |
| 5   | Jenkins                | BT·ENT·OSS | 24k+                     | MIT                         | legacy                        | Ubiquitous in old enterprises; heavy ops burden; only if org mandates it                                                               |
| 6   | CircleCI               | BT·ENT     | —                        | commercial                  | mature                        | Fast, good caching; extra vendor when GH Actions is already present                                                                    |
| 7   | Drone                  | OSS        | 33k                      | Apache-2.0 (Harness)        | mature                        | Container-native, self-host; smaller community now                                                                                     |
| 8   | Woodpecker CI          | OSS        | 5k+                      | Apache-2.0                  | Drone fork                    | Fully-FOSS self-host option                                                                                                            |
| 9   | Tekton                 | OSS·ENT    | 8k+                      | Apache-2.0                  | mature                        | K8s-native; defer to post-v1 k8s track                                                                                                 |
| 10  | Azure DevOps Pipelines | ENT        | —                        | commercial                  | mature                        | Only if org is Microsoft-centric (aligns with Entra ID ADR-024)                                                                        |

**Head-to-head:** The repo already lives on GitHub with 8 workflows authored, so GitHub Actions is the zero-migration default and its ecosystem/enterprise-SSO story is strongest. The one strategic risk is **host lock-in** — the pivot is Docker-first/self-hostable, and a customer could mandate GitLab or an air-gapped runner. **Dagger** is the answer to that tension: it isn't a competing CI, it's a portable engine you invoke _from_ Actions/GitLab/Buildkite, so the pipeline logic survives a host swap. GitLab CI wins only if the whole SCM moves to GitLab; Buildkite wins only at large scale needing agents on customer infra. None of these require ripping out GitHub Actions.

**Recommendation:** **KEEP+HARDEN → GitHub Actions, with Dagger as the portability seam.** (1) **Activate the dormant workflows for enterprise** — this is the headline action of the whole category (see verdict). (2) Keep the _substance_ of each gate in `scripts/ship.mjs`/Node + a thin `dagger`-wrapped module so the same steps run identically in `/ship` locally, in Actions, and in any future GitLab/Buildkite tenant — no pipeline rewrite on host change. (3) Add self-hosted runners for air-gapped tenants. **Fit: 5/5** (GH Actions), 4/5 (Dagger add-on). **ADR impact:** new ADR "CI activation + portable-pipeline strategy (Actions primary, Dagger-wrapped steps for host portability)."

---

### Dead-code — knip vs ts-prune vs unimported

**One line:** Find unused files/exports/deps. Current: **knip 6** (in `/ship` `knip` phase).

| #   | Candidate                | Lens          | Stars (2026-07-11) | License | Maturity                          | Why it ranks                                                                                           |
| --- | ------------------------ | ------------- | ------------------ | ------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | **knip**                 | BT·HS·ENT·OSS | 11.7k              | ISC     | v6.26 (Jul 10 2026); 150+ plugins | Superset of all rivals: unused files+exports+deps+config; Next/ESLint/Playwright plugins fit our stack |
| 2   | ts-prune                 | —             | ~2k                | MIT     | **archived, points to knip**      | Exports only; abandoned — do not adopt                                                                 |
| 3   | unimported               | —             | ~1.4k              | MIT     | **archived, points to knip**      | Prod-mode imports only; abandoned                                                                      |
| 4   | ts-unused-exports        | OSS           | 1k+                | MIT     | low activity                      | Narrow (exports only); knip subsumes it                                                                |
| 5   | depcheck                 | BT·OSS        | 5k+                | MIT     | mature                            | Dependency-only; knip covers deps + more                                                               |
| 6   | Oxlint `no-unused` rules | OSS           | 21.9k (oxc)        | MIT     | growing                           | Per-file unused symbols, not project-graph dead files                                                  |

**Head-to-head:** Both credible rivals (ts-prune, unimported) are **archived and explicitly redirect to knip** — this is a settled market. knip is the only actively-maintained, project-graph-aware option and it already subsumes depcheck's dependency scanning. No reason to look further.

**Recommendation:** **KEEP.** knip stays; make its `/ship` gate a **hard CI fail** (unused exports/deps are maintainability debt the pivot's Maintainable pillar already gates). Pin config; consider `--production` scoping so test-only exports don't noise. **Fit: 5/5.** **ADR impact:** none.

---

### Duplication — jscpd vs alternatives

**One line:** Copy-paste detection. Current: **jscpd 5** (in `/ship` `duplication` phase).

| #   | Candidate                 | Lens       | Stars (2026-07-11) | License              | Maturity                                                      | Why it ranks                                                                                                               |
| --- | ------------------------- | ---------- | ------------------ | -------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | **jscpd**                 | BT·HS·OSS  | ~5.5k              | MIT                  | since 2013; **v5 = Rust rewrite**, 24–37× faster; 223 formats | The JS-ecosystem standard; v5 self-contained (`cpd` binary), AI/MCP reporter (v4.1+), cross-format detect (v4.2, May 2026) |
| 2   | PMD CPD                   | BT·ENT·OSS | 5k+                | BSD/Apache           | mature                                                        | JVM-based, multi-language; heavier, Java-runtime dep — overkill for a TS repo                                              |
| 3   | SonarQube dup engine      | BT·ENT     | —                  | commercial + LGPL CE | mature                                                        | Bundled with Sonar; adopt only if Sonar is already the quality platform                                                    |
| 4   | simian                    | ENT        | —                  | commercial           | legacy                                                        | Paid, Java; no reason over jscpd                                                                                           |
| 5   | Oxlint (no dedicated dup) | —          | —                  | MIT                  | —                                                             | Not a duplication tool                                                                                                     |

**Head-to-head:** jscpd is the de-facto TS/JS duplication detector and its **v5 Rust rewrite** removed the only real complaint (speed). PMD CPD and Sonar are heavier, ecosystem-foreign (JVM/commercial) tools justified only if the org already runs SonarQube as its umbrella quality gate. One maintenance caveat: jscpd is a **single-maintainer** project — a supply-chain watch-item, not a blocker.

**Recommendation:** **KEEP.** Stay on jscpd; upgrade to v5 for the Rust speed + pin the threshold in config; make the `duplication` gate a **hard CI fail**. Note the single-maintainer risk in the SBOM/supply-chain register. **Fit: 5/5.** **ADR impact:** none (a one-line note on jscpd v5 upgrade + single-maintainer watch).

---

### Bundle/perf budget — size-limit · bundlewatch · @lhci/cli · react-scan · @next/bundle-analyzer

**One line:** Client-payload + web-vitals budgets. Current: **size-limit 12** (`/ship` `size-limit` phase) + `@next/bundle-analyzer` (`ANALYZE=true`) + `react-scan` (dev render profiler) + `@lhci/cli` (Lighthouse budgets).

| #   | Candidate                     | Lens       | Stars (2026-07-11) | License    | Maturity                | Why it ranks                                                                                 |
| --- | ----------------------------- | ---------- | ------------------ | ---------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| 1   | **size-limit**                | BT·HS·OSS  | ~6.9k              | MIT        | mature; 728k weekly dl  | Actively maintained bundle budget; `size-limit-action` PR-comments + fails CI; already wired |
| 2   | **@lhci/cli** (Lighthouse CI) | BT·ENT·OSS | 7.0k               | Apache-2.0 | v0.15.1 (Jun 2025)      | Google's web-vitals budgets (LCP/CLS/TBT) as CI assertions; the perf **outcome** gate        |
| 3   | **@next/bundle-analyzer**     | BT·OSS     | (Next.js)          | MIT        | tracks Next 16          | Visual treemap for _diagnosis_ (not a gate); pairs with size-limit                           |
| 4   | **react-scan**                | HS·OSS     | 21.6k              | MIT        | active; render profiler | Catches wasted re-renders in dev; diagnostic, not a CI gate                                  |
| 5   | bundlewatch                   | OSS        | ~441               | MIT        | maintained but small    | size-limit's smaller rival; no reason to switch                                              |
| 6   | BundleMon                     | OSS        | ~600               | MIT        | active                  | Hosted history + PR checks; nice history UI, smaller community                               |
| 7   | bundlesize                    | —          | ~5k                | MIT        | **maintenance mode**    | Superseded by bundlewatch; avoid                                                             |
| 8   | Statoscope                    | OSS        | 1.5k+              | MIT        | active                  | Deep webpack analysis; heavier than analyzer                                                 |
| 9   | Unlighthouse                  | OSS        | 3k+                | MIT        | active                  | Site-wide Lighthouse crawl; complements lhci for multi-page                                  |
| 10  | Vercel Speed Insights (RUM)   | ENT        | —                  | commercial | active                  | **Already in stack** — real-user field vitals; complements lab lhci                          |

**Head-to-head:** These are **complementary, not competitors** — the enterprise repo wants all four layers: size-limit (byte budget, gate) + lhci (lab web-vitals budget, gate) + bundle-analyzer (diagnosis) + react-scan (dev render diagnosis), with Vercel Speed Insights already covering field RUM. The only true swap question is size-limit vs bundlewatch/BundleMon: size-limit has ~15× the adoption and is already wired, so keep it. lhci's last release (v0.15.1) is mid-2025 — **slightly stale but still the standard**; a current-events watch-item, not yet a replacement trigger.

**Recommendation:** **KEEP ALL + HARDEN.** Keep size-limit (byte gate), lhci (vitals gate), analyzer + react-scan (diagnostics). **Harden:** promote **size-limit and lhci-assert to hard CI fails** with committed budgets (JS ≤ target KB per route; LCP/CLS/TBT thresholds); add `size-limit-action` PR comments; watch lhci maintenance and keep Unlighthouse in reserve for multi-page crawl. **Fit: 5/5.** **ADR impact:** small ADR "performance budgets as CI gates (size-limit + lhci thresholds committed)."

---

### Release/versioning — changesets vs semantic-release vs release-please

**One line:** Version bumps + changelog + publish. Current: **@changesets/cli** (`changeset` / `changeset:version` scripts; `release.yml` dormant).

| #   | Candidate            | Lens          | Stars (2026-07-11) | License    | Maturity        | Why it ranks                                                                                                    |
| --- | -------------------- | ------------- | ------------------ | ---------- | --------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | **changesets**       | BT·HS·ENT·OSS | 12.1k              | MIT        | mature          | PR-based intent files; best monorepo/independent-versioning story; **visible release intent in review**         |
| 2   | **semantic-release** | BT·HS·ENT·OSS | 23.9k              | MIT        | mature          | Fully-automated from Conventional Commits; hands-off but couples version to commit msgs; monorepo needs plugins |
| 3   | **release-please**   | BT·ENT·OSS    | 7.2k               | Apache-2.0 | mature (Google) | Release-PR model from Conventional Commits; great for apps/polyglot; GitHub-centric                             |
| 4   | release-it           | OSS           | 8k+                | MIT        | mature          | Interactive/manual control; less CI-native                                                                      |
| 5   | auto (Intuit)        | OSS           | 2k+                | MIT        | mature          | Label-driven releases; niche                                                                                    |
| 6   | standard-version     | —             | ~7k                | ISC        | **deprecated**  | Abandoned; avoid                                                                                                |

**Head-to-head:** For a **deploy-per-tenant app** (not a published npm library), "release" mostly means tagging + changelog for handoff, not npm publishing. changesets' explicit intent-file-in-PR model gives compliance/IT a human-readable record of what shipped each release — the best fit for the audit-conscious enterprise pivot and already wired. semantic-release is more automated but ties versions to commit-message discipline (fragile across many contributors) and needs extra plugins for the monorepo-ish layout. release-please is an excellent app-oriented alternative but overlaps what changesets already does here.

**Recommendation:** **KEEP.** changesets stays; **activate `release.yml`** so version+changelog PRs are generated in CI at handoff (ties into the `/handoff` ADR). For a pure-app tenant (no npm publish) configure changesets in changelog-only/`privatePackages` mode. **Fit: 5/5.** **ADR impact:** none to keep; the CI-activation ADR covers turning `release.yml` live.

---

### Git hooks — husky vs lefthook vs pre-commit

**One line:** Run gates pre-commit/pre-push locally. Current: **husky 9** (`prepare: husky`).

| #   | Candidate        | Lens       | Stars (2026-07-11) | License | Maturity               | Why it ranks                                                                                      |
| --- | ---------------- | ---------- | ------------------ | ------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | **husky**        | BT·HS·OSS  | ~8.1k              | MIT     | mature; ~5M weekly dl  | Node-native standard; auto-setup via `prepare`; already wired; simplest for a JS-only repo        |
| 2   | **lefthook**     | BT·ENT·OSS | ~3.4k              | MIT     | mature (Evil Martians) | Go single-binary; **parallel** hooks (~10× faster); one YAML replaces husky+lint-staged; polyglot |
| 3   | **pre-commit**   | BT·ENT·OSS | ~1.9k              | MIT     | mature                 | Broadest pre-built hook ecosystem + per-hook env isolation; Python-runtime dep                    |
| 4   | simple-git-hooks | OSS        | 1.5k+              | MIT     | active                 | Ultra-minimal husky alt; fewer features                                                           |
| 5   | lint-staged      | BT·HS·OSS  | ~14k               | MIT     | mature                 | Not a hook manager — the _staged-file runner_ husky/lefthook call; **should be added**            |

**Head-to-head:** husky is the frictionless Node default and is already installed; its weakness is serial execution and being Node-bound. **lefthook** is the enterprise-leaning upgrade: Go binary (no Node needed to commit — relevant if IT adds polyglot services post-handoff), **parallel** lint+typecheck+format in the pre-commit stage (meaningful once Prettier + size-limit + knip all want to run), and a single declarative YAML. pre-commit's Python dependency is friction for a JS shop. Note husky + a staged runner (**lint-staged**, currently absent) is the industry-standard pairing; lefthook folds that in natively.

**Recommendation:** **KEEP husky now; ADD-AS-OPTION lefthook at scale.** Short term: keep husky and **add lint-staged** so the new Prettier + ESLint + knip run only on staged files (fast local gate). Medium term, if the repo goes polyglot at handoff or the pre-commit stage grows, **migrate to lefthook** for parallelism + Go-binary portability (aligns with Docker-first/no-Node-to-commit). **Fit:** husky 4/5, lefthook 5/5 at scale. **ADR impact:** minor — a note in the tooling ADR that lefthook is the presumptive upgrade path; add lint-staged now (build-vs-buy-ledger line).

---

### Design tokens — style-dictionary vs Terrazzo vs Tokens Studio

**One line:** Compile token JSON → CSS/TS for the Tailwind v4 theme. Current: **style-dictionary 5** (`tokens:build` → `scripts/build-tokens.mjs`).

| #   | Candidate            | Lens          | Stars (2026-07-11) | License             | Maturity                                             | Why it ranks                                                                                                       |
| --- | -------------------- | ------------- | ------------------ | ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | **Style Dictionary** | BT·HS·ENT·OSS | 4.7k               | Apache-2.0          | v5.5.0 (Jun 2026); **first-class W3C DTCG** since v4 | The build-side standard; multi-platform outputs; already wired; DTCG-stable (spec froze Oct 2025)                  |
| 2   | **Terrazzo**         | OSS           | 423                | MIT                 | v2.x plugins (Jun 2026)                              | Newer DTCG compiler, cleaner plugin API; small community — promising, not proven at enterprise scale               |
| 3   | **Tokens Studio**    | HS·ENT        | (Figma plugin)     | freemium/commercial | mature                                               | **Design-side** source-of-truth in Figma → exports DTCG JSON; complements SD, not a replacement for the build step |
| 4   | Cobalt (→ Terrazzo)  | —             | —                  | MIT                 | renamed                                              | Former name of Terrazzo; historical                                                                                |
| 5   | Theo (Salesforce)    | —             | ~2.6k              | BSD                 | **deprecated**                                       | Predecessor to Style Dictionary; avoid                                                                             |
| 6   | Specify              | ENT           | —                  | commercial          | active                                               | Hosted token platform; SaaS lock-in                                                                                |

**Head-to-head:** These occupy **different pipeline stages**: Tokens Studio _defines_ tokens in Figma → exports DTCG JSON → Style Dictionary _builds_ platform code. So Tokens Studio is a potential _addition_ (design source), not a replacement for SD. The only true build-side rival is **Terrazzo** — cleaner plugin API, full DTCG — but at ~420 stars vs SD's 4.7k and Adobe/enterprise adoption, it's an unnecessary risk when SD v5 already has first-class DTCG and is wired. The important 2026 fact: the **W3C DTCG spec reached its first stable version (Oct 2025)** with SD, Terrazzo, and Tokens Studio all as reference implementations — so tokens are now portable JSON regardless of build tool, which de-risks staying on SD.

**Recommendation:** **KEEP.** Style Dictionary stays; **ensure token source files use the stable W3C DTCG format** (portable, future-proofs against any later build-tool swap to Terrazzo). Optionally add **Tokens Studio** as the _design-side_ authoring source if designers want Figma-driven tokens (net-new design workflow, not a code dep). **Fit: 5/5.** **ADR impact:** small note "adopt W3C DTCG token format on SD" in the design-tokens ADR.

---

## Category verdict table

| Item          | Current                                   | Recommendation                                                                                     | Net-new deps to add              | ADR impact                      | Priority |
| ------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------- | -------- |
| Linter        | ESLint 9 + 10 local rules                 | **KEEP+HARDEN** — only linter that runs our rules; Oxlint optional fast pass when JS-plugin API GA | (opt) oxlint                     | Linter-speed ADR (optional)     | **P0**   |
| Formatter     | none                                      | **ADOPT → Prettier** + `eslint-config-prettier`                                                    | prettier, eslint-config-prettier | Adopt-formatter ADR             | **P0**   |
| CI platform   | GitHub Actions (dormant)                  | **KEEP+HARDEN** — activate workflows; Dagger-wrap steps for host portability                       | (opt) dagger                     | CI-activation + portability ADR | **P0**   |
| Dead-code     | knip 6                                    | **KEEP** — rivals archived → knip; make hard CI fail                                               | —                                | none                            | **P1**   |
| Duplication   | jscpd 5                                   | **KEEP** — upgrade v5 (Rust); note single-maintainer                                               | —                                | none                            | **P1**   |
| Bundle/perf   | size-limit + lhci + analyzer + react-scan | **KEEP ALL+HARDEN** — size-limit & lhci as hard gates w/ committed budgets                         | (opt) size-limit-action          | Perf-budget ADR                 | **P1**   |
| Release       | changesets                                | **KEEP** — activate `release.yml`; changelog-only for app tenants                                  | —                                | (covered by CI-activation)      | **P1**   |
| Git hooks     | husky 9                                   | **KEEP now; add lint-staged; lefthook at scale**                                                   | lint-staged (opt lefthook)       | tooling note                    | **P1**   |
| Design tokens | style-dictionary 5                        | **KEEP** — move sources to W3C DTCG; opt Tokens Studio design-side                                 | —                                | DTCG-format note                | **P2**   |

## Which dormant `/ship` gates must become HARD CI fails for enterprise

The pivot's core CI action: **the local `/ship` gates run today only on the operator's machine and CI is dormant.** For enterprise, every gate below must be a **blocking** check on protected branches (branch protection + required status checks), not a local courtesy:

| `/ship` gate                               | Today          | Enterprise CI status           | Owner workflow                |
| ------------------------------------------ | -------------- | ------------------------------ | ----------------------------- |
| typecheck / lint (incl. 10 security rules) | local          | **HARD FAIL**                  | `verify.yml`                  |
| **format (`prettier --check`)**            | _absent_       | **HARD FAIL (new)**            | `verify.yml`                  |
| tests + coverage floor                     | local          | **HARD FAIL**                  | `verify.yml`                  |
| production build                           | local          | **HARD FAIL**                  | `verify.yml`                  |
| gitleaks (secrets)                         | local          | **HARD FAIL**                  | `secrets-scan.yml`            |
| trivy + npm audit (CVEs)                   | local          | **HARD FAIL**                  | `sast.yml`                    |
| CodeQL SAST                                | dormant        | **HARD FAIL**                  | `codeql.yml`                  |
| knip (dead code)                           | local warn     | **HARD FAIL**                  | `verify.yml`                  |
| jscpd (duplication)                        | local          | **HARD FAIL**                  | `verify.yml`                  |
| complexity budget                          | local          | **HARD FAIL**                  | `verify.yml`                  |
| **size-limit (byte budget)**               | local          | **HARD FAIL**                  | `verify.yml`                  |
| **@lhci/cli assert (web-vitals budget)**   | local          | **HARD FAIL**                  | new `lhci.yml`                |
| scalability (unbounded-query)              | local          | **HARD FAIL**                  | `verify.yml`                  |
| wave-offs / findings-register open         | local          | **HARD FAIL**                  | `verify.yml`                  |
| tier / blueprint / db-structure gates      | local          | **HARD FAIL**                  | `verify.yml`                  |
| docker image build                         | `/ship --full` | **HARD FAIL**                  | `docker-build.yml`            |
| senior-code-reviewer                       | manual         | **NON-BLOCKING (advisory)**    | `senior-review.yml`           |
| UAT (Playwright)                           | manual         | **BLOCKING on release branch** | `uat.yml` / `preview-uat.yml` |
| release (changesets)                       | dormant        | **ON-MERGE automation**        | `release.yml`                 |

Activation requires: `ANTHROPIC_API_KEY` (senior-review), Actions minutes/billing unblocked, branch-protection required-checks configured, and adding the two **new** hard gates (Prettier format-check + lhci assert). This is the single highest-leverage P0 for the category.

---

## Sources

1. Biome vs ESLint vs Oxlint 2026 comparisons — PkgPulse, jsmanifest, BetterStack, pikvue. https://www.pkgpulse.com/guides/biome-vs-eslint-vs-oxlint-2026 · https://jsmanifest.com/biome-oxlint-comparison-2026 · https://betterstack.com/community/guides/scaling-nodejs/biome-eslint/
2. Oxlint JS plugins alpha (2026-03-11) — oxc.rs blog + VoidZero. https://oxc.rs/blog/2026-03-11-oxlint-js-plugins-alpha · https://voidzero.dev/posts/announcing-oxlint-js-plugins
3. ESLint — GitHub `eslint/eslint` (27.5k, MIT; 2026-07-11). https://github.com/eslint/eslint
4. Biome — GitHub `biomejs/biome` (25.4k, MIT/Apache-2.0, CLI v2.5.3 Jul 8 2026). https://github.com/biomejs/biome
5. Oxc/Oxlint — GitHub `oxc-project/oxc` (21.9k, MIT, oxlint v1.73/oxfmt v0.58 Jul 6 2026). https://github.com/oxc-project/oxc
6. Prettier — GitHub `prettier/prettier` (52.2k, MIT; 2026-07-11) + Prettier/Biome/dprint formatter comparison. https://github.com/prettier/prettier · https://www.pkgpulse.com/guides/best-code-formatting-tools-2026 · https://biomejs.dev/blog/biome-wins-prettier-challenge/
7. CI platform comparison 2026 — Northflank, JetBrains TeamCity blog, DeployHQ, agentdeals free-tier. https://northflank.com/blog/github-actions-alternatives · https://blog.jetbrains.com/teamcity/2026/03/best-ci-tools/
8. Dagger — GitHub `dagger/dagger` (16.1k, Apache-2.0; 2026-07-11). https://github.com/dagger/dagger
9. knip — GitHub `webpro-nl/knip` (11.7k, ISC, v6.26 Jul 10 2026); ts-prune/unimported archived → knip. https://github.com/webpro-nl/knip · https://knip.dev/explanations/comparison-and-migration
10. jscpd — GitHub `kucherenko/jscpd` (~5.5k, MIT; v5 Rust rewrite, v4.2 cross-format May 2026, single-maintainer). https://github.com/kucherenko/jscpd
11. size-limit vs bundlewatch — npm trends + GitHub (size-limit ~6.9k / 728k wk dl; bundlewatch ~441 / 167k). https://github.com/bundlewatch/bundlewatch · https://npmtrends.com/bundlemon-vs-bundlesize-vs-bundlewatch-vs-size-limit
12. Lighthouse CI — GitHub `GoogleChrome/lighthouse-ci` (7.0k, Apache-2.0, v0.15.1 Jun 2025). https://github.com/GoogleChrome/lighthouse-ci
13. react-scan — GitHub `aidenybai/react-scan` (21.6k, MIT; 2026-07-11). https://github.com/aidenybai/react-scan
14. changesets — GitHub `changesets/changesets` (12.1k, MIT); semantic-release `semantic-release/semantic-release` (23.9k, MIT); release-please `googleapis/release-please` (7.2k, Apache-2.0). https://github.com/changesets/changesets · https://github.com/semantic-release/semantic-release · https://github.com/googleapis/release-please · https://oleksiipopov.com/blog/npm-release-automation/
15. Git hooks comparison 2026 — Andy Madge, PkgPulse; husky ~8.1k, lefthook ~3.4k, pre-commit ~1.9k. https://www.andymadge.com/2026/03/10/git-hooks-comparison/ · https://github.com/evilmartians/lefthook · https://github.com/typicode/husky
16. Design tokens — W3C DTCG spec stable (Oct 2025); Style Dictionary `style-dictionary/style-dictionary` (4.7k, Apache-2.0, v5.5.0 Jun 2026); Terrazzo `terrazzoapp/terrazzo` (423, MIT); Tokens Studio (Figma, freemium). https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/ · https://github.com/style-dictionary/style-dictionary · https://github.com/terrazzoapp/terrazzo
