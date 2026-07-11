# C14 — Runtime services: cache, rate-limit, queue, email, realtime, files, export

> Exhaustive 4-lens (BT / HS / ENT / OSS) top-10 benchmark. Ground truth = `package.json` (Next.js 16.2.9 · Node 22 · Prisma 7.7 + Postgres 17). Pivot honored: **enterprise-only, deploy-per-tenant, Docker-first self-host (compose now, k8s-ready), Neon optional.** Star counts are point-in-time (as-of **2026-07**) and approximate — treat as order-of-magnitude, not exact.
> Current runtime services: `nodemailer` (email), **in-memory** rate-limit (per-instance), `exceljs` (export). No cache / queue / realtime / uploads yet.

---

### Distributed cache + rate-limit (NET-NEW — none yet; in-memory limiter breaks across containers)

Our rate limiter (`lib/rate-limit.ts`) is an **in-memory per-instance counter**. Under Docker-first / deploy-per-tenant with >1 replica, each container keeps its own bucket → the real limit is `N × configured`, and a flood spread across replicas is never throttled. This is a **correctness bug the moment we scale past one container**, not a nice-to-have. Fix = a shared store (Redis-protocol) + a distributed limiter algorithm.

| #   | Candidate                   | Lens           | Stars (2026-07) | License                                                      | Maturity                     | One-line why-it-ranks                                                                                                                    |
| --- | --------------------------- | -------------- | --------------- | ------------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Valkey**                  | BT · OSS · ENT | ~22k            | **BSD-3**                                                    | Fork Mar-2024; v9.1 May-2026 | Linux-Foundation BSD fork of Redis; distro-default (Ubuntu 26.04, Debian 13, Fedora 42); AWS/GCP/Oracle-backed; the clean self-host pick |
| 2   | Redis (OSS)                 | BT · HS        | ~68k            | RSALv2 / SSPLv1 / **AGPLv3** (tri, since Redis 8 / May-2025) | 2009; v8.x                   | Re-added AGPLv3 open license in 2025; still the reference, but copyleft + license whiplash is an enterprise trust hit                    |
| 3   | **Dragonfly**               | HS · OSS       | ~28k            | **BSL 1.1** (source-available)                               | 2022; multi-thread           | 3–25× throughput on multi-core, 15–22% less RAM, Redis-wire-compatible; BSL is not OSI-open (converts to Apache after 4y)                |
| 4   | KeyDB                       | OSS            | ~12k            | BSD-3                                                        | 2019 (Snap-owned)            | Multi-threaded Redis fork; largely stalled since Snap acquisition — losing momentum to Valkey/Dragonfly                                  |
| 5   | Upstash Redis (serverless)  | ENT            | SaaS            | Proprietary                                                  | 2021                         | HTTP/REST Redis, connectionless — the one store that works from edge/serverless; per-request pricing                                     |
| 6   | `@upstash/ratelimit`        | HS · BT        | ~2k             | MIT                                                          | v2.x                         | The limiter _algorithm_ layer (sliding-window/token-bucket/fixed), backed by any Upstash-or-Redis store; edge-tested                     |
| 7   | `rate-limiter-flexible`     | BT · OSS       | ~3.4k           | ISC                                                          | mature                       | Store-agnostic limiter (Redis/Postgres/Memcached/memory) — could sit on Valkey **or Postgres**, no new infra                             |
| 8   | `ioredis`                   | BT             | ~15k            | MIT                                                          | mature                       | The Node client to talk to Valkey/Redis (cluster, Lua, sentinel); the plumbing under a self-host limiter                                 |
| 9   | Memcached                   | BT             | ~14k            | BSD                                                          | 2003                         | Pure cache, no persistence/pub-sub; too thin for limiter+queue+realtime reuse                                                            |
| 10  | Postgres (`unlogged` table) | OSS            | —               | —                                                            | in-stack                     | Zero new infra; a limiter on an unlogged table is viable at low RPS but adds DB write load per request                                   |

**Head-to-head.** The license story is the headline: **Valkey** (BSD-3, Linux Foundation, now the default Redis package in every major distro) is the enterprise-safe self-host store — byte-compatible with Redis clients, no copyleft, no vendor. **Redis 8** walked back the SSPL fiasco by adding AGPLv3, but AGPL's network-copyleft still spooks legal at a deploy-per-tenant vendor, and the 2024–25 relicense whiplash is itself a governance red flag. **Dragonfly** is the performance monster (single-node vertical scale, less RAM) but **BSL 1.1 is source-available, not open** — fine for internal self-host, a real gate if we ever redistribute the image. For the _limiter algorithm_, `@upstash/ratelimit` is TS-native and edge-ready but is happiest on Upstash's HTTP API; `rate-limiter-flexible` is the store-agnostic, self-host-friendly pick that can run on Valkey **or** our existing Postgres — attractive because deploy-per-tenant single-container tenants may not want a second daemon at all.

**Recommendation: ADOPT (net-new) → Valkey (self-host, compose service) + `rate-limiter-flexible` as the limiter layer; keep in-memory as the zero-dep fallback for single-container tenants.** Add a `RATE_LIMIT_REDIS_URL` env: when set, the limiter uses Valkey (shared, correct across replicas); when unset, it falls back to today's in-memory counter (documented as single-instance-only). This matches Docker-first (Valkey is one more compose service, k8s-ready later) without forcing every tiny tenant to run Redis. Avoid Dragonfly as the _default_ (BSL redistribution gate) but allow it as a drop-in for high-throughput tenants. **Fit 5/5** (Redis-wire is universal; compose-native). **ADR impact:** supersede the "in-memory rate limiter" note; new ADR "Distributed cache + rate-limit store (Valkey)"; `/scale-up` already gestures at Upstash — reframe self-host-first.

---

### Background jobs / queue (NET-NEW — none yet)

We have Postgres 17 in-stack. That makes **pg-boss** uniquely cheap: zero new infrastructure, ACID with the same DB, `SKIP LOCKED` concurrency — no Redis daemon, no SaaS.

| #   | Candidate        | Lens           | Stars (2026-07) | License           | Maturity                 | One-line why-it-ranks                                                                                             |
| --- | ---------------- | -------------- | --------------- | ----------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 1   | **pg-boss**      | BT · OSS       | ~3.2k           | MIT               | v12.x; Node 24 / PG 18   | **Postgres-only** queue (`SKIP LOCKED`), exactly-once, DLQ, cron, retries — no new infra; our default fit         |
| 2   | BullMQ           | BT · HS        | ~9k             | MIT               | mature; 14M dl/mo        | The Redis job-queue standard — flows, rate-limit, repeatable jobs; needs Valkey/Redis (which we're adding anyway) |
| 3   | Graphile Worker  | OSS            | ~2.6k           | MIT               | mature                   | Postgres-only, `LISTEN/NOTIFY` low-latency; lighter than pg-boss but fewer batteries                              |
| 4   | Trigger.dev      | HS · OSS · ENT | ~11k            | **Apache-2.0**    | v4; Docker+k8s self-host | Full durable-workflow platform, TS-native, self-host with **no run limits**; heavy (own Postgres+Redis)           |
| 5   | Inngest          | HS · ENT       | ~5.6k           | Apache/SSPL split | v3; dev-server OSS       | Event-driven step functions, serverless-first; managed cloud is the happy path, self-host is second-class         |
| 6   | Temporal         | BT · ENT       | ~13k            | MIT               | 2020; YC/CNCF-scale      | Durable execution at FAANG scale (7 langs, event-sourced replay); heavyweight ops — overkill for our tier         |
| 7   | Bee-Queue        | OSS            | ~4k             | MIT               | mature                   | Minimal high-throughput Redis queue; fewer features than BullMQ                                                   |
| 8   | Hatchet          | OSS · ENT      | ~5k             | MIT               | 2024                     | Postgres-backed durable task platform (Temporal-lite); younger, ops-heavier than pg-boss                          |
| 9   | QStash (Upstash) | ENT            | SaaS            | Proprietary       | 2023                     | HTTP message queue for serverless; no infra but per-message pricing + vendor                                      |
| 10  | River (Go)       | OSS            | ~4k             | MPL-2.0           | 2024                     | Postgres queue — but Go, not Node; wrong runtime for us                                                           |

**Head-to-head.** The decision pivots on "do we already have Redis?" Once we add **Valkey** for rate-limit, **BullMQ** becomes nearly free infra-wise and is the most feature-complete Node queue (flows, repeatable jobs, priorities). But **pg-boss** needs _nothing new_ — it rides our Postgres, keeps jobs transactional with app data (enqueue-in-the-same-commit is a real correctness win for audit/outbox patterns), and matches deploy-per-tenant where a tiny tenant shouldn't run Redis. **Trigger.dev** (Apache-2.0, genuinely unlimited self-host) is the standout if we need _workflow orchestration_ (multi-step, long-running, retries-with-visibility) rather than a plain queue — but it drags in its own Postgres+Redis stack, contradicting "compose-light." **Temporal/Inngest** are over-scoped for an internal-tools rail. **Graphile Worker** is the low-latency Postgres alternative but pg-boss's batteries (cron, DLQ, archive) win.

**Recommendation: ADOPT (net-new) → pg-boss as the default queue; BullMQ as the `/scale-up` upgrade when a tenant already runs Valkey and needs flows/high-throughput; Trigger.dev (self-host, Apache-2.0) as the orchestration escape hatch.** pg-boss's zero-new-infra + transactional-enqueue is the perfect enterprise-repo default for a Postgres-centric rail; it composes with the audit extension (enqueue inside the same transaction). **Fit 5/5** (Postgres-native, TS, compose-free). **ADR impact:** new ADR "Background jobs — pg-boss default, BullMQ/Trigger.dev scale-up"; `/scale-up` recipe table currently lists Inngest — **re-order to pg-boss-first** (self-host, no SaaS).

---

### Email — current: `nodemailer` (SMTP; `sendEmail` returns `{sent:false}` when `SMTP_HOST` unset)

| #   | Candidate                    | Lens          | Stars (2026-07) | License               | Maturity        | One-line why-it-ranks                                                                                       |
| --- | ---------------------------- | ------------- | --------------- | --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | **nodemailer**               | BT · HS · OSS | ~17k            | MIT                   | 2010; ~5M dl/wk | Universal SMTP client — works with _any_ provider (SES/Postmark/self-host relay); our current, zero lock-in |
| 2   | AWS SES (via SMTP/SDK)       | BT · ENT      | —               | Proprietary           | mature          | $0.10/1k — cheapest at scale, air-gap-friendly (own AWS acct); needs own warmup/bounce/SNS handling         |
| 3   | Postmark                     | ENT           | SaaS            | Proprietary           | mature          | Best-in-class transactional deliverability (~98% inbox), message streams, bounce categorization             |
| 4   | Resend                       | HS · ENT      | SDK ~1.5k       | Proprietary (SDK MIT) | 2023            | DX-first API + native React-Email; runs on SES underneath; free 3k/mo; vendor lock on the API               |
| 5   | Mailgun                      | BT · ENT      | —               | Proprietary           | mature          | Established transactional/marketing API, EU regions, strong analytics                                       |
| 6   | SendGrid (Twilio)            | BT · ENT      | —               | Proprietary           | mature          | Enterprise incumbent; heavier, deliverability reputation has slipped vs Postmark                            |
| 7   | SMTP2GO                      | ENT           | SaaS            | Proprietary           | mature          | Managed SMTP relay — drop-in behind nodemailer, no code change                                              |
| 8   | Brevo (ex-Sendinblue)        | ENT           | —               | Proprietary           | mature          | EU-based, GDPR-friendly, transactional + marketing                                                          |
| 9   | **React Email** (templating) | HS · OSS      | ~18k            | MIT                   | 2023            | JSX email components; matches our React/TS stack; renders to HTML for any sender                            |
| 10  | **MJML** (templating)        | BT · OSS      | ~17k            | MIT                   | 2016            | Battle-tested responsive-email markup; max Outlook/legacy-client compatibility, non-JS-agnostic             |

**Head-to-head (transport).** `nodemailer` is not a competitor to Resend/Postmark — it's the **transport abstraction** that can _send through_ any of them via SMTP. Keeping it means **zero lock-in**: a tenant on SES pays $0.10/1k, a deliverability-critical tenant points the same code at Postmark, a self-host tenant uses an internal relay. Resend's pull is DX + React-Email integration, but it _is_ SES underneath with a proprietary API and a vendor bill — for deploy-per-tenant we'd rather each tenant choose their provider via `SMTP_*` env than hard-wire a SaaS SDK. **Templating:** React Email vs MJML is a real choice — React Email matches our stack (JSX, TS, same skills) and is the modern default; MJML wins only for agencies needing bulletproof legacy-Outlook rendering. React Email renders to plain HTML, so it feeds `nodemailer` transport-agnostically.

**Recommendation: KEEP+HARDEN nodemailer as transport; ADD React Email for templating (net-new).** Keep the provider-agnostic `SMTP_*` seam (its `{sent:false}` no-throw behavior is correct for optional email) and **add React Email** so templates are typed JSX rendered to HTML, then handed to `nodemailer` — no provider lock, works with SES/Postmark/relay per tenant. Document Postmark/SES as the recommended _deliverability_ backends behind the SMTP seam. **Fit:** nodemailer 5/5, React Email 5/5. **ADR impact:** minor ADR "Email templating = React Email; transport stays nodemailer/SMTP-agnostic"; harden `lib/email.ts` metadata-only logging invariant (already a hard rule).

---

### Realtime (NET-NEW — none yet)

| #   | Candidate                            | Lens           | Stars (2026-07)        | License        | Maturity | One-line why-it-ranks                                                                                                              |
| --- | ------------------------------------ | -------------- | ---------------------- | -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Centrifugo**                       | OSS · BT · ENT | ~10k                   | **Apache-2.0** | 2015; v6 | Self-hosted realtime server (WS/SSE/WebTransport), scales on Redis/**Valkey**/Postgres; Pusher/Ably replacement, language-agnostic |
| 2   | Pusher Channels                      | BT · ENT       | SaaS (`pusher-js` ~6k) | Proprietary    | 2011     | Simplest managed WS, broad SDKs; free 200 conns; the low-friction SaaS default                                                     |
| 3   | Ably                                 | ENT · BT       | SaaS                   | Proprietary    | 2016     | Protocol-level ordering + exactly-once + connection-state-recovery; strongest guarantees, enterprise SLA                           |
| 4   | **Raw SSE (Next RSC/Route Handler)** | OSS            | in-stack               | —              | native   | Server-Sent Events for one-way push (notifications/live tables) — zero infra, works with our Node runtime                          |
| 5   | Socket.IO                            | BT · HS        | ~62k                   | MIT            | 2010     | Ubiquitous WS lib; needs a Redis adapter to scale across replicas; more DIY than Centrifugo                                        |
| 6   | Soketi                               | OSS            | ~5k                    | MIT            | 2021     | Pusher-protocol self-host drop-in — **⚠ effectively ABANDONED** (issue #1114; no Node 20+ support)                                 |
| 7   | Laravel Reverb                       | OSS            | ~1.6k                  | MIT            | 2024     | Official Pusher-protocol server — but **PHP**, wrong runtime for us                                                                |
| 8   | Supabase Realtime                    | OSS · ENT      | ~7k                    | Apache-2.0     | 2020     | Postgres-CDC + broadcast (Elixir); great if on Supabase, heavy standalone                                                          |
| 9   | PartyKit                             | OSS            | ~3k                    | MIT            | 2023     | Edge/Durable-Objects realtime; Cloudflare-centric, off our self-host path                                                          |
| 10  | PubNub                               | ENT            | SaaS                   | Proprietary    | 2010     | Mature managed pub/sub with presence; pricing + vendor lock                                                                        |

**Head-to-head.** For most internal-tool realtime needs (live dashboards, notifications, "someone edited this row"), **raw SSE** off a Next Route Handler is the honest first answer — zero infra, one-way push, works on our Node-runtime middleware, and needs no new service. When we need bidirectional / presence / fan-out across replicas, the self-host winner is **Centrifugo** (Apache-2.0, single Go binary, scales on the **Valkey** we're already adding, language-agnostic) — it's the "set up once and forever" Pusher/Ably replacement that fits Docker-first. **Pusher** is the fastest managed on-ramp but is a SaaS bill per tenant; **Ably** has the best delivery guarantees (exactly-once, ordering) and is the pick only when correctness-critical realtime justifies enterprise SaaS. **⚠ Soketi — the obvious "self-host Pusher drop-in" — is abandoned** (maintainer confirmed in issue #1114, no Node 20 LTS support); do **not** adopt it.

**Recommendation: DEFER (build only when a feature needs it); when needed → raw SSE first, Centrifugo (self-host) for bidirectional/presence, Pusher/Ably as managed escape hatches.** Realtime is genuinely net-new with no current demand — don't pre-build it. Record the decision tree in `/scale-up`. **Explicitly blacklist Soketi** (abandoned). **Fit:** SSE 5/5, Centrifugo 4/5 (extra service, but Valkey-backed and compose-native). **ADR impact:** `/scale-up` realtime recipe currently names Pusher — **update to SSE-first / Centrifugo-self-host-first**, Pusher/Ably as options; add abandonment note on Soketi.

---

### File uploads (NET-NEW — ADR-006 intentionally omits uploads today)

| #   | Candidate                            | Lens           | Stars (2026-07) | License              | Maturity | One-line why-it-ranks                                                                                         |
| --- | ------------------------------------ | -------------- | --------------- | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | **S3 presigned + MinIO (self-host)** | BT · OSS · ENT | MinIO ~50k      | **AGPL-3.0** (MinIO) | mature   | S3-API presigned PUT/multipart; MinIO gives S3-compatible **self-host** object store — Docker-first fit       |
| 2   | AWS S3 (presigned)                   | BT · ENT       | —               | Proprietary          | mature   | The object-store standard; presigned URLs keep bytes off our server; per-tenant AWS acct = air-gap/compliance |
| 3   | Cloudflare R2                        | ENT · BT       | —               | Proprietary          | 2022     | S3-compatible, **zero egress** — best economics for download-heavy tenants                                    |
| 4   | **tus (`tus-node-server` / `tusd`)** | OSS · BT       | tusd ~10k       | **MIT**              | mature   | Open resumable-upload protocol; the answer for large/flaky-network uploads; pluggable S3/disk store           |
| 5   | Uppy                                 | HS · OSS       | ~30k            | MIT                  | mature   | Batteries-included client uploader (tus + S3 multipart + dashboard UI) by the tus/Transloadit team            |
| 6   | UploadThing                          | HS             | ~4.5k           | MIT (SDK)            | 2023     | T3-stack DX, type-safe file routes; but **hosted service** = vendor + bill, wrong for self-host default       |
| 7   | Vercel Blob                          | ENT            | SaaS            | Proprietary          | 2023     | One-line Vercel storage; **egress billed separately** from bandwidth; Vercel lock-in, off self-host path      |
| 8   | Filepond                             | OSS            | ~15k            | MIT                  | mature   | Polished client uploader with chunking + image transforms; client-only, pair with S3/tus backend              |
| 9   | Cloudinary                           | ENT            | SaaS            | Proprietary          | mature   | Managed image/video pipeline + transforms; heavy for plain file storage                                       |
| 10  | Garage / SeaweedFS                   | OSS            | ~5–10k          | AGPL/Apache          | mature   | Lightweight self-host S3 stores; MinIO alternatives if AGPL is a concern (Garage)                             |

**Head-to-head.** Deploy-per-tenant + Docker-first points hard at the **S3-API + presigned-URL** pattern, with **MinIO** as the self-host object store (S3-compatible, runs in compose) and AWS S3 / Cloudflare R2 as managed backends a tenant can swap in via config — the app code (`@aws-sdk/client-s3` presigned URLs) is identical across all three, so there's **no lock-in**. **UploadThing** and **Vercel Blob** are the DX-friendly SaaS options but both bind us to a vendor and a bill, contradicting self-host-first; UploadThing's `MIT` is only the SDK, the _storage_ is hosted. For large/unreliable uploads, layer **tus** (MIT, resumable) on top of the same S3 store, with **Uppy** as the client. One catch: **MinIO is AGPL-3.0** — fine to run internally, but if a tenant image redistributes it, prefer **Garage** (permissive) or managed S3/R2.

**Recommendation: DEFER (keep ADR-006's "no uploads") until a feature needs it; when needed → S3-presigned pattern with MinIO self-host + AWS S3 / Cloudflare R2 as swappable backends; add tus+Uppy only for large/resumable.** The presigned-URL seam is the perfect enterprise-repo shape: bytes never touch the Next server, one code path for self-host and cloud, zero vendor lock. Skip UploadThing/Vercel Blob as _defaults_ (SaaS lock-in). **Fit:** S3-presigned 5/5, tus 4/5. **ADR impact:** when adopted, supersede ADR-006's "uploads not wired" with "S3-presigned + MinIO/R2"; note MinIO AGPL redistribution caveat (prefer Garage/managed for shipped images).

---

### Export — current: `exceljs` (Excel); PDF intentionally absent from `lib/export.ts` (pdfkit fragile in serverless)

| #   | Candidate               | Lens     | Stars (2026-07) | License         | Maturity            | One-line why-it-ranks                                                                                                                                                         |
| --- | ----------------------- | -------- | --------------- | --------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **exceljs**             | BT · HS  | ~15k            | MIT             | mature              | Streaming writer, rich formatting, **6× less memory** than SheetJS on 100k rows — serverless-friendly; **⚠ maintenance stalled** (fork seeking maintainers, discussion #2987) |
| 2   | SheetJS (`xlsx`)        | BT · HS  | ~35k            | Apache-2.0 (CE) | mature; ~7.8M dl/wk | Reads/writes 20+ formats; **⚠ CE left GitHub → `git.sheetjs.com`** (mirror/supply-chain note); CE drops validations/styling on write                                          |
| 3   | write-excel-file        | OSS      | ~1k             | MIT             | active              | Small, modern, actively maintained XLSX writer — clean exceljs alternative if we only _write_                                                                                 |
| 4   | node-xlsx               | OSS      | ~2k             | MIT             | mature              | Simplest 2D array ↔ XLSX; no formatting/streaming                                                                                                                             |
| 5   | xlsx-populate           | OSS      | ~1k             | MIT             | mature              | Edits existing templates preserving formulas/formatting/macros                                                                                                                |
| 6   | **@react-pdf/renderer** | HS · OSS | ~15k            | MIT             | mature              | JSX→PDF, <500ms, runs in serverless (no Chromium), custom fonts incl. Arabic/RTL — best PDF fit for our stack                                                                 |
| 7   | Puppeteer (HTML→PDF)    | BT · HS  | ~90k            | Apache-2.0      | mature              | Pixel-perfect HTML→PDF but **~100MB Chromium > Vercel 50MB** limit; heavy (2–5s); OK in Docker, not serverless                                                                |
| 8   | Playwright (`.pdf()`)   | BT · HS  | ~73k            | Apache-2.0      | mature              | We already ship `@playwright/test` — reuse it for HTML→PDF in Docker/worker; same Chromium-weight caveat                                                                      |
| 9   | pdfmake                 | OSS      | ~12k            | MIT             | mature              | Declarative JSON→PDF, no browser; decent tables, weaker for complex layout                                                                                                    |
| 10  | pdfkit                  | OSS      | ~10k            | MIT             | mature              | Low-level PDF primitives — the fragile-in-serverless one ADR-006 already rejected                                                                                             |

**Head-to-head (Excel).** **exceljs** vs **SheetJS** is closer than the download numbers suggest. SheetJS has 4× the downloads and reads more formats, but for our use (_writing_ formatted report exports) exceljs's streaming + 6× lower memory is the serverless win, and SheetJS CE silently drops data-validations/styling on write. **The catch: both have 2025–26 health flags** — exceljs's maintenance has stalled (community fork openly seeking maintainers, discussion #2987) and SheetJS moved its Community Edition **off GitHub to a self-hosted registry** (`git.sheetjs.com`), which is a supply-chain/mirror consideration for a locked-down enterprise repo. `write-excel-file` is the actively-maintained, write-only alternative worth tracking. **PDF:** the repo's "no PDF" stance is _half_ right — pdfkit/Puppeteer are genuinely serverless-hostile, but **@react-pdf/renderer** (JSX→PDF, <500ms, no Chromium, RTL/Arabic-capable) fits our React/TS + i18n (`ar`) stack cleanly, and under **Docker-first** we can also run **Playwright** (already a dep) for pixel-perfect HTML→PDF in a worker.

**Recommendation: KEEP+HARDEN exceljs (pin + vendor-audit given stalled maintenance; keep `write-excel-file` as the exit); RE-OPEN PDF → ADD @react-pdf/renderer (net-new).** exceljs still wins on memory for our write-path, but its maintenance risk means: pin the version, watch the community fork, and keep `write-excel-file` as a migration target. **Reverse ADR-006's blanket "no PDF"** — the constraint was Chromium-in-serverless, which @react-pdf/renderer sidesteps entirely (and Docker-first removes the serverless size limit for a Playwright-based worker path). Preserve the existing export-column audit gate (`no-restricted-export-column` rule) for any PDF exporter too. **Fit:** exceljs 4/5 (maintenance risk), @react-pdf/renderer 5/5. **ADR impact:** ADR "Export = exceljs (write-path) + @react-pdf/renderer (PDF), superseding ADR-006's no-PDF stance"; flag exceljs + SheetJS supply-chain notes in SECURITY.md.

---

## Category verdict table

| Item                           | Current                  | Recommendation                                                                           | Net-new deps to add                                        | ADR impact                                    | Priority                               |
| ------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- | -------------------------------------- |
| Distributed cache + rate-limit | in-memory (per-instance) | **ADOPT → Valkey + `rate-limiter-flexible`**; in-memory fallback for single-container    | `valkey` (compose svc), `ioredis`, `rate-limiter-flexible` | New ADR (supersede in-mem note)               | **P0** (correctness bug at >1 replica) |
| Background jobs / queue        | none                     | **ADOPT → pg-boss** (Postgres-native); BullMQ/Trigger.dev scale-up                       | `pg-boss`                                                  | New ADR; reorder `/scale-up` to pg-boss-first | **P1**                                 |
| Email transport                | nodemailer (SMTP)        | **KEEP+HARDEN** provider-agnostic seam                                                   | —                                                          | Minor                                         | **P2** (already good)                  |
| Email templating               | none (raw HTML)          | **ADD → React Email** (JSX→HTML)                                                         | `@react-email/components`, `react-email`                   | Minor ADR                                     | **P1**                                 |
| Realtime                       | none                     | **DEFER → SSE first, Centrifugo self-host; ⚠ blacklist Soketi (abandoned)**              | (none until needed)                                        | Update `/scale-up` recipe                     | **P2**                                 |
| File uploads                   | none (ADR-006)           | **DEFER → S3-presigned + MinIO/R2 when needed; skip UploadThing/Blob defaults**          | `@aws-sdk/client-s3`, (opt `tus-node-server`, `@uppy/*`)   | Supersede ADR-006 when adopted                | **P2**                                 |
| Export — Excel                 | exceljs                  | **KEEP+HARDEN** (pin; stalled maintenance; `write-excel-file` as exit)                   | —                                                          | Note in SECURITY.md                           | **P1** (health-watch)                  |
| Export — PDF                   | intentionally absent     | **RE-OPEN → ADD @react-pdf/renderer** (serverless-safe); Playwright PDF in Docker worker | `@react-pdf/renderer`                                      | Supersede ADR-006 no-PDF                      | **P1**                                 |

---

## Sources

1. Redis "What is Valkey" — https://redis.io/blog/what-is-valkey/
2. Valkey vs Redis 2026 (fork that won) — https://www.buildmvpfast.com/blog/valkey-vs-redis-open-source-fork-migration-2026
3. Redis license timeline BSD→SSPL→AGPL — https://redisvsmemcached.com/redis-license-timeline/
4. Percona — Redis vs Valkey — https://www.percona.com/blog/choosing-the-right-key-value-store-redis-vs-valkey/
5. Redis vs Valkey vs Dragonfly vs KeyDB 2026 — https://blog.stackademic.com/redis-vs-valkey-vs-dragonfly-vs-keydb-which-one-actually-survives-production-in-2026-96cea2b5f66f
6. Dragonfly GitHub (BSL 1.1) — https://github.com/dragonflydb/dragonfly
7. `@upstash/ratelimit` — https://github.com/upstash/ratelimit-js · https://www.npmjs.com/package/@upstash/ratelimit
8. Inngest vs Trigger.dev vs BullMQ 2026 — https://www.buildmvpfast.com/blog/inngest-vs-trigger-dev-vs-bullmq-background-jobs-nextjs-2026
9. BullMQ vs Bee-Queue vs pg-boss 2026 — https://www.pkgpulse.com/guides/bullmq-vs-bee-queue-vs-pg-boss-job-queues-nodejs-2026
10. pg-boss GitHub — https://github.com/timgit/pg-boss
11. Trigger.dev self-host (Apache-2.0, no run limits) — https://trigger.dev/docs/self-hosting/overview · https://github.com/triggerdotdev/trigger.dev
12. Temporal GitHub — https://github.com/temporalio/temporal
13. Resend vs Nodemailer vs Postmark 2026 — https://www.pkgpulse.com/guides/resend-vs-nodemailer-vs-postmark-email-nodejs-2026
14. Node email 2026 (Resend/Postmark/SES) — https://www.hirenodejs.com/blog/nodejs-email-resend-postmark-ses-2026
15. React Email vs MJML vs Maizzle 2026 — https://trybuildpilot.com/688-react-email-vs-mjml-vs-maizzle-2026
16. React Email GitHub — https://github.com/resend/react-email
17. Centrifugo comparisons — https://centrifugal.dev/docs/getting-started/comparisons · https://github.com/centrifugal/centrifugo
18. Realtime services compared (Ably/Pusher/PubNub) — https://websocket.org/comparisons/managed-services/
19. **Soketi abandoned** — https://github.com/soketi/soketi/issues/1114
20. UploadThing vs R2 vs S3 for Next.js 2026 — https://apiscout.dev/guides/uploadthing-vs-cloudflare-r2-vs-s3-nextjs-2026
21. UploadThing GitHub — https://github.com/pingdotgg/uploadthing
22. tus-node-server / tusd — https://github.com/tus/tus-node-server · https://github.com/tus/tusd
23. Vercel Blob pricing (egress billed separately) — https://vercel.com/docs/vercel-blob/usage-and-pricing
24. SheetJS vs ExcelJS vs node-xlsx 2026 — https://www.pkgpulse.com/guides/sheetjs-vs-exceljs-vs-node-xlsx-excel-files-node-2026
25. **ExcelJS maintenance fork** — https://github.com/exceljs/exceljs/discussions/2987
26. Puppeteer vs @react-pdf/renderer (production) — https://dev.to/iurii_rogulia/pdf-generation-on-the-server-puppeteer-vs-react-pdfrenderer-a-production-comparison-44cg
27. PDF generators benchmark — https://1rps.club/blog/pdf-generators-benchmark-comparison/
