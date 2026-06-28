# QA matrix — Phases 7–8 deferred a11y / RBAC closure

**Date:** 2026-06-28 · **Branch:** `claude/rihal-phases-7-8-qa-so8cim` · **Tier:** see `project.config.json`

Closes the QA matrix the Phase-7/8 session deferred: **automated axe a11y**, the
**full `/uat` permission matrix**, **per-entity CRUD journeys**, and the **per-role
RBAC** verification. All of it runs locally via `npm run uat:full` against a seeded
carbon-copy Postgres (the live host is proxy-blocked from the build container — see
"Honest gaps"). The harness is discovery-driven (routes, roles, and admin-gating are
read from the codebase, never hardcoded), so it stays correct as the app grows.

## How to run

```bash
# one-time local DB (see docs/agent-memory.md for the postgres-as-root recipe)
DATABASE_URL=postgresql://postgres@localhost:5433/appdb?schema=public \
  npx prisma migrate deploy
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=… SEED_SAMPLE_DATA=1 \
  npx tsx prisma/seed.ts

# full QA matrix (a11y + permission matrix + CRUD journey + UI/UX sweep)
PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
DATABASE_URL=… SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… \
  npm run uat:full
```

## Result — GREEN (52/52)

| Tier | Spec | Coverage | Result |
|---|---|---|---|
| Lean smoke | `smoke.uat.ts` | 8 dashboard sections load authenticated | 11/11 ✓ |
| Accessibility | `a11y.full.uat.ts` | axe WCAG2 A/AA on 8 dashboard sections + public **login** + **methodology**; no serious/critical | 11/11 ✓ |
| RBAC matrix | `roles.full.uat.ts` | `HR_ADMIN` × `HIRING_MANAGER` × 8 sections, expected reach derived from each page's server gate | 16/16 ✓ |
| CRUD journey | `crud.full.uat.ts` | invitation lifecycle: **send → confirm in list → revoke** (admin-gated, audited) | 1/1 ✓ |
| UI/UX sweep | `uiux.full.uat.ts` | per-section: no runtime errors, real heading, **RTL** (`ar` flips `dir="rtl"`); + nav-vs-server gate consistency | 10/10 ✓ |

### RBAC matrix (the per-role truth)

Expected reach is read from each section page's own `requireAdmin` / `requireSession`
call in `lib/authz` — the enforced server gate, not nav visibility.

| Section | Server gate | `HR_ADMIN` | `HIRING_MANAGER` |
|---|---|---|---|
| dashboard | requireSession | reach ✓ | reach ✓ |
| roles | requireSession | reach ✓ | **reach ✓** (read-only by design) |
| candidates | requireSession | reach ✓ | reach ✓ |
| compare | requireSession | reach ✓ | reach ✓ |
| invites | requireAdmin | reach ✓ | **blocked ✓** |
| calibration | requireAdmin | reach ✓ | **blocked ✓** |
| settings | requireAdmin | reach ✓ | **blocked ✓** |
| audit | requireAdmin | reach ✓ | **blocked ✓** |

A blocked manager is server-redirected to `/app` (verified live as `redirected-away`),
not merely nav-hidden — RBAC is enforced server-side per UI-SPEC Part E.

**Avoiding a false green.** The matrix derives *expected* reach from each page's own
`requireAdmin` call, so on its own it proves "the runtime enforces what the page
declares" (catches middleware bypass, client-only hiding, partial enforcement) — but a
*deleted* gate would flip expected and actual together and stay green. The `uiux`
nav-consistency check closes that hole: `nav.ts`'s per-item `adminOnly` flag is an
**independent** declaration of admin-only intent, so a nav-admin section whose page is
no longer `requireAdmin` fails as **under-protected** (with an explicit, documented
allowlist for the one intentional manager-readable section, `roles`). The two checks
together catch both a broken-UX gate (nav-visible → bounce) and a removed gate
(nav-admin → reachable).

## Harness bugs found & fixed (template-portability, surfaced by this QA)

These were defects in the **inherited UAT harness**, not the app — the generic template
specs assumed template conventions this fork doesn't use. Fixing them is what made the
matrix trustworthy rather than vacuously green:

1. **Section admin-gating read the wrong source.** `discoverSectionAccess` parsed
   `components/layout/AppSidebar.tsx`, which doesn't exist here (this fork uses
   `nav.ts` + `SidebarNav.tsx`). It silently classified every section as all-roles.
   → Rewritten to derive admin-only from each page's real `requireAdmin` gate.
2. **Privileged role hardcoded `"ADMIN"`.** This fork's privileged role is `HR_ADMIN`
   (first `Role` enum member). The matrix therefore *expected `HR_ADMIN` to be blocked*
   from admin-only sections. → Derive the privileged role from `discoverRoles()[0]`
   (the documented convention) in both `roles.full.uat.ts` and `roles.setup.ts`.
3. **Per-role login wait never matched.** `roles.setup.ts` waited for `/<locale>/?$`,
   but this fork lands authenticated users on `/<locale>/app`, so every non-admin role
   silently skipped (empty matrix column). → Accept `/<locale>(/app)?/?$`.

## App finding (design call, not a bug)

`nav.ts` marks **roleProfiles** `adminOnly: true` (hidden from the manager sidebar),
but `app/roles/page.tsx` + `[id]/page.tsx` use `requireSession`, so a manager **can**
view role profiles by URL. This is **intentional manager read-only access** (the page
has `emptyBodyManager` copy and gates create/edit behind `isAdmin`); only authoring
(`/new`, `/[id]/edit`) is `requireAdmin`. The `uiux` nav-consistency check records this
as a *benign* divergence (nav stricter than server) and only fails the dangerous
direction (a manager-visible nav link pointing at an admin-only page) — none exist.

## Honest gaps (deferred, logged in `docs/findings-register.md`)

- **Production not re-verified from this container.** `https://rihal-aptitude.ops-rihal.com`
  is proxy-blocked (403 CONNECT) from the build env; QA ran against a local carbon-copy.
  The deploy was `READY` per the prior handoff, but this session did not independently
  re-confirm the live URL. Re-verify from a direct-egress machine.
- **Candidate runner `/a/[token]` automated a11y.** The axe gate covers the
  authenticated dashboard + public login/methodology, but not the token-gated runner
  (no live token is minted in the harness). The runner already passed a **thorough
  manual** axe pass in Phase 4 (EN+AR × light+dark × mobile, 16 combos, green — see the
  register), so this is regression-protection enhancement, not an open coverage gap.
  A future improvement: a setup that mints a raw token (`lib/token`) + seeds an
  invitation so the runner joins the automated gate.
- **Role-profile CRUD via the AI wizard is not automated.** Authoring a role profile
  runs the AI drafting step (LLM via `litellm.rihal.dev`), which is unset locally
  ("not configured"). CRUD coverage is provided through the invitation lifecycle (a
  real, admin-gated, audited write loop) instead.
