# C09 — Infra, Containerization & Delivery

> Exhaustive 4-lens top-10 benchmark. Ground truth: Next.js 16.2.9 `output:"standalone"` (gated `DOCKER_BUILD=1`), Prisma 7.7 + `pg`, PostgreSQL 17, Node 22.
> **Pivot honored:** Docker-first delivery · self-hosted dockerized Postgres default (Neon optional) · **compose now, k8s-ready later** (no k8s in v1) · **deploy-per-tenant** (no in-app multi-tenancy) · enterprise-only.
> Lens tags: `BT`=battle-tested · `HS`=highest-star/popular · `ENT`=enterprise-grade · `OSS`=best permissive open-source. Stars as-of 2026-07 unless noted.

---

## Current-events catches (read first — these change defaults)

- **MinIO Community Edition → maintenance mode (2025-12-03), repo archived 2026-04-25.** [1][2][3] The community `minio/minio` repo is frozen: no new features/PRs, security fixes case-by-case. Preceded by the June 2025 removal of the web console from CE. **MinIO CE is no longer a safe default for net-new self-hosted object storage.** Successors: **SeaweedFS** (Apache-2.0, 12+ yr) and **Garage** (AGPL-3.0). [4][5][6]
- **Terraform stays under BUSL-1.1** (relicensed 2023-08); **OpenTofu** (Linux Foundation, MPL-2.0) is the permissive fork with production migrations at Fidelity (4M+ resources), Capital One, Oracle, VMware. [13][14] OpenTofu now ships features Terraform OSS lacks (native state encryption).
- **Docker Swarm mode** is maintained by **Mirantis** (committed ≥3 yr), but classic Swarm is archived and Swarm mode has had no meaningful features since ~2019. [17][18] Fine as a low-ceremony seam, not a strategic bet.
- **Infisical** remains **MIT core + proprietary `ee/` dir** (dynamic secrets, SCIM, LDAP, HSM). [11] No rug-pull, but enterprise features are paywalled — factor into a "self-host everything" posture.
- **Vault** is BUSL-licensed; the truly-open fork is **OpenBao** (Linux Foundation). [10]

---

## Production Dockerfile / standalone image

**One line:** How we build the shipped container. Current: `next.config.ts` emits `output:"standalone"` only under `DOCKER_BUILD=1`; ADR-030 makes the image build a mandatory `/ship --full` gate. Base image + user + pinning are the open questions.

| #   | Candidate                                     | Lens      | Stars / signal (2026-07) | License                      | Maturity | Why it ranks                                                                                                                    |
| --- | --------------------------------------------- | --------- | ------------------------ | ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `node:22-alpine` (multi-stage + standalone)   | BT·HS·OSS | Official Node image      | MIT/others                   | 2015+    | Default in nearly every 2026 Next.js guide; smallest full-featured runtime; needs `libc6-compat` for some native modules [7][8] |
| 2   | `gcr.io/distroless/nodejs22`                  | ENT·OSS   | Google-maintained        | Apache-2.0                   | 2018+    | Smallest attack surface: no shell/pkg-mgr; non-root by default; ideal for standalone (no build tools needed at runtime) [7]     |
| 3   | `node:22-slim` (debian-slim)                  | BT·ENT    | Official                 | MIT/others                   | 2015+    | glibc (no musl surprises with `sharp`/native addons); larger than alpine but fewer compat traps                                 |
| 4   | Docker Hardened Images (`node:24-alpine3.22`) | ENT       | Docker Inc. commercial   | Commercial                   | 2025+    | Docker's DHI line — patched, SBOM-attested, but paid tier for enterprise support [7]                                            |
| 5   | Chainguard Images (`cgr.dev/.../node`)        | ENT·OSS   | Wolfi-based              | Apache-2.0 (free tier)       | 2023+    | Near-zero-CVE, daily rebuilds, SBOM+signing; free `:latest`, paid for pinned/older tags                                         |
| 6   | `cgr.dev` distroless-node (Chainguard)        | ENT       | —                        | —                            | 2023+    | Distroless + Wolfi glibc = best-of-both (no musl, no shell); enterprise procurement-friendly                                    |
| 7   | Alpine + `sharp` explicit install             | BT·OSS    | pattern                  | —                            | —        | The pragmatic pattern: standalone trace often drops `sharp`; reinstall in runner stage [7]                                      |
| 8   | `ubi9/nodejs-22` (Red Hat UBI)                | ENT       | Red Hat                  | UBI EULA (free redistribute) | 2019+    | Air-gapped/regulated shops standardized on UBI; FIPS options                                                                    |
| 9   | Bitnami `node`                                | BT        | Broadcom/VMware          | Apache-2.0                   | 2016+    | Hardened + non-root, but Bitnami's 2025 catalog changes add uncertainty                                                         |
| 10  | Buildpacks (Paketo/Heroku)                    | OSS       | CNCF                     | Apache-2.0                   | 2020+    | No Dockerfile to maintain; reproducible; but opaque and heavier than a hand-tuned standalone image                              |

**Head-to-head:** For a **standalone** Next build the runtime needs only `node` + the traced `.next/standalone` tree — no npm, no compiler — which is exactly distroless's sweet spot: **distroless/nodejs22** gives the smallest CVE surface and non-root out of the box, and standalone sidesteps distroless's usual "no package manager" pain. The one real risk is native modules (`sharp` for image optimization) that expect glibc; **alpine (musl)** occasionally breaks them and forces `libc6-compat`, while **distroless/slim (glibc)** does not. Chainguard/DHI are the enterprise "patched + attested" answer but add cost/licensing. For an enterprise repo that wants low CVEs _and_ glibc safety, **distroless-nodejs (glibc) is the strongest**, with alpine the popular fallback.

**Recommendation:** `ADOPT (net-new)` — ship a **multi-stage Dockerfile**: `deps` (alpine, install) → `build` (alpine, `DOCKER_BUILD=1 next build`) → `runner` = **`gcr.io/distroless/nodejs22-debian12`**, **non-root (uid 1001)**, **base image pinned by digest** (`@sha256:…`, Renovate-updated), `COPY --from=build /app/.next/standalone`. Reinstall `sharp` in the build stage so it lands in the trace. Provide an alpine variant behind a build-arg for teams that hit distroless edge cases. **Fit 5/5.** ADR: extend ADR-030 with the base-image + digest-pinning + non-root decision.

---

## docker-compose.prod orchestration shape

**One line:** The v1 production topology. Current: `make docker-up` exists (ADR-030), but there is no committed `compose.prod.yaml` defining app + Postgres + proxy + backups as one unit.

| #   | Candidate (shape)                                               | Lens    | Signal                              | Why it ranks                                                                                                      |
| --- | --------------------------------------------------------------- | ------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | `compose.prod.yaml`: app + postgres:17 + caddy + backup sidecar | BT·OSS  | Compose Spec (Docker/CNCF-adjacent) | The pivot's stated target: one file, `deploy-per-tenant`, healthchecks + `depends_on: condition: service_healthy` |
| 2   | Compose profiles (`--profile db` / `--profile neon`)            | OSS     | Compose v2                          | Same file toggles bundled Postgres vs external Neon URL — matches "self-host default, Neon optional"              |
| 3   | Compose + named volumes + `pg_dump` cron sidecar                | BT      | —                                   | Durable Postgres data + automated logical backups without extra infra                                             |
| 4   | Compose + `restart: unless-stopped` + resource limits           | BT      | Compose Spec                        | `deploy.resources.limits` caps memory/CPU per tenant box                                                          |
| 5   | Compose merge (`-f base -f prod`)                               | BT      | —                                   | Dev/prod override split keeps one source of truth                                                                 |
| 6   | Compose watch / `develop`                                       | OSS     | Compose v2.22+                      | Dev ergonomics; not a prod concern                                                                                |
| 7   | Portainer-managed stacks                                        | ENT     | 32k★                                | GUI over compose for IT handoff; optional                                                                         |
| 8   | Dockge                                                          | OSS     | ~18k★                               | Lightweight compose UI; homelab-grade                                                                             |
| 9   | `podman-compose` / Quadlet                                      | ENT·OSS | RH-backed                           | Rootless/daemonless for hardened hosts; systemd-native units                                                      |
| 10  | Compose → `kompose` convert                                     | OSS     | CNCF                                | Escape hatch to k8s manifests when k8s-ready phase lands                                                          |

**Head-to-head:** The winning shape is a single **`compose.prod.yaml` with profiles**: default profile brings up `app + postgres:17 + caddy + backup-sidecar`; a `neon` profile drops Postgres and points `DATABASE_URL` at Neon — one file serves both the "self-hosted dockerized Postgres default" and the "Neon optional" cases without duplication. Healthchecks + `condition: service_healthy` ordering is non-negotiable so Prisma `migrate deploy` doesn't race an unready DB. Portainer/Dockge/Quadlet are optional operator conveniences layered on top, and `kompose` is the documented seam to the later k8s phase.

**Recommendation:** `ADOPT (net-new)` — commit `compose.prod.yaml` (app + `postgres:17` + Caddy + backup sidecar) with **profiles** for bundled-DB vs Neon, healthchecks, resource limits, named volumes, and a `pg_dump` cron sidecar. Keep it the single k8s-convertible source of truth. **Fit 5/5.** ADR: new ADR "compose.prod topology" under ADR-030's umbrella.

---

## Reverse proxy / TLS (NET-NEW)

**One line:** TLS termination + routing in front of the container. Current: **none** — Vercel handled TLS; self-host has no proxy yet.

| #   | Candidate                             | Lens      | Stars (2026-07)      | License    | RAM idle | Why it ranks                                                                                   |
| --- | ------------------------------------- | --------- | -------------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------- |
| 1   | **Caddy**                             | BT·HS·OSS | ~64k★                | Apache-2.0 | ~30 MB   | Automatic HTTPS in 2 lines; ACME built-in; simplest for a 1–3 service per-tenant box [9][15]   |
| 2   | **Traefik**                           | BT·HS·ENT | ~55k★                | MIT        | ~80 MB   | Docker-label auto-discovery + dashboard; best for many/dynamic services; ACME built-in [9][15] |
| 3   | **Nginx**                             | BT·HS     | ~28k★ (nginx mirror) | BSD-2      | ~15 MB   | Ubiquitous, fastest raw; but no native ACME — needs Certbot sidecar [15]                       |
| 4   | Nginx Proxy Manager                   | HS·OSS    | ~26k★                | MIT        | ~50 MB   | GUI over nginx+Certbot; homelab-friendly, less GitOps-clean [9]                                |
| 5   | HAProxy                               | BT·ENT    | ~5k★                 | GPL/LGPL   | low      | Elite L4/L7 load balancing; heavier config, ACME via add-on                                    |
| 6   | Envoy                                 | ENT       | ~26k★                | Apache-2.0 | high     | Service-mesh grade; overkill for single-box per-tenant                                         |
| 7   | Traefik + `certresolver` (per-tenant) | ENT       | —                    | MIT        | —        | Wildcard/multi-domain per tenant via label config                                              |
| 8   | Caddy + `caddy-docker-proxy`          | OSS       | ~2.6k★               | Apache-2.0 | ~30 MB   | Adds Traefik-style label discovery to Caddy                                                    |
| 9   | OpenResty                             | BT        | ~4k★                 | BSD        | low      | Nginx+Lua; power-user scripting                                                                |
| 10  | Cloudflare Tunnel (`cloudflared`)     | ENT       | ~9k★                 | Apache-2.0 | low      | No open ports / no cert mgmt; but adds Cloudflare dependency                                   |

**Head-to-head:** For **deploy-per-tenant** each box typically runs one app + DB behind one domain, which is precisely where **Caddy wins**: two lines of Caddyfile, automatic Let's Encrypt issuance + renewal, ~30 MB, no Docker socket exposure (a security plus). **Traefik** only pulls ahead when a box hosts many dynamic services and you want label-based auto-discovery + a dashboard — less relevant to a one-app-per-tenant model, and mounting the Docker socket is an attack-surface cost. **Nginx** is the fastest and most familiar but needs a Certbot sidecar for TLS, which is exactly the operational chore Caddy eliminates.

**Recommendation:** `ADOPT (net-new) → Caddy` as the default proxy in `compose.prod.yaml`; document a **Traefik** override for multi-service tenant boxes. Caddy's automatic-HTTPS matches the "one live URL, verify by running" ethos with the least ops. **Fit 5/5.** ADR: new ADR "self-host TLS = Caddy (Traefik override)".

---

## Container registry

**One line:** Where built images live. Current: **none defined** (Vercel built in-platform). GHCR is the zero-friction default given GitHub-centric flow.

| #   | Candidate                            | Lens       | Signal                | License/Model                         | Why it ranks                                                                                            |
| --- | ------------------------------------ | ---------- | --------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | **GHCR** (GitHub Container Registry) | BT·HS      | GitHub-native         | SaaS (free for public, incl. private) | Zero-config with GH Actions; perms tied to repo; images beside code [16]                                |
| 2   | **Harbor**                           | BT·ENT·OSS | ~26k★, CNCF graduated | Apache-2.0                            | The self-hosted enterprise standard: RBAC, Trivy scan on push, signing (cosign), replication, SBOM [16] |
| 3   | GitLab Container Registry            | BT·ENT     | GitLab-native         | MIT-core                              | Zero-config for GitLab CI shops [16]                                                                    |
| 4   | AWS ECR                              | BT·ENT     | AWS                   | SaaS                                  | Default if the tenant infra is AWS; IAM-native, scan-on-push                                            |
| 5   | Docker Hub                           | BT·HS      | —                     | SaaS (rate-limited)                   | Ubiquitous but pull-limit + supply-chain caution                                                        |
| 6   | Quay.io / Quay (self-host)           | ENT·OSS    | Red Hat               | Apache-2.0                            | Clair scanning; RH ecosystem; self-hostable                                                             |
| 7   | Azure ACR                            | ENT        | Azure                 | SaaS                                  | Default on Azure/Entra tenants (we already opt into Entra, ADR-024)                                     |
| 8   | Zot (`project-zot`)                  | ENT·OSS    | ~1.5k★, CNCF          | Apache-2.0                            | Minimal OCI-native registry; great for air-gap edge                                                     |
| 9   | Distribution (`registry:2`)          | BT·OSS     | ~9k★, CNCF            | Apache-2.0                            | The reference registry; bare-bones, drop-in compose service                                             |
| 10  | Gitea/Forgejo package registry       | OSS        | ~48k / ~5k★           | MIT/GPL                               | If self-hosting the forge already                                                                       |

**Head-to-head:** The repo is GitHub-centric, so **GHCR** is the frictionless default — Actions push with `GITHUB_TOKEN`, permissions inherit from the repo, images sit beside code. The enterprise question is whether a tenant needs an **air-gapped / on-prem** registry with scanning + replication + RBAC, and there **Harbor** (CNCF-graduated, Apache-2.0) is the uncontested self-hosted pick. ECR/ACR only win when the tenant's cloud is already AWS/Azure. For a fully offline edge, **Zot** or plain `registry:2` are minimal.

**Recommendation:** `ADOPT (net-new) → GHCR default; Harbor for on-prem/air-gap`. Publish images to GHCR from CI; document a Harbor compose profile for regulated tenants. **Fit 5/5** (GitHub flow already assumed). ADR: "registry = GHCR, Harbor on-prem option".

---

## Object storage

**One line:** S3-compatible store for uploads/exports. Current: **none** — file uploads are intentionally unwired (ADR-006). **MinIO CE is dead (maintenance mode).**

| #   | Candidate           | Lens      | Stars (2026)        | License    | Why it ranks                                                                                               |
| --- | ------------------- | --------- | ------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | **SeaweedFS**       | BT·HS·OSS | ~32k★ (Apr'26)      | Apache-2.0 | 12+ yr, best small-file perf, single-binary start, S3 API + POSIX; the pragmatic MinIO successor [4][5][6] |
| 2   | **Garage**          | OSS       | ~10k★ (rising)      | AGPL-3.0   | Rust, tiny, single-node friendly, geo-distributed focus; simplest ops for modest hardware [4][5][6]        |
| 3   | AWS S3              | BT·ENT·HS | —                   | SaaS       | The reference; use when tenant is on AWS or wants zero storage ops                                         |
| 4   | Cloudflare R2       | BT·ENT    | —                   | SaaS       | S3 API, **zero egress fees**; strong managed default                                                       |
| 5   | Backblaze B2        | BT        | —                   | SaaS       | Cheap S3-compatible managed storage                                                                        |
| 6   | RustFS              | OSS·HS    | ~10k★ (fast-rising) | Apache-2.0 | New Rust MinIO-drop-in; MinIO-API-compatible; young, watch maturity [4]                                    |
| 7   | Ceph RGW (via Rook) | BT·ENT    | ~14k★               | LGPL       | Hyperscale, multi-PB; heavy ops, needs quorum — overkill per-tenant                                        |
| 8   | MinIO CE            | —         | ~52k★               | AGPL-3.0   | **AVOID for net-new** — maintenance mode 2025-12, archived 2026-04 [1][2][3]                               |
| 9   | Zenko / others      | OSS       | small               | Apache-2.0 | Multi-cloud gateway; niche                                                                                 |
| 10  | Wasabi              | ENT       | —                   | SaaS       | Flat-rate S3-compatible managed                                                                            |

**Head-to-head:** MinIO would have been the obvious pick a year ago; its **maintenance-mode + archive** removes it. Among survivors, **SeaweedFS** (Apache-2.0, 12 yr, huge small-file throughput) is the most production-validated self-hosted choice, at the cost of a slightly busier component model (master/volume/filer). **Garage** (AGPL-3.0) is dramatically simpler to run on a single modest box — ideal for a per-tenant deployment that just needs a durable S3 endpoint — but its AGPL license needs a compliance nod and small-object perf is a notch below SeaweedFS. For managed simplicity, **Cloudflare R2** (no egress fees) is the strongest cloud option and pairs well with the "Neon optional" managed posture.

**Recommendation:** `ADOPT (net-new, when uploads land) → Garage as the self-host default, SeaweedFS for scale, R2 as the managed option`. Wire via S3 presigned URLs behind a `lib/` service (build-vs-buy ledger entry). Garage's single-node simplicity fits deploy-per-tenant; escalate to SeaweedFS only when small-file volume demands it. **Explicitly do not adopt MinIO.** **Fit 4/5** (net-new, gated on ADR-006 unwiring uploads). ADR: supersede ADR-006's "uploads unwired" with an object-storage decision + note the MinIO catch.

---

## Secrets management

**One line:** How Restricted env (`DATABASE_URL`, `AUTH_SECRET`, SMTP, `CRON_SECRET`) is stored/injected. Current: `.env` files + platform env vars; **never commit `.env`** (gitleaks-gated). No dedicated secrets manager.

| #   | Candidate                           | Lens    | Stars (2026)  | License                      | Self-host      | Why it ranks                                                                                                 |
| --- | ----------------------------------- | ------- | ------------- | ---------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | **SOPS + age**                      | BT·OSS  | ~19k★ (sops)  | MPL-2.0 / MIT                | N/A (fileless) | No server; encrypted secrets in git, same review/versioning as code; perfect GitOps + deploy-per-tenant [10] |
| 2   | **Infisical**                       | HS·OSS  | ~26k★         | MIT core + `ee/` proprietary | Docker         | Best UX self-hosted vault; CLI injection, SSO, rotation; enterprise features paywalled [11][12]              |
| 3   | **HashiCorp Vault**                 | BT·ENT  | ~32k★         | BUSL-1.1                     | Docker/k8s     | The enterprise gold standard: dynamic secrets, PKI, leasing; heavy ops + license [10]                        |
| 4   | **OpenBao**                         | ENT·OSS | ~4k★ (rising) | MPL-2.0                      | Docker/k8s     | LF fork of Vault pre-BUSL; the _open_ Vault for license-averse enterprises                                   |
| 5   | Doppler                             | ENT·HS  | —             | SaaS-only                    | No             | Excellent DX, broad CI integrations; **not self-hostable** — off-pivot                                       |
| 6   | sealed-secrets (Bitnami)            | OSS     | ~8k★          | Apache-2.0                   | k8s-only       | Great, but **k8s-only** — not for the compose-now phase                                                      |
| 7   | AWS Secrets Manager / SSM           | BT·ENT  | —             | SaaS                         | No             | Default if tenant is on AWS                                                                                  |
| 8   | Azure Key Vault                     | ENT     | —             | SaaS                         | No             | Fits our Entra opt-in (ADR-024)                                                                              |
| 9   | 1Password Secrets Automation / `op` | ENT     | —             | SaaS                         | No             | Strong if org already on 1Password                                                                           |
| 10  | Bitwarden Secrets Manager           | OSS     | large         | GPL/AGPL                     | Docker         | Self-hostable; younger secrets product                                                                       |

**Head-to-head:** Two paradigms. **SOPS+age** stores _encrypted_ secrets in the repo — no server to run, secrets flow through the same PR/review/CI as code, and per-tenant key separation is trivial (one age recipient per tenant). That's an ideal match for **deploy-per-tenant + GitOps** and adds zero infra, at the price of no dynamic secrets/rotation/audit-UI. **Infisical** (MIT core) is the answer when you want a UI, rotation, and runtime injection without standing up Vault; its `ee/` paywall (dynamic secrets, SCIM, LDAP) is the catch. **Vault/OpenBao** are the heavy enterprise option — adopt only when dynamic DB creds or PKI are real requirements; prefer **OpenBao** (MPL-2.0) over BUSL Vault for license purity. **Doppler and sealed-secrets are off-pivot** (SaaS-only / k8s-only respectively) for the compose-now v1.

**Recommendation:** `ADOPT (net-new) → SOPS + age as v1 default`, with **Infisical** documented as the upgrade when a UI/rotation is needed and **OpenBao** as the k8s-ready-phase heavy option. SOPS keeps zero-infra + GitOps + per-tenant key isolation. **Fit 5/5.** ADR: new ADR "secrets = SOPS+age (Infisical/OpenBao growth path)".

---

## Orchestration

**One line:** What runs the containers. Pivot is explicit: **Compose now, k8s-ready later (no k8s in v1)**.

| #   | Candidate               | Lens       | Signal (2026)                           | Why it ranks                                                                        |
| --- | ----------------------- | ---------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | **Docker Compose**      | BT·HS·OSS  | Compose Spec                            | The pivot's v1: single-host, deploy-per-tenant, lowest ops [19]                     |
| 2   | **Kubernetes** (+ Helm) | BT·HS·ENT  | 82% orchestration share; CNCF graduated | The k8s-ready target; skill-portable; ecosystem anchor — but **not v1** [17][19]    |
| 3   | **K3s**                 | BT·ENT·OSS | ~29k★, CNCF                             | Lightweight single-binary k8s; the pragmatic bridge to the k8s phase [19]           |
| 4   | Docker Swarm mode       | BT         | Mirantis-maintained                     | One-command clustering; **no new features since ~2019** — bridge only [17][18]      |
| 5   | HashiCorp Nomad         | ENT·OSS    | ~15k★                                   | Single binary <100 MB, no etcd; runs containers+binaries+VMs; simpler than k8s [19] |
| 6   | Helm                    | BT·ENT     | ~28k★, CNCF                             | The packaging layer for the k8s phase                                               |
| 7   | Kustomize               | BT·OSS     | CNCF                                    | Template-free k8s config; pairs with GitOps                                         |
| 8   | Nomad Pack              | OSS        | —                                       | Helm-equivalent for Nomad                                                           |
| 9   | Podman + Quadlet        | ENT·OSS    | RH-backed                               | Rootless systemd-native single-host; hardened-host alternative to Compose           |
| 10  | k0s / MicroK8s          | OSS        | ~9k / ~9k★                              | Other lightweight-k8s bridges                                                       |

**Head-to-head:** The decision is already made and correct: **Compose** for v1 (single-host per tenant, minimal ops, the exact topology deploy-per-tenant wants). The only live question is the **k8s-ready seam**: keep the compose file `kompose`-convertible and standardize on the k8s ecosystem (**K3s → Helm/Kustomize**) as the growth path, because that's where the skills, community, and CNCF gravity are. **Swarm** is a tempting middle step but its frozen feature set makes it a dead-end bet; **Nomad** is genuinely simpler than k8s but its smaller ecosystem means less skill-portability for an enterprise handoff. So: Compose now, **K3s+Helm** later — skip Swarm/Nomad as the strategic target.

**Recommendation:** `KEEP (Compose v1) + DEFER (K3s+Helm as documented k8s-ready seam)`. Do **not** introduce Swarm or Nomad as the strategic path; keep `compose.prod.yaml` convertible and write the k8s-migration note. **Fit 5/5.** ADR: "orchestration ladder = Compose → K3s+Helm".

---

## IaC (Infrastructure as Code)

**One line:** Declarative provisioning of the tenant box + DNS + registry. Current: **none** — provisioning is imperative scripts (`scripts/deploy.mjs`, `new-project.mjs`). Question: do we ship IaC in v1?

| #   | Candidate             | Lens       | Stars (2026) | License      | Why it ranks                                                                                                |
| --- | --------------------- | ---------- | ------------ | ------------ | ----------------------------------------------------------------------------------------------------------- |
| 1   | **OpenTofu**          | BT·ENT·OSS | ~26k★        | MPL-2.0      | Open Terraform fork; HCL/state-compatible; native state encryption; Fidelity/CapitalOne migrations [13][14] |
| 2   | **Terraform**         | BT·HS·ENT  | ~44k★        | **BUSL-1.1** | Largest ecosystem/provider registry; but source-available license trap [13]                                 |
| 3   | **Pulumi**            | ENT·OSS    | ~22k★        | Apache-2.0   | Real languages (TS/Go/Python); TS-native fits our stack; own state backend [13]                             |
| 4   | Ansible               | BT·ENT·OSS | ~64k★        | GPL-3.0      | Agentless config-mgmt; great for provisioning a VPS + docker-compose deploy                                 |
| 5   | Terragrunt            | OSS        | ~8k★         | MIT          | DRY wrapper over TF/OpenTofu for many tenants                                                               |
| 6   | Terraform CDK / CDKTF | OSS        | ~5k★         | MPL/BUSL     | TS→HCL; bridges Pulumi-style code to TF providers                                                           |
| 7   | AWS CDK               | ENT        | ~12k★        | Apache-2.0   | AWS-only; TS-native                                                                                         |
| 8   | Crossplane            | ENT·OSS    | ~10k★        | Apache-2.0   | k8s-native control plane; belongs to the later k8s phase                                                    |
| 9   | Nix / NixOS           | OSS        | large        | MIT          | Reproducible hosts; steep curve                                                                             |
| 10  | cloud-init + Makefile | OSS        | —            | —            | Minimal "IaC-lite" for a single per-tenant VPS bootstrap                                                    |

**Head-to-head:** For an enterprise repo, **OpenTofu beats Terraform on license alone** — same HCL, same state format, drop-in migration, MPL-2.0 instead of BUSL, plus features (state encryption) Terraform OSS lacks. **Pulumi** is attractive because it's **TypeScript-native** (matches the stack, lets the same team write infra), but it introduces a second paradigm and its own state service. The deeper question is **whether v1 needs IaC at all**: with **deploy-per-tenant on a single compose host**, an **Ansible playbook** (or even cloud-init + the existing `scripts/*.mjs`) that provisions a VPS and runs `docker compose up` is lighter and sufficient; full Terraform/OpenTofu earns its keep once tenants span managed cloud resources (DNS, managed DB, buckets, registry).

**Recommendation:** `DEFER for v1; ADOPT → OpenTofu when cloud resources appear`. Ship **Ansible/cloud-init + the existing scripts** as v1 provisioning; write the growth note that IaC = **OpenTofu (not Terraform, BUSL)**, Pulumi only if the team wants TS-native infra. **Fit 3/5** (net-new, not v1-critical). ADR: "IaC deferred; when needed, OpenTofu over Terraform (license)".

---

## Self-host PaaS options

**One line:** A control plane so non-dev operators/IT get a Vercel-like deploy on their own box. Current: Vercel (managed) is the deploy path (ADR-006/009). Pivot keeps Docker-first self-host as default; Vercel as an optional preview.

| #   | Candidate         | Lens      | Stars (2026)            | License    | Model             | Why it ranks                                                                                       |
| --- | ----------------- | --------- | ----------------------- | ---------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| 1   | **Coolify**       | HS·OSS    | ~51k★                   | Apache-2.0 | Self-host PaaS    | Mature, 280+ one-click services, v4.0 MCP server, Swarm support; heavier idle (~5-7% CPU) [20][21] |
| 2   | **Dokploy**       | HS·OSS    | ~31k★ (fastest-growing) | Apache-2.0 | Self-host PaaS    | Lean (~350 MB/<1% idle), Traefik-native, Swarm clustering, Docker-first [20][21]                   |
| 3   | **Vercel**        | BT·ENT·HS | —                       | SaaS       | Managed           | Best Next.js DX; keep as optional **preview** URL per pivot                                        |
| 4   | Render            | BT·ENT    | —                       | SaaS       | Managed           | Fixed-price managed; real free tier; Postgres included [22]                                        |
| 5   | Railway           | HS·ENT    | —                       | SaaS       | Managed           | Per-second billing, great DX; BYOC only on Enterprise (lock-in) [22]                               |
| 6   | Fly.io            | BT·ENT    | —                       | SaaS       | Managed           | Global edge, full Docker control; no BYOC, no free tier [22]                                       |
| 7   | CapRover          | OSS·HS    | ~14k★                   | Apache-2.0 | Self-host PaaS    | Older Swarm-based PaaS; simpler, smaller community [20]                                            |
| 8   | Dokku             | BT·OSS    | ~31k★                   | MIT        | Self-host PaaS    | The original "self-host Heroku"; single-host, buildpacks/Docker                                    |
| 9   | Portainer         | ENT·OSS   | ~32k★                   | zlib (CE)  | Container mgmt UI | Not a PaaS but the pragmatic IT-handoff GUI over compose/Swarm                                     |
| 10  | Kamal (37signals) | OSS       | ~12k★                   | MIT        | Deploy tool       | SSH + Docker deploy-to-your-own-metal; no control-plane daemon; deploy-per-tenant fit              |

**Head-to-head:** Two credible self-host control planes. **Coolify** is the mature "app store" PaaS — huge service catalog, v4.0 added an MCP server for AI-driven deploys — but idles heavier and is broader than a per-tenant single-app box needs. **Dokploy** is leaner, Docker/Traefik-native, Swarm-ready, and lighter on a small VPS — a closer match to deploy-per-tenant. Both are Apache-2.0 (no license trap). Against these, the **managed SaaS** trio (Render/Railway/Fly) trade self-hosting for DX and add lock-in (Railway/Fly have no BYOC), which conflicts with the Docker-first-self-host pivot — they belong only as optional convenience targets alongside **Vercel-as-preview**. A quiet dark horse is **Kamal**: no control-plane daemon at all, just SSH + Docker to your own metal — arguably the _purest_ deploy-per-tenant primitive if operators are comfortable without a GUI.

**Recommendation:** `ADD-AS-OPTION` — keep **Vercel as the optional preview** (pivot); document **Dokploy** (lean, per-tenant) and **Coolify** (feature-rich) as the two supported self-host PaaS control planes for IT handoff, and **Kamal** as the GUI-less deploy-per-tenant primitive. Do not couple the template to any one — compose + Caddy already runs standalone. **Fit 4/5.** ADR: "self-host PaaS = Dokploy/Coolify documented; Vercel preview-only".

---

## Category verdict table

| Item                          | Current                                  | Recommendation                                                                  | Net-new deps to add                              | ADR impact                            | Priority |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------- | -------- |
| Production Dockerfile / image | `output:standalone`, gated (ADR-030)     | `ADOPT` distroless-nodejs22, non-root, digest-pinned; alpine variant            | Multi-stage Dockerfile; Renovate digest updates  | Extend ADR-030 (base image + pinning) | **P0**   |
| docker-compose.prod           | `make docker-up`, no committed prod file | `ADOPT` `compose.prod.yaml` w/ profiles (bundled DB vs Neon) + backup sidecar   | compose file, pg backup sidecar                  | New ADR (compose topology)            | **P0**   |
| Reverse proxy / TLS           | none                                     | `ADOPT → Caddy` (Traefik override)                                              | Caddy service in compose                         | New ADR (self-host TLS)               | **P0**   |
| Container registry            | none                                     | `ADOPT` GHCR default; Harbor on-prem/air-gap                                    | CI push step; Harbor profile                     | New ADR (registry)                    | **P1**   |
| Object storage                | unwired (ADR-006)                        | `ADOPT` Garage default / SeaweedFS scale / R2 managed; **avoid MinIO**          | Garage service + S3 `lib/` client + ledger entry | Supersede ADR-006 (uploads)           | **P1**   |
| Secrets management            | `.env` + platform env                    | `ADOPT → SOPS+age`; Infisical/OpenBao growth                                    | `sops`, `age` (dev tooling)                      | New ADR (secrets)                     | **P1**   |
| Orchestration                 | Compose intent                           | `KEEP` Compose v1; `DEFER` K3s+Helm seam; skip Swarm/Nomad                      | none v1; `kompose` note                          | New ADR (orch ladder)                 | **P1**   |
| IaC                           | imperative scripts                       | `DEFER` v1 (Ansible/cloud-init); `ADOPT → OpenTofu` when cloud resources appear | Ansible playbook (v1); OpenTofu later            | New ADR (IaC deferred → OpenTofu)     | **P2**   |
| Self-host PaaS                | Vercel (ADR-006/009)                     | `ADD-AS-OPTION` Dokploy/Coolify + Kamal; Vercel preview-only                    | docs only                                        | Amend ADR-006/009 (preview-only)      | **P2**   |

---

## Sources

1. MinIO Maintenance Mode issue — https://github.com/minio/minio/issues/21714
2. InfoQ, "MinIO GitHub Repository in Maintenance Mode" (2025-12) — https://www.infoq.com/news/2025/12/minio-s3-api-alternatives/
3. byteiota, "MinIO Enters Maintenance Mode" — https://byteiota.com/minio-enters-maintenance-mode-oss-storage-strategy-shift/
4. Akmatori, "MinIO Alternatives 2026: SeaweedFS vs Garage vs Ceph" — https://akmatori.com/blog/minio-alternatives-2026-comparison
5. OffshoreServerHosting, "Self-Hosted Object Storage in 2026" — https://www.offshoreserverhosting.com/blog/self-hosted-object-storage-2026-seaweedfs-garage-minio-replacement/
6. Pi Stack, "Self-Hosted S3: MinIO vs SeaweedFS vs Garage 2026" — https://www.pistack.xyz/posts/2026-05-03-self-hosted-s3-object-storage-minio-seaweedfs-garage-guide/
7. dev.to (whoffagents), "Docker for Next.js: Production-Ready Dockerfile" (2026) — https://dev.to/whoffagents/docker-for-nextjs-production-ready-dockerfile-compose-and-cicd-pipeline-51il
8. Docker Docs, "Containerize a Next.js application" — https://docs.docker.com/guides/nextjs/
9. Virtua Cloud, "Traefik vs Caddy vs Nginx Docker Reverse Proxy" — https://www.virtua.cloud/learn/en/concepts/traefik-caddy-nginx-docker-reverse-proxy
10. GitGuardian, "Top Secrets Management Tools 2026" — https://blog.gitguardian.com/top-secrets-management-tools/
11. Infisical LICENSE (MIT core + ee/) — https://github.com/Infisical/infisical/blob/main/LICENSE
12. Infisical, "Open Source Secrets Management for DevOps in 2026" — https://infisical.com/blog/open-source-secrets-management-devops
13. tech-insider, "OpenTofu vs Terraform vs Pulumi (2026)" — https://tech-insider.org/opentofu-vs-terraform-vs-pulumi-2026/
14. rack2cloud, "Terraform vs OpenTofu 2026: Post-BSL Decision" — https://www.rack2cloud.com/terraform-vs-opentofu-2026-post-bsl-decision/
15. OSSAlt, "Traefik vs Caddy vs Nginx (2026)" — https://ossalt.com/guides/traefik-vs-caddy-vs-nginx-reverse-proxy-self-hosting-2026
16. Shipyard, "Choosing a Container Registry in 2026: Docker Hub vs ECR vs Harbor" — https://shipyard.build/blog/container-registries/
17. Portainer, "Docker Swarm Still Works. But Does It Still Have a Future?" — https://www.portainer.io/blog/docker-swarm-still-works-but-does-it-still-have-a-future
18. Mirantis, "Swarm is here to stay" — https://www.mirantis.com/blog/swarm-is-here-to-stay-and-keeps-getting-better-in-security-and-ease-of-operations/
19. Pi Stack, "Kubernetes vs Docker Swarm vs Nomad: Container Orchestration 2026" — https://www.pistack.xyz/posts/kubernetes-vs-docker-swarm-vs-nomad/
20. INTROSERV, "Dokploy vs Coolify 2026" — https://introserv.com/blog/dokploy-vs-coolify-complete-comparison-of-the-best-self-hosted-paas-platforms-for-vps-and-dedicated-servers-2026/
21. Contabo Blog, "Coolify vs Dokploy Comparison 2026" — https://contabo.com/blog/blog-coolify-vs-dokploy-comparison/
22. ExpressTech, "Render vs Railway vs Fly.io: 2026 Pricing Showdown" — https://expresstech.io/render-vs-railway-vs-fly-io-2026-pricing-showdown/
