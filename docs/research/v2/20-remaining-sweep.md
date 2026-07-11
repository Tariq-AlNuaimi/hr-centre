# A.5 — Remaining-surface sweep (Enterprise Benchmark v2)

> The **complement** pass: surfaces none of C01–C15 own. Same 4-lens top-10 × head-to-head ×
> Recommendation methodology (`METHODOLOGY.md`). Ground truth: Next 16.2.9 + Prisma 7 + Postgres 17,
> **enterprise-only**, **deploy-per-tenant** (NO in-app multi-tenancy — "per-tenant" == "per-deploy"),
> **Docker-first / self-host default**, **Claude-first AI**, compose-now-k8s-later.
> Lens tags: `BT`=battle-tested · `HS`=highest-star · `ENT`=enterprise-grade · `OSS`=best pure OSS.
> Star counts are point-in-time (2026-07 unless a fresher as-of is cited). Cross-refs to C-files noted
> so we don't re-benchmark what they own (LLM cost → C07; SBOM → C11; OTel/analytics-obs → C10;
> secrets Vault/SOPS/Infisical → C09; MSW/visual-regression → C12; linter/formatter/CI → C13).

---

### 1. Documentation site (NET-NEW — none yet)

**One line:** A rendered docs _site_ over the repo's markdown/ADRs (search, versioning, nav). Current: raw `docs/*.md` + `docs/decisions/ADR-*.md`, read in-editor or on GitHub — **no site**.

**4-lens top-10 (docs frameworks)**

| #   | Candidate             | Lens      | Stars (2026-07)       | License     | Maturity / stack                 | One-line why-it-ranks                                                              |
| --- | --------------------- | --------- | --------------------- | ----------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | **Fumadocs**          | HS·OSS    | ~10.3k (Jan 2026)[1]  | MIT         | 2023 · Next.js App-Router native | Next-16/RSC-native, shadcn-style fork pattern, best OpenAPI-in-Next; **our stack** |
| 2   | **Docusaurus** (Meta) | BT·HS·ENT | ~62k [2]              | MIT         | 2017 · React/MDX, own build      | The battle-tested default — native versioning + i18n, huge plugin base             |
| 3   | **Starlight** (Astro) | BT·OSS    | ~7k (Astro) [3]       | MIT         | 2023 · Astro islands             | Fastest static builds, built-in search + i18n; separate Astro toolchain            |
| 4   | **Nextra** (Vercel)   | HS·OSS    | ~13k [4]              | MIT         | 2020 · Next.js/MDX               | Next-based, opinionated; powers shadcn/SWR docs; less "drop into existing app"     |
| 5   | **VitePress**         | BT·HS     | ~14k [5]              | MIT         | 2022 · Vite/Vue                  | Excellent DX + speed, but Vue/Vite — off our React/Next rail                       |
| 6   | **Mintlify**          | ENT       | (commercial; OSS CLI) | proprietary | SaaS · hosted                    | Best polished OpenAPI docs + AI search; **hosted SaaS — fails self-host pivot**    |
| 7   | **MkDocs + Material** | BT·OSS    | ~21k / ~24k [6]       | MIT / MIT   | 2014 · Python                    | Ubiquitous, dead-simple, superb search; Python toolchain, non-JS                   |
| 8   | **Docsify**           | OSS       | ~28k [7]              | MIT         | 2017 · runtime MD, no build      | Zero-build, but client-render (weak SEO), aging                                    |
| 9   | **Astro (raw) + MDX** | OSS       | ~50k (Astro) [3]      | MIT         | 2021                             | DIY docs; more work than Starlight for the same result                             |
| 10  | **GitBook / Docsly**  | ENT       | (commercial)          | proprietary | SaaS                             | Enterprise hosted docs; lock-in, not self-host                                     |

**Head-to-head.** The pivot (self-host, Docker, one toolchain) eliminates the SaaS tier (Mintlify/GitBook) and the off-rail runtimes (VitePress=Vue, MkDocs/Material=Python, Starlight=separate Astro build). That leaves the React/Next set: **Docusaurus** (most battle-tested, native versioning + i18n, but its own webpack build — a _second_ build system beside our Next app) vs **Fumadocs** vs **Nextra**. **Fumadocs is the standout for this repo**: it's Next-App-Router/RSC-native (mounts as a route group _inside the existing Next app_ — one build, one Docker image, no second toolchain), ships a shadcn-style "own-the-source" fork model that matches our Tailwind/shadcn/Radix stack exactly, and has the strongest Next-native OpenAPI-docs story (ties into surface #7). Its only real gap vs Docusaurus is out-of-box doc _versioning_, which a deploy-per-tenant repo barely needs. **Docusaurus** stays the fallback if a tenant demands heavy versioned/i18n public docs.

**Recommendation: ADD-AS-OPTION → Fumadocs (Fit 5/5).** Don't hard-wire a docs site into the base template — most forks read `docs/` in-editor. Ship it as a **`/scale-up` recipe** ("publish a docs site"): a Fumadocs route group (`app/(docs)`) that renders the existing `docs/*.md` + ADRs, gated behind auth for internal-only, built into the same Docker image. Docusaurus as the "public versioned docs" alternative. **ADR impact:** new `/scale-up` row + a note-level ADR; net-new deps are `fumadocs-core`/`fumadocs-ui`/`fumadocs-mdx` (MIT, React — on-rail, no Ask-before-dep concern).

---

### 2. DX / onboarding / toolchain pinning (PARTIAL — Make + SessionStart hook; no toolchain pin, no devcontainer)

**One line:** Reproducible "clone → running in one step" — toolchain version pinning, a task runner, a containerized dev env, env-var bootstrap. Current: `Makefile` (`make setup`), a SessionStart hook (`.env`/deps/client bootstrap), `.env.example`, `docker compose up -d db`. **No Node/tool version pin beyond `package.json` engines, no `.devcontainer`, no `.tool-versions`.**

**4-lens top-10 (toolchain pin + task runner + dev env)**

| #   | Candidate                 | Lens      | Stars (2026-07)       | License    | Category                  | One-line why-it-ranks                                                                 |
| --- | ------------------------- | --------- | --------------------- | ---------- | ------------------------- | ------------------------------------------------------------------------------------- |
| 1   | **mise** (jdx)            | HS·OSS    | ~27.6k (May 2026) [8] | MIT        | version mgr + tasks + env | Single Rust binary; pins Node/tools, reads `.tool-versions`/`.nvmrc`, has tasks + env |
| 2   | **Dev Containers** (spec) | BT·ENT    | (MS spec; VS Code/CI) | MIT        | containerized dev env     | Editor-agnostic reproducible env; GitHub Codespaces + Claude-web-friendly             |
| 3   | **asdf**                  | BT·HS     | ~25k [8]              | MIT        | version manager           | The incumbent; mise overtook its stars Feb 2026 and is faster — asdf now the fallback |
| 4   | **proto** (moonrepo)      | OSS       | ~1.5k                 | MIT        | version manager           | Rust, WASM plugins; newer, smaller ecosystem than mise                                |
| 5   | **Taskfile** (go-task)    | HS·OSS    | ~13k [9]              | MIT        | task runner               | YAML task runner, cross-platform (beats Make on Windows/quoting)                      |
| 6   | **just**                  | HS·OSS    | ~26k [10]             | CC0-1.0    | command runner            | Ergonomic `justfile`, great for recipe menus; not a build tool                        |
| 7   | **GNU Make**              | BT        | (ubiquitous)          | GPL        | task runner               | **Our current** — universal, but tab/quoting footguns, poor Windows story             |
| 8   | **direnv**                | BT·HS·OSS | ~14k [11]             | MIT        | per-dir env loader        | Auto-loads/unloads `.envrc` on `cd`; pairs with dotenvx for encrypted local secrets   |
| 9   | **dotenvx**               | OSS       | ~9k                   | BSD-3      | encrypted .env            | Encrypts `.env` at rest, key outside repo — hardens local secrets vs plaintext        |
| 10  | **Nix / devenv**          | ENT·OSS   | ~5k (devenv)          | MIT/Apache | hermetic dev env          | Fully reproducible, but steep learning curve — overkill for a Next app                |

**Head-to-head.** Three complementary slots, not one winner. **Toolchain pin:** **mise** is the clear 2026 default — it overtook asdf on stars in Feb 2026, is a single fast Rust binary, reads existing `.nvmrc`/`.tool-versions`, and folds a task runner + env-var management into the same file, so it can subsume much of what `Makefile` does. **Task runner:** our `Makefile` works but is fragile cross-platform; **just** (or **Taskfile**) is the modern ergonomic replacement — though if we adopt mise, its built-in `[tasks]` may make a separate runner redundant. **Dev env:** a **`.devcontainer`** is the highest-leverage add for _this_ repo specifically because the operator drives it from **Claude Code on the web / Codespaces** — a devcontainer gives every web session (and every IT-handoff dev) a byte-identical, pre-provisioned env (Node 24, Postgres, deps warm), which is exactly the reproducibility the "pushed-or-it-didn't-happen" ephemeral-container model already assumes. **Local secrets:** **direnv + dotenvx** hardens the plaintext `.env` without standing up a full secrets manager (Vault/Infisical live in C09 for deployed secrets).

**Recommendation: ADOPT (net-new) — devcontainer + mise; ADD-AS-OPTION — just/direnv (Fit 5/5).** (1) **Ship a `.devcontainer/`** (Node 24, Postgres service, post-create = `make setup`) — P1, biggest onboarding + web-session-reproducibility win, aligns the ephemeral-container reality with a declared image. (2) **Add `mise.toml`** pinning Node 24 + tooling so "which Node" is never ambiguous across web/local/CI/IT (P1). (3) Keep `Makefile` for now (it's wired into skills); offer **just/direnv+dotenvx** as `/scale-up` DX options. **ADR impact:** new ADR "reproducible dev env (devcontainer + mise)"; net-new is config-only (no npm runtime dep).

---

### 3. Data migration, seeding & anonymization (PARTIAL — Prisma migrate + a hand-written seed; no factories, no anonymization, no migration-safety tooling)

**One line:** Beyond `prisma migrate`: realistic/synthetic seed data, FK-valid factories, production→lower-env anonymization, and _safe_ schema-change patterns (expand-contract / zero-downtime). Current: `prisma/seed.ts` (hand-written), `prisma:migrate`, the `/migrate-from` skill (port data from a source Postgres). **No faker/factory layer, no data masking, no online-migration guardrail.**

**4-lens top-10 (seeding + factories + anonymization + migration safety)**

| #   | Candidate                       | Lens      | Stars (2026-07)   | License      | Slot                      | One-line why-it-ranks                                                                 |
| --- | ------------------------------- | --------- | ----------------- | ------------ | ------------------------- | ------------------------------------------------------------------------------------- |
| 1   | **@faker-js/faker**             | BT·HS·OSS | ~14k [12]         | MIT          | synthetic values          | The standard realistic-data generator; pair with a factory for FK-valid graphs        |
| 2   | **Prisma native seed**          | BT        | (Prisma 7)        | Apache-2.0   | seed runner               | **Our current** — `prisma db seed`; schema-aware but manual relations                 |
| 3   | **pgroll** (Xata)               | OSS·HS    | ~4k [13]          | Apache-2.0   | zero-downtime migrations  | Expand-contract for Postgres — dual-schema views, safe online DDL, instant rollback   |
| 4   | **Greenmask**                   | OSS       | ~2k [14]          | Apache-2.0   | anonymization/subset      | pg_dump-compatible masking + subsetting; the maintained Snaplet-anonymize successor   |
| 5   | **postgresql-anonymizer** (PGA) | BT·OSS    | ~1k               | PostgreSQL   | in-DB masking             | Declarative masking rules as an extension; dynamic masking for lower envs             |
| 6   | **reshape**                     | OSS       | ~2.6k             | MIT          | zero-downtime migrations  | Expand-contract migrator (abandoned-ish; pgroll is the livelier pick)                 |
| 7   | **snaplet/copycat**             | OSS       | ~0.6k             | MIT          | deterministic fake values | Deterministic faker (survives the Snaplet shutdown as a standalone lib)               |
| 8   | **drizzle-seed**                | OSS       | (Drizzle)         | Apache-2.0   | seed framework            | Deterministic seeding — Drizzle-coupled, off our Prisma rail                          |
| 9   | **Neosync**                     | —         | archived Aug 2025 | MIT (frozen) | synth+anon (DEAD)         | **Current-events catch — repo archived after Grow Therapy acquisition; do not adopt** |
| 10  | **Seedfast / Basecut**          | ENT       | (commercial)      | proprietary  | synth / subset+anon       | Positioned Snaplet successors; SaaS/commercial — off the self-host pivot              |

**Head-to-head.** Three distinct needs. **(a) Seeding:** keep Prisma's seed runner but add **@faker-js/faker** behind a tiny factory helper so seeds produce realistic, FK-valid graphs instead of hand-typed rows — low-cost, high-fidelity. **(b) Anonymization** (net-new, and enterprise-relevant the moment a tenant clones prod→staging): the field just churned hard — **Snaplet Seed shut down Aug 2024** and **Neosync was archived Aug 2025** after acquisition, so both formerly-default OSS picks are dead. The live, self-hostable survivor is **Greenmask** (pg_dump-compatible masking + subsetting, Apache-2.0) with **postgresql-anonymizer** as the in-DB-extension alternative. **(c) Migration safety:** `vercel.json`/startup runs `prisma migrate deploy` on every build, and CLAUDE.md already warns "keep migrations small, never drop a column the running version reads" — that's _expand-contract by convention_. **pgroll** makes it _enforced_: it applies migrations as dual-schema versions with views so old and new app versions run simultaneously, with instant rollback — the exact zero-downtime discipline a Docker-rolling-deploy enterprise wants. (gh-ost is MySQL; not applicable.)

**Recommendation: KEEP+HARDEN seed (add faker factory, Fit 5/5); ADD-AS-OPTION anonymization=Greenmask + migration-safety=pgroll (Fit 4/5).** (1) Add **@faker-js/faker** + a `prisma/factories.ts` helper as a dev-dependency (P1) — small, high-value. (2) Ship an **anonymization `/scale-up` recipe** (Greenmask container job: prod dump → masked → restore to lower env) — P2, but call it out now because the enterprise clone-prod-to-staging flow _needs_ it and the old defaults died. (3) Add a **pgroll `/scale-up` recipe** for tenants that require true zero-downtime DDL — P2; the migrate-at-startup convention stays the default. **ADR impact:** dev-dep ADR for faker; two `/scale-up` rows (Greenmask, pgroll); build-vs-buy ledger entries. Faker is a _dev_ dep, so no runtime-bundle/Ask-before concern.

---

### 4. Cost / FinOps visibility (NET-NEW — none yet)

**One line:** Making infra + LLM spend _visible_ per deploy. Current: none. Deploy-per-tenant means "per-tenant cost" == "per-deployment cost" (a whole Docker/Neon stack per tenant), which reframes the problem away from k8s namespace attribution. LLM cost metering is **owned by C07** — cross-ref, not re-benchmarked here.

**4-lens top-10 (infra cost visibility)**

| #   | Candidate                   | Lens       | Stars (2026-07)    | License     | Fit-to-pivot                  | One-line why-it-ranks                                                              |
| --- | --------------------------- | ---------- | ------------------ | ----------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| 1   | **Infracost**               | BT·HS·OSS  | ~11k [15]          | Apache-2.0  | ✅ shift-left in CI (IaC)     | Cost diff on Terraform/OpenTofu PRs _before_ deploy — the shift-left category lead |
| 2   | **OpenCost** (CNCF)         | BT·ENT·OSS | ~6.6k [15]         | Apache-2.0  | ⚠️ k8s-only                   | CNCF-incubating k8s cost attribution; **we're compose-not-k8s in v1** — defer      |
| 3   | **Komiser**                 | OSS        | ~4k                | Elastic-2.0 | ⚠️ cloud-inventory (AWS/GCP…) | Multi-cloud asset+cost inventory dashboard; Elastic license, cloud-account-shaped  |
| 4   | **Cloud Custodian**         | BT·OSS     | ~5.5k              | Apache-2.0  | ⚠️ policy/governance          | Rules-as-code cloud governance incl. cost policies; heavy, cloud-account-shaped    |
| 5   | **OptScale** (Hystax)       | OSS        | ~1.5k              | Apache-2.0  | ⚠️ cloud + ML cost            | FinOps + MLOps cost platform; more than a single-app deploy needs                  |
| 6   | **Vantage**                 | ENT        | (commercial)       | proprietary | ✅ ships OSS MCP servers      | Best managed FinOps + AI cost agent; SaaS, but its MCP servers are agent-friendly  |
| 7   | **cloud-carbon-footprint**  | OSS        | ~7k                | Apache-2.0  | ⚠️ sustainability angle       | Carbon + cost estimate from billing; ESG-reporting flavor                          |
| 8   | **Kubecost** (free tier)    | ENT        | (OpenCost-based)   | commercial  | ⚠️ k8s-only                   | OpenCost's commercial sibling; k8s — defer with OpenCost                           |
| 9   | **AWS/Neon native billing** | BT·ENT     | (provider)         | —           | ✅ zero-setup baseline        | Provider dashboards + budget alerts — the free starting point per deploy           |
| 10  | **PostHog LLM analytics**   | OSS        | (see #7 analytics) | MIT         | ⤷ cross-ref C07               | Token/cost dashboards for AI routes — folds into the analytics pick below          |

**Head-to-head.** k8s-attribution tools (**OpenCost/Kubecost**) are the FinOps default _for clusters_ — but we're compose-in-v1, so they defer with the k8s decision (they become the pick the moment WS pivots to k8s). Cloud-account inventory tools (**Komiser/Cloud Custodian/OptScale**) assume a multi-account cloud estate; a single-tenant Docker+Neon deploy is far smaller than their sweet spot, and Komiser's **Elastic-2.0** license is a redistribution snag for a template. That leaves the one tool that fits _now_: **Infracost** — it estimates cost _from the IaC diff in CI_ (OpenTofu is already the WS pick), so a PR that scales a Neon tier or adds a service shows its monthly delta before merge. It's the shift-left, gate-shaped fit that matches this repo's "gates not vibes" doctrine. For the actual dollar truth, **provider budget alerts** (Neon/Vercel/cloud) are the zero-cost baseline. LLM cost is the _other_ half and is owned by C07 (Langfuse cost dashboards + a gateway budget) — flag it here only as the cross-ref.

**Recommendation: ADD-AS-OPTION → Infracost in CI + provider budget alerts (Fit 4/5); DEFER OpenCost with k8s.** Ship an **Infracost CI check** as a dormant-until-IaC gate (activates when a fork adds the OpenTofu WS), plus a documented "set a provider budget alert per deploy" runbook step. Defer OpenCost/Kubecost to the k8s milestone. Do **not** adopt cloud-account inventory tools (wrong shape + Elastic-license risk). **ADR impact:** small ADR "cost visibility (Infracost CI, deferred OpenCost)"; a runbook line (surface #5) for budget alerts; no npm dep.

---

### 5. DR / runbooks / status page / chaos (NET-NEW — sre _agent_ exists, no runbook _system_)

**One line:** Operational-readiness _artifacts_: incident runbooks, backup/restore drills, on-call/escalation, a status page, and chaos/game-days. Current: an **`sre` role-agent** (reviews operational readiness) but **no runbook docs, no status page, no restore drill, no chaos harness**. Backup tooling (WAL-G) is owned by C02; this surface is the _runbook + status + chaos_ layer on top.

**4-lens top-10 (status page + uptime + chaos + runbook practice)**

| #   | Candidate                              | Lens      | Stars (2026-07) | License     | Slot                      | One-line why-it-ranks                                                             |
| --- | -------------------------------------- | --------- | --------------- | ----------- | ------------------------- | --------------------------------------------------------------------------------- |
| 1   | **Uptime Kuma**                        | HS·OSS·BT | ~84k [16]       | MIT         | uptime + status page      | The dominant self-hosted monitor; single container, built-in status + incidents   |
| 2   | **Gatus**                              | OSS·BT    | ~7k [16]        | Apache-2.0  | config-as-code status     | Health checks + status page **as YAML in git** — matches our "everything-in-repo" |
| 3   | **Chaos Toolkit**                      | OSS·BT    | ~2k             | Apache-2.0  | chaos experiments-as-code | Declarative experiments (Actions+Probes); non-k8s-friendly, CI-runnable           |
| 4   | **Toxiproxy** (Shopify)                | BT·OSS    | ~11k            | MIT         | network chaos             | Deterministic latency/failure injection at the TCP proxy — great for compose      |
| 5   | **Cachet**                             | BT        | ~14k [16]       | BSD-3       | status page               | Historic status-page leader — **v3 rebuild; last release 2023** (transitional)    |
| 6   | **Statping-ng**                        | OSS       | ~2k             | GPL-3.0     | status page               | Uptime-Kuma-like fork; UI feels dated                                             |
| 7   | **Litmus** (CNCF)                      | ENT·OSS   | ~4.7k           | Apache-2.0  | k8s chaos                 | Broad k8s experiment library; **k8s-only — defer with k8s**                       |
| 8   | **Chaos Mesh** (CNCF)                  | ENT·OSS   | ~7k             | Apache-2.0  | k8s chaos                 | CNCF k8s chaos; defer with k8s                                                    |
| 9   | **Upptime**                            | OSS·HS    | ~15k            | MIT         | GitHub-Actions status     | Status page via GH Actions + Issues; zero-infra, but GitHub-coupled               |
| 10  | **incident.io / Rootly / FireHydrant** | ENT       | (commercial)    | proprietary | incident mgmt             | Full on-call + runbook + retro platforms; SaaS — for a mature tenant, not v1      |

**Head-to-head.** The single biggest gap isn't a _tool_, it's the **absence of runbook + drill docs** — the `sre` agent can _review_ readiness but there's nothing for it to review. That's a `docs/runbooks/` template set (incident response, backup/restore drill, rollback, on-call/escalation), not a dependency. For the _status/uptime_ slot, the choice is **Uptime Kuma** (fastest to value — one container, built-in status page + incident banners + 84k-star maturity) vs **Gatus** (health-as-YAML-in-git, which matches this repo's config-as-code ethos but lacks incident management + a config UI). Given deploy-per-tenant, **Gatus** is the more idiomatic fit (checks live in the repo, ship with the image) while **Uptime Kuma** is the better standalone ops dashboard. For _chaos_, skip the k8s tools (Litmus/Chaos Mesh) in v1; **Toxiproxy** (network fault injection into compose) + **Chaos Toolkit** (experiments-as-code in CI) are the compose-era picks for a quarterly game-day. **Cachet is a current-events caution** — mid-rebuild, last release 2023.

**Recommendation: ADOPT (net-new) `docs/runbooks/` + restore-drill (Fit 5/5); ADD-AS-OPTION status=Gatus, chaos=Toxiproxy (Fit 4/5).** (1) **Ship a `docs/runbooks/` template** (incident-response, backup/restore drill, rollback, escalation) — P1, cheap, and it's the artifact the `sre` agent + `/deploy` should trace against; wire a "restore-drill green" checklist into `/handoff`. (2) **Gatus** as a `/scale-up` "status page" recipe (config-as-code, ships in the image); Uptime Kuma as the standalone-dashboard alternative. (3) **Toxiproxy + Chaos Toolkit** as a `/scale-up` "game-day" recipe. **ADR impact:** new ADR "operational runbooks + DR drills"; `/scale-up` rows; **no npm dep** (docs + containers). This is the highest-value _governance_ gap after docs.

---

### 6. Compliance-evidence automation (NET-NEW — audit log exists, no evidence pipeline)

**One line:** Turning controls + audit data into SOC2/ISO evidence (policy management, control mapping, evidence collection, cloud-config audit). Current: a strong **application audit log** (`auditExtension`, tamper-scrubbed) and `SECURITY.md` — but **no framework mapping, no evidence collection, no policy register**. Enterprise-only pivot makes this genuinely in-scope.

**4-lens top-10 (compliance / GRC automation)**

| #   | Candidate                       | Lens      | Stars (2026-07) | License              | Model                         | One-line why-it-ranks                                                                 |
| --- | ------------------------------- | --------- | --------------- | -------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| 1   | **Prowler**                     | BT·HS·OSS | ~13k [17]       | Apache-2.0           | cloud posture scanner         | Widely-used cloud security/compliance scanner — CIS/SOC2/ISO/PCI checks as code       |
| 2   | **Comp AI** (trycomp)           | HS·OSS    | ~1.6k [18]      | AGPL-3.0 (open-core) | Vanta/Drata OSS alt           | AI-native evidence collection + policies for SOC2/ISO/HIPAA/GDPR; newest, fast-moving |
| 3   | **Probo** (getprobo)            | OSS       | ~1k             | (self-host GRC)      | GRC lifecycle                 | Self-host risk/control/vendor/access-review platform; broad GRC coverage              |
| 4   | **Trestle** (OSCAL-Compass)     | ENT·OSS   | ~222 [19]       | Apache-2.0           | compliance-as-code (OSCAL)    | NIST-OSCAL authoring/validation — the standards-native, air-gap-friendly path         |
| 5   | **OSCAL** (NIST standard)       | ENT       | (spec)          | public domain        | machine-readable controls     | The interchange format enterprises/FedRAMP increasingly require — target, not tool    |
| 6   | **Openlane** (theopenlane)      | OSS       | ~267            | (source-avail)       | Vanta alt, 12+ frameworks     | Fully-OSS control modeling; young, small community                                    |
| 7   | **comply** (StrongDM)           | OSS       | ~1.5k           | Apache-2.0           | SOC2 policy/ticket automation | Markdown policies + audit tickets as code; maintenance has cooled                     |
| 8   | **Cloud Custodian**             | BT·OSS    | ~5.5k           | Apache-2.0           | policy-as-code governance     | Continuous cloud-config compliance rules (also FinOps, surface #4)                    |
| 9   | **Vanta / Drata / Secureframe** | ENT       | (commercial)    | proprietary          | managed compliance SaaS       | The market default (SLA/auditor network); SaaS — data leaves the tenant               |
| 10  | **osquery + Fleet**             | BT·OSS    | ~22k / ~3k      | Apache/MIT           | endpoint evidence             | Host/endpoint inventory + posture evidence; infra-side, complements the above         |

**Head-to-head.** These split by layer. **Cloud-config posture** (**Prowler**, **Cloud Custodian**) scans the _infrastructure_ against CIS/SOC2/ISO controls — mature, Apache-2.0, CI-runnable, and the cheapest first win: point Prowler at the deploy's cloud account and it emits control-pass/fail evidence. **Full GRC platforms** (**Comp AI**, **Probo**, **Openlane**) manage _policies + controls + evidence collection_ end-to-end as self-hostable Vanta alternatives — **Comp AI** is the highest-momentum OSS pick but its **AGPL-3.0 / open-core** model needs a redistribution check for a template (its enterprise bits are commercial). **Standards-native** (**Trestle/OSCAL**) is the right long-term target for any tenant facing FedRAMP/gov requirements (machine-readable, air-gappable) but is heavier authoring. The **SaaS incumbents (Vanta/Drata) fail the self-host/data-sovereignty pivot** by definition. The **highest-leverage cheap move for _this_ repo** is neither a platform nor a scanner — it's an **audit-log → evidence pipeline**: the tamper-scrubbed `auditExtension` already captures who-did-what; a scheduled export that maps audit events + `/ship` gate results (SBOM freshness, security-scan pass, dependency audit) into an evidence bundle turns _artifacts we already produce_ into _audit evidence_, with zero new platform.

**Recommendation: ADOPT (net-new) an audit→evidence export (Fit 5/5); ADD-AS-OPTION Prowler CI scan + Comp AI/Probo self-host (Fit 3/5); target OSCAL for gov tenants.** (1) **Build a `/compliance-evidence` seam** that exports the audit log + `/ship` gate results (SBOM, scan pass/fail, dependency audit, action-pin status) into a dated evidence bundle — P2, but uniquely cheap because it reuses existing artifacts, and it's the enterprise differentiator. (2) **Prowler** as a `/scale-up` "cloud posture scan" CI recipe. (3) **Comp AI** (verify AGPL/open-core terms) or **Probo** as the self-host GRC platform recommendation when a tenant is actively pursuing SOC2; **Trestle/OSCAL** for gov/FedRAMP. **ADR impact:** new ADR "compliance evidence automation"; build-vs-buy ledger entry for the export seam; `/scale-up` rows.

---

### 7. Other genuinely-uncovered surfaces (compact 4-lens)

Surfaces no C-file owns, benchmarked tighter. Each = one-liner + top picks + verdict.

**7a. OpenAPI + API contract testing (NET-NEW).** The repo is REST+zod (ADR-012) with an `/api/v1` machine seam (ADR-013) but ships **no OpenAPI spec and no contract tests** — machine consumers integrate blind.

| #   | Candidate                          | Lens   | Stars (2026-07) | License | Slot                         | Why-it-ranks                                                                  |
| --- | ---------------------------------- | ------ | --------------- | ------- | ---------------------------- | ----------------------------------------------------------------------------- |
| 1   | **zod-openapi** (samchungy)        | HS·OSS | ~1.3k [20]      | MIT     | zod→OpenAPI 3.1              | v6; generates spec from the zod schemas we _already write_ — zero duplication |
| 2   | **@asteasolutions/zod-to-openapi** | OSS    | ~2k [20]        | MIT     | zod→OpenAPI                  | The other mature zod→OpenAPI generator                                        |
| 3   | **Scalar**                         | HS·OSS | ~11k            | MIT     | API reference UI             | Modern self-hostable API docs from a spec (Mintlify-quality, OSS)             |
| 4   | **Redocly CLI**                    | BT·OSS | ~2k             | MIT     | lint + docs                  | Spec linting to a standard + static docs                                      |
| 5   | **Schemathesis**                   | OSS·BT | ~2.5k           | MIT     | property-based contract test | Fuzzes the API against its OpenAPI spec — finds contract drift automatically  |
| 6   | **Pact**                           | BT·ENT | ~ (multi-repo)  | MIT     | consumer-driven contracts    | The CDC standard; heavier, for multi-service estates                          |

_Verdict:_ **ADOPT → zod-openapi + Scalar; ADD-AS-OPTION Schemathesis (Fit 5/5).** Because we already validate every route with zod, **zod-openapi** gives a spec for free, **Scalar** renders it (fold into the Fumadocs site, #1), and **Schemathesis** turns the spec into an automatic contract-drift test in CI. Highest ROI of the extras — it's near-zero-cost given the existing zod boundary. P1. Fits C06 (zod) + C12 (testing) but neither owns it. ADR: small, + `/scaffold-entity` could emit OpenAPI metadata.

**7b. Feature-flag governance (PARTIAL — a cloud-only scale-up recipe).** `/scale-up` offers Vercel **Edge Config** (SaaS, off the self-host pivot) or PostHog for flags — **no self-hostable, auditable, vendor-neutral flag layer.**

| #   | Candidate              | Lens       | Stars (2026-07) | License                | Why-it-ranks                                                             |
| --- | ---------------------- | ---------- | --------------- | ---------------------- | ------------------------------------------------------------------------ |
| 1   | **OpenFeature** (CNCF) | ENT·OSS    | ~1.5k           | Apache-2.0             | Vendor-neutral flag _standard_ + SDKs — the abstraction to code against  |
| 2   | **Flipt**              | HS·OSS     | ~4.5k           | GPL-3.0                | v2 git-native (flags in git, no DB) — matches config-as-code + self-host |
| 3   | **Unleash**            | BT·ENT·OSS | ~12k            | Apache-2.0 (open-core) | Enterprise governance: change-request approvals, audit log, SSO          |
| 4   | **GrowthBook**         | HS·OSS     | ~6k             | MIT                    | Flags + experiments + analytics, permissive                              |
| 5   | **GO Feature Flag**    | OSS        | ~1.5k           | MIT                    | Lightweight, OpenFeature-native, file/GitOps config                      |

_Verdict:_ **ADD-AS-OPTION → code against OpenFeature; self-host Flipt (git-native) or Unleash (governance) (Fit 4/5).** Replace the Edge-Config-only recipe's _default_ with a self-hostable, **auditable** flag layer — flag changes should hit the audit log like any other change (enterprise governance). Keep the abstraction (OpenFeature) so the backend is swappable. P2. ADR + `/scale-up` rewrite.

**7c. Product / privacy-first analytics (NET-NEW; distinct from C10 ops-observability).** No usage analytics; C10 owns _operational_ telemetry (OTel/Sentry), not _product_ analytics.

| #   | Candidate     | Lens       | Stars (2026-07) | License  | Why-it-ranks                                                                                                      |
| --- | ------------- | ---------- | --------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | **PostHog**   | HS·ENT·OSS | ~31k [21]       | MIT      | All-in-one: analytics + flags + session replay + **LLM analytics** (ties C07); self-host now community-build-only |
| 2   | **Umami**     | HS·OSS     | ~28k [21]       | MIT      | Lightweight privacy-first web analytics, MIT (cleanest license), simple self-host                                 |
| 3   | **Plausible** | HS·OSS     | ~23k            | AGPL-3.0 | Privacy-first, cookieless; AGPL (redistribution caution)                                                          |
| 4   | **Matomo**    | BT·ENT     | ~20k            | GPL-3.0  | Most feature-complete GA replacement; heavier                                                                     |
| 5   | **OpenPanel** | OSS        | ~4k             | AGPL-3.0 | PostHog-lite, self-host parity; younger, AGPL                                                                     |

_Verdict:_ **ADD-AS-OPTION → Umami (privacy-first default) or PostHog (if flags+LLM-analytics wanted) (Fit 4/5).** For a Restricted-data enterprise app, **Umami** (MIT, cookieless, self-host) is the safe default; **PostHog** if a fork wants flags + LLM cost analytics + replay in one box (note: PostHog self-host is now community-build-only). Avoid AGPL tools if the template is redistributed to tenants who won't self-host the analytics box. P2, `/scale-up` row.

**7d. License / OSS-compliance reporting (PARTIAL — SBOM in C11, no license _policy_).** C11 owns SBOM generation (`@cyclonedx/cyclonedx-npm`); it does **not** own _license-policy enforcement_ (deny GPL/AGPL in a proprietary tenant build).

| #   | Candidate                                         | Lens      | Stars (2026-07) | License     | Why-it-ranks                                                           |
| --- | ------------------------------------------------- | --------- | --------------- | ----------- | ---------------------------------------------------------------------- |
| 1   | **Syft** (Anchore)                                | BT·HS·OSS | ~7k             | Apache-2.0  | SBOM + license extraction; already adjacent to our Trivy/Grype         |
| 2   | **ScanCode Toolkit**                              | BT·OSS    | ~2.5k [22]      | Apache-2.0  | Deepest license _detection_ engine (edge cases, dual-license)          |
| 3   | **OSS Review Toolkit (ORT)**                      | ENT·OSS   | ~1.8k           | Apache-2.0  | Full policy engine: scan → evaluate against allow/deny policy → report |
| 4   | **license-checker / license-checker-rseidelsohn** | OSS       | ~1.5k           | BSD         | npm-native quick license gate                                          |
| 5   | **FOSSA / Black Duck**                            | ENT       | (commercial)    | proprietary | Best databases for edge cases; SaaS                                    |

_Verdict:_ **ADD-AS-OPTION → a license-policy gate (license-checker in `/ship`, ORT/ScanCode for depth) (Fit 4/5).** Add a **license allowlist gate** to `/ship` (fast: `license-checker` deny-list; deep: ORT/ScanCode) so a tenant's proprietary build can't silently pull AGPL. Complements the existing SBOM (C11) — SBOM says _what_, this says _is it allowed_. P2. ADR-041 (supply-chain) addendum.

**7e. Internal developer portal / Backstage (NET-NEW).** Service catalog / golden-path portal.

| #   | Candidate                    | Lens      | Stars (2026-07) | License     | Why-it-ranks                                                        |
| --- | ---------------------------- | --------- | --------------- | ----------- | ------------------------------------------------------------------- |
| 1   | **Backstage** (Spotify/CNCF) | BT·HS·ENT | ~30k            | Apache-2.0  | The IDP standard; catalog + scaffolder + TechDocs — but heavyweight |
| 2   | **Port**                     | ENT       | (commercial)    | proprietary | Low-code managed IDP                                                |
| 3   | **Cortex**                   | ENT       | (commercial)    | proprietary | Service-quality-focused IDP                                         |

_Verdict:_ **DEFER (Fit 2/5).** Backstage is a _fleet-of-services_ tool; a **single-app, deploy-per-tenant** template is the wrong shape for it (a catalog of one). The _golden-path scaffolder_ value it provides, we already have via `/scaffold-entity` + `/quickstart` + the skill lifecycle. Reconsider only if the org runs many forks and wants one catalog across them — an org-level concern, not a template concern. No action in v1/v2.

---

## Category verdict table

| Surface                      | Current                       | Recommendation                                                               | Net-new to add                              | ADR impact                               | Priority |
| ---------------------------- | ----------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------- | -------- |
| Docs site                    | raw `docs/*.md`               | **ADD-AS-OPTION → Fumadocs** (`/scale-up`); Docusaurus alt                   | `fumadocs-*` (MIT, on-rail)                 | new `/scale-up` + note ADR               | **P1**   |
| DX / dev env                 | Make + SessionStart hook      | **ADOPT devcontainer + mise**; just/direnv+dotenvx optional                  | `.devcontainer/`, `mise.toml` (config-only) | new ADR (reproducible env)               | **P1**   |
| Seeding                      | Prisma seed (manual)          | **KEEP+HARDEN** (add `@faker-js/faker` factory)                              | faker (dev-dep)                             | dev-dep ADR                              | **P1**   |
| DB anonymization             | none                          | **ADD-AS-OPTION → Greenmask** (`/scale-up`)                                  | container/job only                          | `/scale-up` + ledger                     | **P2**   |
| Migration safety             | migrate-at-startup convention | **ADD-AS-OPTION → pgroll** (`/scale-up`)                                     | container only                              | `/scale-up` + ledger                     | **P2**   |
| Cost / FinOps                | none                          | **ADD-AS-OPTION → Infracost CI + budget alerts**; defer OpenCost (k8s)       | Infracost (CI)                              | small ADR                                | **P2**   |
| Runbooks / DR                | `sre` agent, no docs          | **ADOPT `docs/runbooks/` + restore-drill**; wire into `/handoff`             | docs only                                   | new ADR (ops runbooks)                   | **P1**   |
| Status page / chaos          | none                          | **ADD-AS-OPTION → Gatus (status), Toxiproxy+Chaos Toolkit (game-day)**       | container only                              | `/scale-up` rows                         | **P2**   |
| Compliance evidence          | audit log, no pipeline        | **ADOPT audit→evidence export**; Prowler CI + Comp AI/Probo self-host option | export seam + containers                    | new ADR + ledger                         | **P2**   |
| OpenAPI + contract test      | none (REST+zod)               | **ADOPT zod-openapi + Scalar; option Schemathesis**                          | `zod-openapi` (MIT)                         | small ADR, `/scaffold-entity` emits spec | **P1**   |
| Feature-flag governance      | Edge Config recipe (SaaS)     | **ADD-AS-OPTION → OpenFeature + Flipt/Unleash self-host**                    | container + SDK                             | ADR + `/scale-up` rewrite                | **P2**   |
| Product analytics            | none                          | **ADD-AS-OPTION → Umami (default) / PostHog**                                | container only                              | `/scale-up` row                          | **P2**   |
| License-policy reporting     | SBOM only (C11)               | **ADD-AS-OPTION → license-policy gate in `/ship`**                           | `license-checker` (dev)                     | ADR-041 addendum                         | **P2**   |
| Developer portal (Backstage) | `/scaffold-*` skills          | **DEFER** — wrong shape for single-app deploy-per-tenant                     | none                                        | none                                     | —        |

**Current-events catches (2025–2026):**

- **Snaplet Seed shut down (Aug 2024)** and **Neosync archived (Aug 30 2025)** — the two former default OSS seed/anonymization tools are **dead**; do not adopt. Live successors: **Greenmask** (anonymize), **@faker-js/faker + copycat** (generate). [12][14]
- **Helicone acquired by Mintlify (Mar 2026) → maintenance mode** — for LLM cost (C07), prefer Langfuse; Helicone OSS proxy still self-hostable but frozen-ish. [23]
- **PostHog self-hosting is now community-build-only** — full-feature self-host is no longer first-class; weigh vs Umami if true self-host parity matters. [21]
- **Cachet mid-rebuild (last release 2023, v3 pending)** — pick Uptime Kuma or Gatus for a status page today, not Cachet. [16]
- **Comp AI is AGPL-3.0 open-core** and several analytics/flag tools are **AGPL** (Plausible, OpenPanel, Flipt=GPL, Komiser=Elastic-2.0) — verify redistribution terms before baking any into a template shipped to tenants; prefer MIT/Apache where a permissive equal exists (Umami, Uptime Kuma, Gatus, Infracost). [18][21]

---

## Sources

1. Fumadocs — GitHub `fuma-nama/fumadocs` (~10.3k ⭐ Jan 2026, MIT, Next-App-Router native); fumadocs.dev/docs/comparisons; PkgPulse "Fumadocs vs Nextra v4 vs Starlight 2026". 2026-07.
2. Docusaurus — GitHub `facebook/docusaurus` (~62k ⭐, MIT); pkgpulse.com best-documentation-frameworks-2026. 2026-07.
3. Starlight / Astro — `withastro/starlight` (~7k, part of Astro ~50k ⭐, MIT); Docsio "Starlight review 2026". 2026-07.
4. Nextra — GitHub `shuding/nextra` (~13k ⭐, MIT, Vercel). 2026-07.
5. VitePress — GitHub `vuejs/vitepress` (~14k ⭐, MIT). 2026-07.
6. MkDocs / Material for MkDocs — `mkdocs/mkdocs` (~21k), `squidfunk/mkdocs-material` (~24k), MIT. 2026-07.
7. Docsify — GitHub `docsifyjs/docsify` (~28k ⭐, MIT). 2026-07.
8. mise vs asdf — `jdx/mise` (~27.6k ⭐ May 2026, MIT), `asdf-vm/asdf` (~25k ⭐), mise overtook asdf Feb 23 2026 (jdx/mise Discussion #7967); Better Stack "Mise vs asdf". 2026-07.
9. go-task/Taskfile — GitHub `go-task/task` (~13k ⭐, MIT). 2026-07.
10. just — GitHub `casey/just` (~26k ⭐, CC0-1.0). 2026-07.
11. direnv — GitHub `direnv/direnv` (~14k ⭐, MIT); dotenvx (~9k, BSD-3); DEV "direnv + dotenvx" pattern. 2026-07.
12. @faker-js/faker — GitHub `faker-js/faker` (~14k ⭐, MIT). 2026-07.
13. pgroll — GitHub `xataio/pgroll` (~4k ⭐, Apache-2.0, expand-contract Postgres migrations). 2026-07.
14. Greenmask / Snaplet / Neosync status — Seedfast blog "Database Seeding 2026" + "Neosync Alternative" (Snaplet Seed shut down Aug 31 2024; Neosync archived Aug 30 2025); Greenmask Apache-2.0 pg_dump masking. 2026-07.
15. Infracost — GitHub `infracost/infracost` (~11k ⭐, Apache-2.0, shift-left IaC cost); OpenCost `opencost/opencost` (~6.6k ⭐, Apache-2.0, CNCF, k8s); Holori "Best Open Source FinOps Tools". 2026-07.
16. Status pages — Uptime Kuma `louislam/uptime-kuma` (~84k ⭐, MIT); Gatus `TwiN/gatus` (~7k, Apache-2.0, config-as-code); Cachet (~14k, v3 rebuild, last release 2023); Selfhosted Guides "Uptime Kuma vs Gatus vs Statping-ng"; openstatus.dev "Best Open Source Status Page 2026". 2026-07.
17. Prowler — GitHub `prowler-cloud/prowler` (~13k ⭐, Apache-2.0, CIS/SOC2/ISO/PCI). 2026-07.
18. Comp AI — GitHub `trycompai/comp` (~1.6k ⭐, AGPL-3.0 open-core, ~700 customers); Help Net Security "Comp AI open-source compliance" (Apr 2026); soc2auditors.org review. 2026-07.
19. Trestle / OSCAL — GitHub `oscal-compass/compliance-trestle` (~222 ⭐, Apache-2.0, NIST OSCAL); Openlane (~267 ⭐). 2026-07.
20. zod→OpenAPI — `samchungy/zod-openapi` (v6, MIT, ~1.3k), `asteasolutions/zod-to-openapi` (~2k, MIT); Scalar (~11k, MIT); Schemathesis (property-based OpenAPI testing). 2026-07.
21. Analytics — PostHog `PostHog/posthog` (~31k ⭐, MIT, self-host community-build-only); Umami `umami-software/umami` (~28k ⭐, MIT); Plausible (AGPL-3.0); Matomo (GPL-3.0); openpanel.dev + PostHog "best open-source analytics" comparisons. 2026-07.
22. License compliance — ScanCode `aboutcode-org/scancode-toolkit` (~2.5k ⭐, Apache-2.0); Syft `anchore/syft` (Apache-2.0, SBOM+licenses); OSS Review Toolkit (ORT); AppSecSanta "License Compliance Scanner 2026". 2026-07.
23. LLM cost (cross-ref C07) — Langfuse token/cost tracking docs; Helicone acquired by Mintlify Mar 2026 → maintenance (SigNoz/Firecrawl LLM-observability comparisons 2026); OpenLLMetry (telemetry, not enforcement). 2026-07.
24. Feature flags — OpenFeature (CNCF, Apache-2.0); Flipt `flipt-io/flipt` (~4.5k, GPL-3.0, v2 git-native); Unleash `Unleash/unleash` (~12k, Apache-2.0 open-core); GrowthBook (~6k, MIT); FlagShark + GrowthBook "open-source feature flag tools 2026". 2026-07.
25. Backstage / IDP — `backstage/backstage` (~30k ⭐, Apache-2.0, CNCF); Port/Cortex (commercial); Northflank/Roadie "Backstage alternatives 2026". 2026-07.
26. Chaos — Chaos Toolkit (Apache-2.0, experiments-as-code); Toxiproxy `Shopify/toxiproxy` (~11k, MIT); Litmus/Chaos Mesh (CNCF, k8s); Gremlin "Chaos Engineering tools comparison". 2026-07.
