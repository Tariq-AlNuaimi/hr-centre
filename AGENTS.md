# AGENTS.md — cross-tool AI-assistant pointer

This file orients **any** AI coding assistant (Cursor, GitHub Copilot, Windsurf,
Aider, etc.) working in this repository. It is a pointer, not the source of truth.

## Authoritative rules live elsewhere — read them first

- [`CLAUDE.md`](./CLAUDE.md) — the full project rules: stack, hard rules, "ask
  before" list, commands, known traps. **This is the contract.**
- [`SECURITY.md`](./SECURITY.md) — data classification, auth/authorization model,
  audit invariants, secrets, threat model, findings register.

If anything here conflicts with `CLAUDE.md` / `SECURITY.md`, those files win.

## Top hard rules (summary — see `CLAUDE.md` for the full text)

- **Auth wrappers on every API route.** Wrap each handler with one of
  `withAuth` / `withAdminAuth` / `withEditorAuth` / `withInternalAuth` /
  `withApiAuth` from `lib/api-helpers.ts`; compose `withRateLimit` outside the
  auth wrapper to throttle. Never ship a bare route handler.
- **Go through Prisma.** No raw SQL except `prisma.$queryRaw` with parameter
  placeholders; never `$executeRawUnsafe` on user input. UI → API route →
  service → Prisma. Only server components and API routes touch `prisma`.
- **Validate at the API boundary with zod.** Schemas live in `lib/validations/`.
- **Never log or commit secrets.** No Restricted env var (`*SECRET*`,
  `*PASSWORD*`, `*TOKEN*`, `*KEY*`, `passwordHash`, …) in logs; never commit
  `.env`. gitleaks gates every push.
- **Audit is automatic.** The Prisma audit extension records every per-row
  `create` / `update` / `delete` outside the EXCLUDE set. Don't add models to
  that set without an ADR. Note: bulk `updateMany` / `createMany` and `upsert`
  are NOT auto-audited (Prisma doesn't decompose `upsert` into create/update the
  extension can see) — loop per-row or write an explicit `recordAudit()` row (see
  ADR-010 / SECURITY.md §5).
- **Soft-delete is opt-in** and must be wired in lockstep with the model.
- **Never cast `session` to `any`** — `session.user.role` is already typed `Role`.
- **Run `/ship` before every push** (typecheck → lint → tests → component tests →
  build → gitleaks → npm audit). Do not push on a red `/ship`.

## When in doubt

Stop and ask. The "Ask before" section of `CLAUDE.md` lists changes (auth, schema,
`lib/` internals, role enum, new public routes, dependency adds) that require
explicit sign-off before you make them.
