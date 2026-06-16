---
name: conform
description: Bring foreign code (built in another tool, or in an old Claude Code project that never used this template) up to this template's standard, then push it to a new repo created from the template. Security-scans first, reports gaps against the hard-rules, fixes ONLY what the operator approves, never silently. Use when the user says "make this match my standard", "conform this code", "/conform", "I built this elsewhere, bring it up to standard", or drops a folder of foreign code.
---

# /conform — Bring foreign code up to the template standard

This template is a **standard**, not just a starter. `/conform` is the path for code
that already exists somewhere else — another tool, a no-code export, an old Claude Code
project that never used this template — to be measured against that standard, brought
into line, and pushed to a fresh repo created from the template.

## The one hard rule of this skill

**Report-and-approve only. NEVER silently auto-fix foreign code.**

Foreign code does not know this template's invariants (auth wrappers, audit extension,
soft-delete, the eight ESLint rules, zod-at-boundary). A silent edit could mask a real
security gap or introduce one. Every change is proposed, line-referenced, and applied
**only after the operator approves it**. When in doubt, report — do not edit.

## Steps

### 1. Intake
Operator points `/conform` at a folder (or pastes code). Inventory it: files, language,
framework, whether it has a `package.json` / lockfile, what it appears to do. Do **not**
run it. Summarize what you found.

### 2. Security scan FIRST (never trust foreign code)
Run **`/audit`** against the incoming code — gitleaks + npm audit + Semgrep — **before
reading deeply or running anything**. Report findings (secrets, dependency CVEs, SAST).
If `/audit` reports hardcoded secrets, flag them as the top priority and note they must
be removed + rotated, not just relocated.

### 3. Standard check
Check the code against this template's hard-rules (from `CLAUDE.md` / `SECURITY.md`):

- API route handlers wrapped with `withAuth` / `withAdminAuth` / `withInternalAuth`.
- No raw SQL outside parameterized `prisma.$queryRaw`; no `$executeRawUnsafe` on input.
- No Prisma import in `"use client"` components (UI → API route → service → Prisma).
- zod validation at every API boundary.
- No hardcoded secrets; all config via env vars.
- Auth + role checks present where data is read/written; row-level scoping where needed.
- `session` never cast to `any`.
- Audit + soft-delete posture for new entities (or a noted reason they're absent).

Produce a **conformance report**, every item line-referenced:

```
/conform report — <path>
  ✅ conforms   — <rule>: <file:line>
  ⚠️  gap        — <rule>: <file:line> — <what's missing>
  ❌ violation   — <rule>: <file:line> — <what's wrong + why it matters>
```

### 4. Plan
For each ⚠️/❌, propose how to close it — rewrite the handler to use a wrapper, add a zod
schema in `lib/validations/`, move a secret to env, scaffold missing CRUD via
`/scaffold-entity`, etc. Present as a **checklist**, one approvable line per change.

### 5. Approve  — [CONFIRM]
**Show the operator the conformance report (step 3) and the change checklist (step 4),
and wait for explicit approval before touching anything.** Approval is per-change: the
operator can accept some and decline others. **No edit happens in step 6 without it.**

### 6. Align
Apply ONLY the approved changes. Then re-run **`/audit`** and **`/ship`** to verify the
result is clean and green. If anything is still red, report and stop — do not paper over it.

### 7. Push
Create a new repo **from this template** (use `/first-fork` as the on-ramp while GitHub
Actions billing is blocked — `/new-project` cannot run; see ADR-007), drop the conformed
code in, run `/rebrand`, set the project **tier** (`personal` or `shared`, see Phase 8 /
`CLAUDE.md`), and push. Vercel deploys from there.

## Do NOT in this skill

- Do **not** edit foreign code before the operator approves the change checklist (step 5).
- Do **not** skip the `/audit` scan (step 2) — it is mandatory and comes first.
- Do **not** run foreign code to "see what it does."
- Do **not** relocate a hardcoded secret into env and call it fixed — a committed secret
  must be rotated, because it is already in that code's history.
- Do **not** mark the result conformed until `/audit` is clean (or accepted) and `/ship`
  is green.
