# OSS catalog — check here BEFORE you build (V2-306)

**This is step 0 of the build-vs-buy scan (ADR-032).** Before hand-building a capability under
`lib/`, look for it here first — the `build-vs-buy-gate.mjs` deny message points you at this file,
and `/adopt <capability>` reads it. A catalog hit means the reuse question is already half-answered:
pick the option, record the trade-off in `docs/build-vs-buy-ledger.md`, and (for a runtime dep) write
the ADR stub. A catalog miss means do the full web-search scan and **add the row you wished existed**.

**How to read a row.** `In-stack` = already shipped, just use it (no adoption). `Self-host (OSS)` =
the license-clean option a fork owns and runs itself — the default for anything that must not leak
data to a third party. `SaaS` = fastest to wire, a `/scale-up` recipe, but an external dependency
(publishes data off-box). **License flags matter:** `AGPL` obliges you to release your source if you
distribute/serve a modified version — fine as a self-hosted sidecar behind your own API, an
Ask-before + ADR for anything you fork. `>50 KB` runtime deps need an ADR or a `/scale-up` recipe
(CLAUDE.md Ask-before).

> This catalog is seeded, not exhaustive. Weights/licenses drift — re-verify at adoption time
> (`npm view <pkg>`, the project's LICENSE). Add a row whenever a scan turns up an option worth the
> next agent's time.

---

## Feature-oracle products (mine these for the real feature list, per category)

When `/benchmark` or `/blueprint` needs the table-stakes for a category, mine the **data model** of
the category's leading OSS product (not its marketing page) — the way the ITAM benchmark mined
Snipe-IT. These are the per-category oracles.

| Category                 | OSS oracle (repo)                        | License  | Mine it for                                           |
| ------------------------ | ---------------------------------------- | -------- | ----------------------------------------------------- |
| Project / issue tracking | **Plane** (`makeplane/plane`)            | AGPL-3.0 | issues, cycles, modules, states, workspaces           |
| CRM                      | **Twenty** (`twentyhq/twenty`)           | AGPL-3.0 | companies, people, opportunities, custom objects      |
| E-signature              | **Documenso** (`documenso/documenso`)    | AGPL-3.0 | documents, recipients, fields, signing order, audit   |
| Surveys / forms          | **Formbricks** (`formbricks/formbricks`) | AGPL-3.0 | surveys, questions, logic, responses, targeting       |
| Scheduling / booking     | **Cal.com** (`calcom/cal.com`)           | AGPL-3.0 | event types, availability, bookings, workflows        |
| IT asset management      | **Snipe-IT** (`grokability/snipe-it`)    | AGPL-3.0 | assets, models, status labels, checkout, depreciation |
| Helpdesk / ITSM          | **GLPI** (`glpi-project/glpi`)           | GPL-2.0  | tickets, SLAs, CMDB, assets                           |

Mining a data model is reading, not adopting — no license obligation attaches. Adopting/forking the
product itself is the Ask-before + ADR decision.

---

## Capability catalog (adopt-or-build, infra + UI)

Verdict legend: **use** (in-stack, no decision) · **adopt-SaaS** (`/scale-up` recipe) · **adopt-OSS**
(self-host, ledger + ADR) · **build** (thin in-repo seam) · **defer** (P1+).

| Capability             | In-stack default                                   | Self-host (OSS, license)                 | SaaS option          | Verdict / pointer                                         |
| ---------------------- | -------------------------------------------------- | ---------------------------------------- | -------------------- | --------------------------------------------------------- |
| File uploads           | —                                                  | MinIO (AGPL-3.0), S3-compatible          | Vercel Blob          | adopt — `/scale-up` (uploads → Vercel Blob)               |
| Background jobs        | —                                                  | **pg-boss** (MIT, on Postgres)           | Inngest              | adopt-OSS — ledger `lib/queue/**`; no new datastore       |
| Cron / scheduled       | —                                                  | node-cron                                | Vercel Cron          | adopt — `/scale-up`; audit-purge cron already ships       |
| Realtime / websockets  | —                                                  | Soketi (AGPL-3.0, Pusher-compatible)     | Pusher / Ably        | adopt — `/scale-up` (realtime → Pusher); Soketi to own it |
| Distributed rate limit | in-memory bucket (1 replica)                       | **rate-limiter-flexible** + Valkey (BSD) | Upstash              | adopt-OSS — ledger `lib/rate-limit/**`; ADR-035           |
| Auth / SSO providers   | **Auth.js v5** (in-stack)                          | Keycloak (Apache-2) for enterprise SSO   | Auth.js OAuth apps   | use — add a provider via `/scale-up` (OAuth)              |
| Feature flags          | —                                                  | Unleash (AGPL-3.0), Flagsmith (BSD)      | Edge Config          | adopt — `/scale-up` (flags → Edge Config)                 |
| Error tracking         | **@sentry/nextjs** (in-stack)                      | GlitchTip (MIT, Sentry-compatible)       | Sentry SaaS          | use — self-host swap = point DSN at GlitchTip             |
| Observability / traces | **OpenTelemetry** (in-stack)                       | SigNoz (MIT) collector backend           | any OTLP vendor      | use — instrument once, swap the backend (ADR-040)         |
| Transactional email    | **nodemailer** (in-stack)                          | self-host SMTP / Postal (MIT)            | Resend / Postmark    | use — `lib/email.ts` (SMTP; no-op until configured)       |
| Full-text search       | **Postgres FTS** (in-stack)                        | Meilisearch (MIT), Typesense (GPL-3)     | Algolia              | build-first — Postgres FTS; adopt Meilisearch at scale    |
| Product analytics      | Vercel Speed Insights                              | PostHog (MIT), Umami (MIT)               | PostHog Cloud        | adopt-OSS — PostHog self-host for privacy                 |
| PDF generation         | — (absent by design, ADR-006)                      | Stirling-PDF sidecar (MIT)               | —                    | build-thin-client — ledger `lib/pdf/**`                   |
| Vector search / RAG    | **pgvector** (in-stack)                            | pgvector on the same Postgres            | Pinecone / Weaviate  | use — `lib/ai/embeddings.ts` + `rag.ts` (ADR-036)         |
| Rich-text editor       | —                                                  | **Tiptap** (MIT), Lexical (MIT)          | —                    | adopt-OSS — Tiptap; >50 KB → ADR                          |
| Data grid / tables     | **TanStack Table** (in-stack)                      | —                                        | AG Grid (commercial) | use — `components/shared/DataTable`                       |
| Charts                 | **recharts** (in-stack)                            | —                                        | —                    | use — `chart-palette.ts` tokens (ADR-015)                 |
| Excel / CSV export     | **exceljs** (in-stack)                             | —                                        | —                    | use — `lib/export.ts` (audit column lists per route)      |
| i18n / translations    | **next-intl** (in-stack)                           | —                                        | Crowdin (TMS)        | use — `messages/*.json`; copy chokepoint (V2-305)         |
| Object/relational data | **Prisma 7 + Postgres** (in-stack, locked ADR-001) | —                                        | Neon (managed PG)    | use — never swap the ORM without a superseding ADR        |
| Component primitives   | **shadcn/Radix** (in-stack, ADR-029)               | —                                        | —                    | use — `components/shared/*`; compose, don't add a kit     |

---

## When there is no catalog hit

Do the full ADR-032 scan: `docs/REPO-MAP.md` + `lib/` + `components/shared/` for an existing
primitive → the `/scale-up` recipe table → a web search for a library/OSS fit → weigh the Ask-before
">50 KB runtime dep" line. Then **append the row you wished existed to this catalog** in the same
change, and record the decision in `docs/build-vs-buy-ledger.md`. The catalog only stays step-0 if
every miss feeds back a row.
