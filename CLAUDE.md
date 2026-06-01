# CLAUDE.md — Fullstack Next.js Template (Prototype Rail)

Reusable starter for Rihal internal-tool prototypes. Next.js 16 + Prisma 7 (Postgres) + Auth.js v5 + Ant Design + next-intl. Deploys to Vercel + Neon via `git push`. Owner: Tariq Al-Naaimi.

**The audience is non-developer stakeholders.** They review prototypes via shared URLs (`<slug>.vercel.app`). They send back screenshots / sketches. The operator (you, working with Claude) iterates until approved. **Then `/handoff` produces a clean package for the IT team to take over** — they own production their way. See ADR-006.

**This is the template.** When you fork it into a project, run `/rebrand` then `/first-fork` to set up Vercel + Neon (~10 min). After that: `/quickstart` per idea, `/scale-up` per growth axis, `/handoff` at the end.

## Read before non-trivial work
- `@README.md` — stack overview, project structure
- `SECURITY.md` — data classes, secrets, threat model, findings T-01..T-09
- `docs/decisions/ADR-001-template-baseline.md` — the locked stack + invariants every fork inherits
- `docs/decisions/ADR-006-pivot-to-vercel-neon.md` — why we're on Vercel + Neon (supersedes ADR-005)
- `prisma/schema.prisma` — the source of truth for the data model
- `lib/prisma/audit-extension.ts` + `lib/prisma/soft-delete-extension.ts` — invariants the rest of the codebase relies on

## Vibe-coding harness (`.claude/`)
This template is tuned for Claude Code sessions. Humans coding by hand can ignore `.claude/`; it does not affect the runtime build.

- **Permission allowlist** (`.claude/settings.json`) pre-approves npm, prisma, docker compose (for local Postgres), make, non-destructive git (including pushes to any branch). Force pushes, `rm -rf`, `git reset --hard`, `git commit --amend`, branch deletes still prompt.
- **SessionStart hook** (`.claude/hooks/session-start.sh`) runs on boot: copies `.env.example` → `.env` if missing, runs `npm install` if `node_modules` is missing, runs `prisma generate` if the client is missing.
- **Skills** in `.claude/skills/`:
  - `/new-project` — one-shot: GitHub repo + Neon + Vercel + Cloudflare DNS. Triggered via GitHub Actions; outputs URL + admin creds in the run summary.
  - `/first-fork` — connect Vercel + Neon manually, first deploy. Once per project. (Alternative to `/new-project` when you're already inside a fresh fork.)
  - `/quickstart` — idea → live URL. The most-used skill.
  - `/scaffold-entity` — Prisma model + CRUD routes + dashboard page in one shot.
  - `/scale-up` — add file uploads / cron / background jobs / realtime when the project needs them.
  - `/ship` — pre-push gate (typecheck → lint → tests → build → gitleaks → npm audit).
  - `/audit` — on-demand security scan of any path (gitleaks + npm audit + Semgrep).
  - `/uat` — browser-driven acceptance walkthrough in Chromium (Playwright), with screenshots.
  - `/conform` — bring foreign code up to this template's standard (report-and-approve).
  - `/handoff` — produce clean handoff package for the IT team.
  - `/rebrand` — sweep template defaults to the new project's name.
  - `/migrate-from` — port an entity out of a monolith.
  - `/adr` — record a decision worth keeping.

All harness files are project-name-agnostic and survive forks unchanged.

## Operations model

**Vercel does the ops.** Push to `main` → production redeploys in ~90s. Push to any other branch → preview URL appears at `<branch>-<hash>-<team>.vercel.app`. Rollback = revert the commit (or click "Promote to Production" on the prior deployment in the Vercel UI).

- **Database migrations** apply automatically: `vercel.json` sets `buildCommand` to `prisma generate && prisma migrate deploy && next build`. Every deploy runs pending migrations against Neon before the app starts serving the new bundle.
- **Backups**: Neon Launch tier (paid) does PITR (point-in-time recovery) up to 7 days. Free tier has none — fine for prototypes.
- **Domains**: optional. `<slug>.vercel.app` is permanent. Custom domains via Vercel UI when the team is ready to share externally.
- **Secrets**: env vars in the Vercel project UI. Never traverse Claude chat. There is no GHCR, no Portainer, no SSH, no Caddy, no droplet — those were deleted (see ADR-006 for the rationale).

## CI gates — DORMANT on the free plan; local `/ship` is the active gate
On the current plan (solo operator, free GitHub plan with Actions billing blocked) the CI
workflows **do not run**. The active enforcement gate is the local **`/ship`** skill, which
mirrors their checks and runs on any machine (no `.git/hooks`, nothing machine-specific).

**`/ship` order — stop on first failure:** typecheck → lint → tests → build → gitleaks → npm audit.

The workflow files stay in the repo, dormant and labeled, and **activate at `/handoff`** when
the IT team's paid plan can run Actions and enforce branch protection:

| Workflow | When (once active) | What |
|---|---|---|
| `verify.yml` | PR + push (non-main) | tsc + ESLint (incl. local plugin) + `node:test` contract suite + Next build + npm audit high + scaffold smokes (scalars-only + enums+relations) |
| `secrets-scan.yml` | PR + push (any) | gitleaks across full history |
| `sast.yml` | PR + push (any) | Semgrep with p/javascript, p/typescript, p/nextjs, p/react, p/owasp-top-ten, p/secrets |

Branch protection is **optional** on this template and unenforceable on the free plan. Turn it
on once handed off. See `SECURITY.md` §14 and ADR-007.

## Stack
- **Framework:** Next.js 16 (App Router) · React 19 · TypeScript 5
- **UI:** Ant Design 6 + `@ant-design/nextjs-registry` · dark-mode toggle · RTL for `ar` locale
- **Charts:** `recharts` 2.x via `components/shared/Chart.tsx` (line / bar / area / pie)
- **Kanban / drag-drop:** `@dnd-kit/core` + `@dnd-kit/sortable` via `components/shared/KanbanBoard.tsx`
- **i18n:** `next-intl` 4 · locales `en`, `ar`
- **ORM:** Prisma 7 + `@prisma/adapter-pg` · Postgres 17 (Neon in prod, local Postgres in dev) · generated client at `generated/prisma`
- **Auth:** Auth.js v5 (`next-auth@beta`) · Credentials + bcryptjs · JWT session · Google OAuth wired but commented out · 10/min/IP rate limit on `/api/auth/*`
- **Email:** nodemailer wrapper at `lib/email.ts`. Gated by `SMTP_HOST`.
- **Export:** `lib/export.ts` — Excel via ExcelJS. `toExcel(data, columns)` returns Buffer; `excelDownloadHeaders(name)` builds the response headers.
- **Validation:** `zod`
- **Hosting:** Vercel (free tier covers most projects) · Neon Postgres (free tier covers staging) · Sentry (optional)
- **Observability:** `@sentry/nextjs` for error tracking. Better Uptime / cron uptime are optional add-ons via `/scale-up`. Wrapper at `lib/sentry.ts` shares the audit-extension `SCRUB_FIELDS` so contexts are scrubbed before they leave the process. See ADR-002.

## Storage
**File uploads are not wired by default.** The template used to ship a MinIO sidecar; that was deleted in ADR-006 because most prototypes don't need uploads on day 1. When you do need them, `/scale-up` adds Vercel Blob in ~10 lines of code.

## Local ESLint plugin
`eslint-rules/` is a project-local plugin enforcing four CLAUDE.md hard rules. It runs on every push via `verify.yml`. All four rules are configured at `error`.

| Rule | What it catches |
|---|---|
| `rihal-template/no-prisma-in-client` | `"use client"` file imports from `@/lib/prisma` |
| `rihal-template/no-any-cast-on-session` | `something as any` where the expression mentions `session` (regression guard for T-08) |
| `rihal-template/no-secret-env-in-console` | `console.*(process.env.<PASSWORD\|SECRET\|TOKEN\|KEY\|HASH\|IDENTITY\|WEBHOOK\|RECIPIENT>)` |
| `rihal-template/no-bare-internal-route` | `app/api/internal/**/route.ts` exports a handler not wrapped with `withInternalAuth` |

To silence a rule on a justified line:
```ts
// eslint-disable-next-line rihal-template/<rule>
```
If the suppression touches security, log it in `SECURITY.md` §12 with rule, location, justification, reviewer, date.

## Hard rules
- **Run `/ship` before every push.** This replaces branch protection for a solo operator and works on any machine. It runs typecheck → lint → tests → build → gitleaks → npm audit and stops on the first failure. Do not push on a red `/ship`.
- **Before any push that touches auth, schemas, API routes, or anything under `lib/`, run the native `/code-review`** (fresh-context diff review) and resolve its findings. This replaces the CI review gate for a solo operator.
- **Never commit `.env`.** Auth, DB, and SMTP credentials are Restricted — see `SECURITY.md` §1. gitleaks gates every push (locally via `/ship`).
- **Never log** any Restricted env var. The `no-secret-env-in-console` ESLint rule catches the obvious form; it does NOT catch interpolation into other variables — humans still apply judgement.
- **Email bodies may carry Restricted content** (OTPs, presigned URLs). `lib/email.ts` logs only metadata. Never separately log `opts.text` / `opts.html`.
- **Adding a Restricted column?** Extend `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts` AND its membership assertion in `tests/contracts/audit-scrub.test.ts` in the same commit.
- **Excel exports must not include Restricted columns.** `SCRUB_FIELDS` does NOT protect export output — it's a separate gate. Audit your column list per route.
- **Go through Prisma.** No raw SQL except via `prisma.$queryRaw` with parameter placeholders. Never `prisma.$executeRawUnsafe` on user input.
- **UI → API route → service → Prisma.** Server components and API routes are the only places that touch `prisma`. The `no-prisma-in-client` ESLint rule blocks the most common slip.
- **Use the auth wrappers.** Every API route handler wraps with `withAuth`, `withAdminAuth`, or `withInternalAuth`. Internal routes are doubly protected (middleware passes them through; `no-bare-internal-route` ESLint rule fires if the wrap is missing).
- **Audit is automatic but fragile.** `auditExtension` runs on every Prisma `create` / `update` / `delete` outside the EXCLUDE set. Don't add models to that set without an ADR.
- **Soft-delete is opt-in.** `/scaffold-entity` does it in lockstep; manual additions must too.
- **`prismaUnfiltered` ≠ `prisma`.** Auth + recycling-bin only.
- **Parameterized SQL only.** No `SELECT *` in raw queries. No raw `UPDATE` / `DELETE` without a `WHERE`.
- **Validate at the API boundary with zod.** Schemas live in `lib/validations/`.
- **Never cast `session` to `any`.** The augmentation in `types/index.ts` already types `session.user.role: Role`. The `no-any-cast-on-session` ESLint rule guards against regression.
- **Naming:** snake_case tables (via `@@map`); camelCase Prisma fields and TS; PascalCase React + Prisma models + enum types.

## Project tiers (`personal` vs `shared`)

Every fork declares a tier in `project.config.json` (`"tier": "personal" | "shared"`,
default `personal`, set during `/first-fork`). The tier scales the *ceremony* — it never
lowers the *security floor*.

**Security floor — applies to BOTH tiers, never optional:**
- Auth wrappers (`withAuth` / `withAdminAuth` / `withInternalAuth`) on every route.
- No leaked secrets; zod validation at every boundary; no raw SQL.
- The four `rihal-template/*` ESLint rules at `error`.
- **Audit log ON** (the Prisma audit extension + `SCRUB_FIELDS`).
- **`/ship` before every push.**

**`shared` adds:** the `/handoff` package; the compliance/PDPL section in `SECURITY.md`
(§9); CI activation at handoff; the formal findings register.

**`personal` skips:** `/handoff` (it refuses to run — there's no IT team); the compliance
section; CI ceremony; SLA/findings formality. (The audit log still stays ON — it's cheap
and protects the operator.)

## Ask before
- Installing a runtime dep > 50 KB minified — needs ADR or `/scale-up` recipe reference
- Touching `lib/auth.ts`, `lib/rate-limit.ts`, `lib/email.ts`, `lib/export.ts`, `lib/api-helpers.ts`, `middleware.ts`, anything under `lib/prisma/`, `eslint-rules/`, or `prisma/migrations/`
- Adding a model to the audit `EXCLUDE` set
- Adding a new public path or `/api/internal/*` route
- Bypassing `withAuth` / `withAdminAuth` / `withInternalAuth`
- Disabling any `rihal-template/*` ESLint rule beyond a single-line `eslint-disable-next-line`
- Changing the `Role` enum or how roles are checked
- Pushing to `main` directly when branch protection is on
- Suppressing a Semgrep / gitleaks / npm-audit finding (log in `SECURITY.md` §12)
- Changing the locked stack from ADR-001 — write a new superseding ADR first

## Requirements & planning (Superpowers vs `/quickstart`)

For real, multi-file features that deserve a spec, use **Superpowers** (the community
lifecycle skill: brainstorm → spec → plan → TDD build). For a throwaway idea-to-URL, use
**`/quickstart`** — don't spend spec ceremony on something disposable.

- **Superpowers** — install it as a Claude Code plugin (read its repo README for the
  current command; as of this writing: `/plugin marketplace add obra/superpowers-marketplace`
  then `/plugin install superpowers@superpowers-marketplace`, or
  `/plugin install superpowers@claude-plugins-official`). Use for anything that will live,
  be shared, or span several files.
- **`/quickstart`** — one paragraph → live URL. Use for disposable prototypes and quick experiments.

**Standing instruction — market benchmark before building.** Whenever a brainstorm /
requirements pass runs (Superpowers' brainstorm step, or any "let's plan a new feature/app"
moment), **first web-search what already exists** for this kind of app — products, libraries,
open-source starters — and summarize the options (with trade-offs) to the operator before
designing. The operator is a non-developer; surfacing prior art prevents reinventing or
under-scoping. The resulting spec should contain a short "market scan" section.

## Growth path

Projects start with one entity and grow. `/scale-up` covers what to add and when:

| Symptom | What `/scale-up` recommends |
|---|---|
| "Team needs to attach files" | Vercel Blob (free 5 GB) |
| "We need scheduled emails / reports" | Vercel Cron (free on Hobby) |
| "Background processing without blocking" | Inngest (free 50k steps/mo) |
| "Live updates without refresh" | Pusher Channels (free 100 conns) |
| "DB > 500 MB or want PITR" | Neon Launch ($19/mo) |
| "Custom domain" | Vercel domain (free) |
| "Feature flags" | Vercel Edge Config (free 8k reads) |
| "OAuth login" | Auth.js providers (free) |
| "Errors invisible in prod" | Sentry (already imported; set env vars) |
| "Rate limiter across instances" | Upstash Redis + `@upstash/ratelimit` |

The rail handles all of these without migration. None require code restructuring.

## Commands
- `npm run dev` — Next.js dev server
- `npm run scaffold -- --name <Pascal> --fields '<spec>' [--enums '...'] [--relations '...']`
- `npm run rebrand -- --slug <kebab> --name '<Display>' --owner <gh-owner>`
- `npm run migrate-from -- --source-db ... --target-db ... --map /tmp/migrate.json` — port a feature out of a monolith
- `npm test` — contract suite (rate limit, audit scrub, email, export, sentry scrub) via `node:test`
- `npm run uat` — Playwright UAT (set `UAT_BASE_URL` for a deployed target; local auto-starts dev). `npm run uat:install` once per machine; `npm run uat:report` to view screenshots
- `npm run prisma:migrate` / `:generate` / `:seed` / `:studio`
- `npm run lint` — ESLint (incl. local plugin)
- `make db-up` / `make db-down`
- `git push origin <branch>` — Vercel auto-deploys (preview for non-main; production for main)

## Sending email
```ts
import { sendEmail } from "@/lib/email";
const result = await sendEmail({
  to: user.email,
  subject: "Your password reset link",
  text: `Open ${url} to reset. Expires in 1 hour.`,
  html: `<p>Open <a href="${url}">this link</a> to reset. Expires in 1 hour.</p>`,
});
if (!result.sent) { /* SMTP_HOST unset; decide per call site whether fatal */ }
```

## Exporting to Excel
```ts
import { toExcel, excelDownloadHeaders } from "@/lib/export";
import { withAuth } from "@/lib/api-helpers";

export const GET = withAuth(async () => {
  const rows = await prisma.project.findMany({
    include: { owner: { select: { name: true } } },
  });
  const xlsx = await toExcel(rows, [
    { header: "Name", key: "name" },
    { header: "Owner", key: "owner", format: (v) => (v as { name: string } | null)?.name ?? "-" },
    { header: "Created", key: "createdAt", format: (v) => new Date(v as string).toISOString().slice(0, 10) },
  ], { sheetName: "Projects", title: "Project export" });
  return new Response(new Uint8Array(xlsx), {
    headers: excelDownloadHeaders(`projects-${Date.now()}.xlsx`),
  });
});
```

## Kanban board
```tsx
import { KanbanBoard } from "@/components/shared/KanbanBoard";

const columns = [
  { id: "TODO", title: "To do" },
  { id: "IN_PROGRESS", title: "In progress", color: "#1677ff" },
  { id: "DONE", title: "Done", color: "#52c41a" },
];

<KanbanBoard
  columns={columns}
  items={tasks.map((t) => ({ ...t, columnId: t.status }))}
  renderCard={(t) => <><b>{t.title}</b><div>{t.assignee?.name}</div></>}
  onMove={async (task, _from, to) => {
    await fetch(`/api/tasks/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: to }),
    });
    refetch();
  }}
/>
```

## Charts
```tsx
import { Chart } from "@/components/shared/Chart";

const data = [
  { month: "Jan", revenue: 4200 },
  { month: "Feb", revenue: 5100 },
  { month: "Mar", revenue: 4800 },
];
<Chart type="line" data={data} xKey="month" yKey="revenue" height={280} />
<Chart type="bar"  data={data} xKey="month" yKey="revenue" />
<Chart type="pie"  data={[{ name: "TODO", value: 12 }, { name: "DONE", value: 30 }]} nameKey="name" valueKey="value" />
```

## Known traps (don't "fix")
- Generated Prisma client lives in `generated/prisma`. Imports go through that path.
- Auth.js uses JWT session strategy; `sessions` table is for OAuth account linking only.
- `middleware.ts` runs on the Node runtime.
- `prismaUnfiltered` ≠ `prisma` (soft-delete on the former is off).
- `next-intl` locale matching strips the locale prefix; adding a locale means updating the regex in `middleware.ts`.
- Rate limiter is in-memory and per-instance — fine on Vercel until traffic forces multiple concurrent functions; then use `/scale-up` to swap to Upstash.
- `sendEmail` returns `{ sent: false }` when `SMTP_HOST` is unset; it does NOT throw.
- CSP allows `'unsafe-inline'` for script + style (Ant Design SSR + Next bootstrap).
- Vercel auto-injects `AUTH_URL` from `VERCEL_URL`. Don't set it manually unless using a custom domain *before* it's wired in Vercel.
- `vercel.json` runs `prisma migrate deploy` on every build — keep migrations small and forward-compatible. Don't drop columns in a migration that the running version still reads.
- File uploads are not wired in the template — `/scale-up` adds Vercel Blob when you need them.
- PDF export is intentionally not in `lib/export.ts` — pdfkit's font tracing is fragile in serverless. Future ADR.
- A root `app/not-found.tsx` exists alongside `app/[locale]/not-found.tsx` **on purpose.** Next 16 prerenders a synthetic `/_not-found` (and `/_global-error`) page at build time that lives *outside* the `[locale]` segment, so it has no locale/theme providers. The root `not-found.tsx` is deliberately self-contained (renders its own `<html>`/`<body>`, uses no React context) so that prerender can't fail. If a fork's `next build` dies during static prerender of `/_global-error` or `/_not-found` with `TypeError: Cannot read properties of null (reading 'useContext')`, that's the upstream Next 16 regression (vercel/next.js #85668, #86178, #84994) — the fix is a context-free root `not-found.tsx` (and, if needed, a context-free `app/global-error.tsx`), **not** editing the locale providers. The template's pinned next@16.2.6 / react@19.2.5 builds clean; the bug only bites forks that drift into a broken Next/React range.

When in doubt, stop and ask.
