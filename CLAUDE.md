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
  - `/first-fork` — connect Vercel + Neon, first deploy. Once per project.
  - `/quickstart` — idea → live URL. The most-used skill.
  - `/scaffold-entity` — Prisma model + CRUD routes + dashboard page in one shot.
  - `/scale-up` — add file uploads / cron / background jobs / realtime when the project needs them.
  - `/ship` — pre-push verification (typecheck + lint + build).
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

## CI gates (no local action required)
Three workflows gate the repo. Failures block merge once branch protection is on.

| Workflow | When | What |
|---|---|---|
| `verify.yml` | PR + push (non-main) | tsc + ESLint (incl. local plugin) + `node:test` contract suite + Next build + npm audit critical + scaffold smokes (scalars-only + enums+relations) |
| `secrets-scan.yml` | PR + push (any) | gitleaks across full history |
| `sast.yml` | PR + push (any) | Semgrep with p/javascript, p/typescript, p/nextjs, p/react, p/owasp-top-ten, p/secrets |

Branch protection is **optional** on this template. The audience (non-dev stakeholders) doesn't review PRs; the operator is the only person pushing. Turn it on once handed off.

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
- **Never commit `.env`.** Auth, DB, and SMTP credentials are Restricted — see `SECURITY.md` §1. gitleaks gates every push.
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

When in doubt, stop and ask.
