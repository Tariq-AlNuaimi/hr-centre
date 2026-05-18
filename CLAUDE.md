# CLAUDE.md — Fullstack Next.js Template

Reusable starter for Rihal internal tools. Next.js 16 + Prisma 7 (Postgres) + Auth.js v5 + MinIO + Ant Design + next-intl. Deploys as a single Docker image to a Portainer-managed host via GHCR webhook. Owner: Tariq Al-Naaimi.

**This is the template.** When you fork it into a project, run `/rebrand` then `/first-fork` to swap defaults and bootstrap secrets / Portainer / branch protection. Sections below describe what the template ships out of the box — treat them as defaults to keep, tighten, or replace.

## Read before non-trivial work
- `@README.md` — stack overview, project structure
- `SECURITY.md` — data classes, secrets, threat model, findings T-01..T-09, CI gates §14 (read before touching auth / data / secrets / a finding)
- `docs/decisions/ADR-001-template-baseline.md` — the locked stack + invariants every fork inherits
- `prisma/schema.prisma` — the source of truth for the data model
- `lib/prisma/audit-extension.ts` + `lib/prisma/soft-delete-extension.ts` — invariants the rest of the codebase relies on

## Vibe-coding harness (`.claude/`)
This template is tuned for Claude Code sessions. Humans coding by hand can ignore `.claude/`; it does not affect the runtime build.

- **Permission allowlist** (`.claude/settings.json`) pre-approves npm, prisma, docker compose, make, non-destructive git (including pushes to any branch). Force pushes, `rm -rf`, `git reset --hard`, `git commit --amend`, branch deletes still prompt.
- **SessionStart hook** (`.claude/hooks/session-start.sh`) runs synchronously on boot: copies `.env.example` → `.env` if missing, runs `npm install` if `node_modules` is missing, runs `prisma generate` if the client is missing.
- **Skills** in `.claude/skills/`: `/scaffold-entity` (with `--enums` + `--relations`), `/ship`, `/adr`, `/first-fork`, `/rebrand`, `/deploy`, `/promote`, `/release`, `/new-project`, `/migrate-from`, `/rollback`, `/restore`.

All harness files are project-name-agnostic and survive forks unchanged.

## CI gates (no local action required)
Five workflows gate the repo. Failures block merge once branch protection is on.

| Workflow | When | What |
|---|---|---|
| `verify.yml` | PR + push (non-main) | tsc + ESLint (incl. local plugin) + `node:test` contract suite + Next build + npm audit high+ + scaffold smokes (scalars-only + enums+relations) |
| `secrets-scan.yml` | PR + push (any) | gitleaks across full history |
| `sast.yml` | PR + push (any) | Semgrep with p/javascript, p/typescript, p/nextjs, p/react, p/owasp-top-ten, p/secrets |
| `audit-retention.yml` | Monthly cron + dispatch | POST to `/api/internal/audit-purge` |
| `restore-test.yml` | Quarterly cron + dispatch | Decrypts newest backup, restores into ephemeral Postgres, asserts users non-empty |

Pushes to `main` go through `docker-build.yml` instead. See `SECURITY.md` §14.

## Stack
- **Framework:** Next.js 16 (App Router, `output: "standalone"`) · React 19 · TypeScript 5
- **UI:** Ant Design 6 + `@ant-design/nextjs-registry` · dark-mode toggle · RTL for `ar` locale
- **Charts:** `recharts` 2.x via `components/shared/Chart.tsx` (line / bar / area / pie)
- **Kanban / drag-drop:** `@dnd-kit/core` + `@dnd-kit/sortable` via `components/shared/KanbanBoard.tsx`
- **i18n:** `next-intl` 4 · locales `en`, `ar`
- **ORM:** Prisma 7 + `@prisma/adapter-pg` · Postgres 17 · generated client at `generated/prisma`
- **Auth:** Auth.js v5 (`next-auth@beta`) · Credentials + bcryptjs · JWT session · Google OAuth wired but commented out · 10/min/IP rate limit on `/api/auth/*`
- **Storage:** MinIO via `@aws-sdk/client-s3` + presigned URLs (`lib/storage.ts`)
- **Email:** nodemailer wrapper at `lib/email.ts`. Gated by `SMTP_HOST`.
- **Export:** `lib/export.ts` -- Excel via ExcelJS. `toExcel(data, columns)` returns Buffer; `excelDownloadHeaders(name)` builds the response headers. PDF deferred (pdfkit font tracing under standalone is a future ADR).
- **Validation:** `zod`
- **Backup:** encrypted off-host sidecar (`deploy/backup.sh`) using age + rclone. Gated by `BACKUP_ENABLED`.
- **Host:** Portainer-managed Docker host · GHCR · stack-webhook for SHA pinning.
- **Observability:** `@sentry/nextjs` for error tracking + Better Uptime for `/api/health` monitoring. Both are operator-side SaaS configured per project during `/first-fork` step 12 and wired by `/deploy`. Wrapper at `lib/sentry.ts` shares the audit-extension `SCRUB_FIELDS` so contexts are scrubbed before they leave the process. See ADR-002.

## Local ESLint plugin
`eslint-rules/` is a project-local plugin enforcing four CLAUDE.md hard rules. It runs on every push via `verify.yml` (the `npm run lint` step). All four rules are configured at `error`.

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
- **Never commit `.env`.** Auth, DB, MinIO, audit-purge, backup, and SMTP credentials are Restricted — see `SECURITY.md` §1. gitleaks gates every push.
- **Never log** any Restricted env var (full list in `SECURITY.md` §1). The `no-secret-env-in-console` ESLint rule catches the obvious form (`console.log(process.env.SMTP_PASSWORD)`); the rule does NOT catch interpolation into other variables — humans still apply judgement.
- **Email bodies may carry Restricted content** (OTPs, presigned URLs, salary statements). `lib/email.ts` logs only metadata. Never separately log `opts.text` / `opts.html`.
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
- Installing a runtime dep > 50 KB minified -- needs ADR
- Touching `lib/auth.ts`, `lib/rate-limit.ts`, `lib/email.ts`, `lib/export.ts`, `lib/api-helpers.ts`, `middleware.ts`, anything under `lib/prisma/`, `eslint-rules/`, or `prisma/migrations/`
- Adding a model to the audit `EXCLUDE` set
- Adding a new public path or `/api/internal/*` route
- Bypassing `withAuth` / `withAdminAuth` / `withInternalAuth`
- Disabling any `rihal-template/*` ESLint rule beyond a single-line `eslint-disable-next-line`
- Changing the `Role` enum or how roles are checked
- Pushing to `main` directly — always branch + PR
- Suppressing a Semgrep / gitleaks / npm-audit finding (log in `SECURITY.md` §12)
- Changing the locked stack from ADR-001 — write a new superseding ADR first

## Commands
- `npm run dev` — Next.js dev server
- `npm run scaffold -- --name <Pascal> --fields '<spec>' [--enums '...'] [--relations '...']`
- `npm run rebrand -- --slug <kebab> --name '<Display>' --owner <gh-owner>`
- `npm run deploy -- --env staging --domain ... --do-token ... --cf-token ... --gh-token ... --ssh-pubkey ... --caddy-email ...` — full provisioning + first deploy (see `/deploy` skill)
- `npm run promote -- --sha HEAD --gh-token ... --yes` — staging → prod
- `npm run release -- --tag prod-YYYYMMDD-HHmm` (or `--auto`) — draft CHANGELOG + GitHub release after `/promote` (see ADR-003)
- `npm run new-project -- --plan /tmp/new-project.json ...` — idea → live staging URL in one run (see `/new-project` skill)
- `npm run migrate-from -- --source-db ... --target-db ... --map /tmp/migrate.json` — port a feature out of a monolith
- `npm run rollback -- --env prod --to sha-abc1234 --yes` — flip image tag, redeploy
- `npm run restore -- --env prod --pick latest` — pull + decrypt + restore a backup into ephemeral Postgres
- `npm test` — contract suite (rate limit, audit scrub, email, export) via `node:test`
- `npm run prisma:migrate` / `:generate` / `:seed` / `:studio`
- `npm run lint` — ESLint (incl. local plugin)
- `make db-up` / `make db-down`
- `git push origin main` — triggers `docker-build.yml`

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
- MinIO presigned URLs default to 1 hour.
- Rate limiter is in-memory and per-instance.
- `sendEmail` returns `{ sent: false }` when `SMTP_HOST` is unset; it does NOT throw.
- CSP allows `'unsafe-inline'` for script + style (Ant Design SSR + Next bootstrap).
- `output: "standalone"` is required for the small Docker image.
- Docker entrypoint runs `prisma migrate deploy` before starting the app.
- `docker-compose.prod.yml` resolves through `${IMAGE_TAG:-latest}`; use a Portainer stack webhook for SHA pinning.
- `BACKUP_ENABLED` defaults to `false`; flipped on by `/first-fork` step 6.
- `AUDIT_PURGE_TOKEN` is optional; endpoint returns 503 if unset.
- `/scaffold-entity` does not handle multiple relations from one source to the same target -- hand-edit Prisma `@relation("Name", ...)` for that case.
- `/scaffold-entity` includes do not filter the target's soft-delete (Prisma extension limitation).
- `Chart` uses recharts -- visually minimal, not exact Ant Design palette. Pass `colors={...}` to override.
- `KanbanBoard` requires a 4px pointer movement before drag starts so click-throughs on cards still work.
- PDF export is intentionally not in `lib/export.ts` -- pdfkit's font tracing under `output: standalone` is fragile. Future ADR.

When in doubt, stop and ask.
