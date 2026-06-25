# Benchmark — Enterprise UI library & standard app skeleton

**Status:** Research / proposal (decisions open — see §5)
**Date:** 2026-06-25
**Owner:** Tariq Al-Naaimi
**Context:** Market-benchmark pass (CLAUDE.md "Market benchmark before building") for two operator
requests: (1) replace Ant Design with a more attractive, enterprise-grade UI layer; (2) define a
standard app skeleton / information architecture that every fork should follow.

> **Locked-stack note.** Ant Design 6 is part of the ADR-001 locked stack ("forks change them only by
> raising a new ADR that supersedes the relevant section"). A UI-library swap is therefore an
> **Ask-before** change requiring a superseding ADR + operator sign-off. This document is the research
> and recommendation that ADR would cite — it changes no application code.

---

## Part A — UI library benchmark

### What AntD gives us today (the bar to beat)
Batteries-included: large component set, integrated `Table` (sort/filter/paginate), ProComponents,
built-in RTL via `direction="rtl"`, i18n. Weaknesses: (a) heavier "enterprise admin" visual style that
reads dated vs modern products; (b) historically weaker ARIA than Radix/MUI stacks (improving in v6);
(c) CSS-in-JS that **forces `'unsafe-inline'` on our CSP** (ADR-001 Consequences) and needs `'use client'`
plumbing under RSC. Goal: **more attractive + still enterprise-grade + RSC-friendly + RTL + axe-clean +
low migration risk.**

### Top repos / libraries (2025–2026)

| Option | Stars | License | Type | RSC / App Router | RTL | a11y | Attractiveness vs AntD | Migration from AntD |
|---|---|---|---|---|---|---|---|---|
| **shadcn/ui** (Radix + Tailwind) | ~75k | MIT | Copy-in (you own the code) | Excellent | Yes (`--rtl`, Radix `DirectionProvider`) | Excellent | Much higher | Moderate effort, low risk; needs Tailwind; assemble Table via TanStack |
| **MUI (Material UI)** | ~96k | MIT (+paid X) | Batteries-included | OK (client/Emotion) | Mature (stylis-plugin-rtl) | Excellent | Slightly higher | Easiest concept map; best data grid; heavy; X license tiers |
| **Mantine** | ~28k | MIT | Batteries-included | Strong (CSS Modules, no runtime) | Yes | Good | Higher | Lowest-friction batteries swap |
| **Chakra UI v3** | ~39k | MIT | Batteries-included | Full RSC (rewritten on Ark UI) | Yes | Good | Higher | Moderate; no first-party data grid |
| **HeroUI** (ex-NextUI) | ~28k | MIT | Component lib (React Aria) | Yes (Next template) | Yes (Aria) | Excellent | Highest | Moderate; v3 still beta (risk) |
| **Refine** | ~35k | MIT | Headless internal-tools framework | Yes | via UI kit | via UI kit | n/a (skin-dependent) | Large architectural change |
| **Tremor** | ~16.5k | MIT | Dashboard/chart blocks (Radix+Tailwind) | Yes | Tailwind | Good | Higher (charts/KPIs) | Complement, not replacement |
| **Radix Primitives** | — | MIT | Headless engine under shadcn | Excellent | Yes | Excellent | n/a | Choose via shadcn |
| **Tailwind Plus / Catalyst** | paid | Commercial | Copy-in (paid) | Yes | Tailwind | Good | Higher | Supplement; no data grid |
| **Aceternity / Magic UI** | ~28k | MIT | Marketing animations | Yes | n/a | n/a | Flashy (marketing only) | Not applicable — skip for internal tools |

Reference scaffolds to mine for layout (not libraries): `Kiranism/next-shadcn-dashboard-starter`,
`arhamkhnz/next-shadcn-admin-dashboard` (both Next 16 + shadcn + Tailwind v4, MIT). Honorable mentions:
Ant Design Pro (~38k — doubles down on the AntD look), Saas-ui (Chakra-based), Park UI (Ark + Panda).

### Recommendation
**Primary: shadcn/ui (Radix + Tailwind), + Tremor for dashboards.** Best fit for *attractive + enterprise +
RSC + RTL + axe-clean*: most modern default aesthetic, best App-Router/RSC integration, native RTL for our
`ar` requirement, Radix-grade a11y (directly serves our axe gate and *improves* on AntD's ARIA), MIT with
**no vendor lock-in — you own the component source**, which suits a forkable, handed-off template. It also
lets us **drop `'unsafe-inline'` from the CSP** over time (no CSS-in-JS), tightening ADR-001's known CSP
compromise. Enterprise tables come from the well-trodden **TanStack Table + shadcn** pattern; **Tremor**
gives on-brand KPI/chart blocks that pair with our existing recharts usage.

*Honest trade-offs:* shadcn is *copy-in components you maintain*, not batteries-included — you assemble
Table/DatePicker/Form rather than inheriting AntD's integrated ones, and it **requires adopting Tailwind**,
which touches our token policy (`no-raw-hex-color`, `antd-theme.ts`, `app/tokens.css`) and
`docs/design-recipes.md` + the `/design-system` skill.

**Batteries-included alternative: MUI** (lowest-conceptual-risk swap, best enterprise data grid, near
drop-in for AntD `Table`; costs: bundle weight, client-side Emotion, MUI X license tiers) — or **Mantine**
as the lighter, more modern middle path that keeps AntD-style "everything included" ergonomics.

**Decision rule:** willing to adopt Tailwind + own components → **shadcn/ui (+ Tremor)**. Want a near
drop-in that preserves the integrated-component workflow + enterprise grid → **MUI**, with **Mantine** as
the lighter compromise.

### AntD migration surface in *this* repo (measured)
~30 source files import `antd`/`@ant-design`, plus the design harness is coupled to it: `antd-theme.ts`,
the `no-raw-hex-color` ESLint rule, `docs/design-recipes.md`, the `/design-system` skill, and
`scripts/scaffold-entity.mjs` page templates. The shared primitives that would be re-skinned:
`components/shared/{DataTable,PageHeader,EmptyState,Chart,KanbanBoard,ConfirmAction,Skeletons}.tsx` and the
layout shell (`AppShell/AppHeader/AppSidebar/Breadcrumbs/ThemeProvider`). Bounded but real — a genuine
stack change, not a cosmetic tweak. A phased path (shell + shared primitives first, then per-page, with the
scaffold templates last) keeps each step shippable.

---

## Part B — Standard enterprise app skeleton (information architecture)

Synthesized from the navigation/IA of **Linear, Stripe, Vercel, Notion, Salesforce Lightning, Jira** plus
top admin-starter repos. The convergent patterns below are the proposed benchmark for every fork.

### Convergent patterns (what every serious app does)
1. **Two-tier (often three-tier) settings split.** Universal: **personal** settings (Linear "Account",
   Stripe "Personal details", Vercel "Personal Account", Salesforce "My Settings", Jira "Personal settings")
   are kept strictly separate from **org/workspace** settings (members, billing, security, audit). Jira is
   the most explicit with **personal → product → org** tiers. *The #1 pitfall is mixing personal profile
   with org settings — don't.*
2. **Command palette + global search are table stakes.** Linear, Vercel, Jira, Notion all ship **⌘K**;
   all six ship a persistent global search. (Stripe/Salesforce lean on search rather than ⌘K.)
3. **Audit log lives under org → Security**, ~90-day retention is the common bar (Linear 90d, Vercel 90d,
   Stripe 180d view), all streamable to SIEM at the top tier.
4. **Role spine = Owner / Admin / Member(Editor) / Viewer(Guest).** Stripe and Vercel add dedicated
   **Billing-scoped** and **Developer-scoped** roles; Salesforce splits *role-based visibility* (Roles)
   from *permission grants* (Profiles + Permission Sets); Jira splits org-admin / product-admin /
   user-access-admin. Member management lives under org → Members/People/Users.
5. **Member off-ramps are deactivate/suspend, not delete** (Salesforce Deactivate/Freeze, Jira
   Remove/Suspend/Deactivate) — preserves records & audit trail. Matches our soft-delete invariant.
6. **Notifications**: either a centralized **Inbox** (Linear/Notion) or surfaced on **home/activity**
   (Stripe/Vercel), with per-user notification preferences living in *personal* settings.
7. **Impersonation** ("log in as user") is rare and admin-gated — only Salesforce documents it. Treat as an
   opt-in, heavily-audited admin feature, not a default. Guardrails if built: a **new isolated session**
   (never reuse tokens), a **visible "impersonating" banner**, an **audit entry attributed to both** admin
   and target user, and a **hierarchy bound** (can't impersonate a more-privileged user).
8. **Keep ≥2 Owners** (GitHub ownership-continuity guidance) and enforce a **role hierarchy on invites** — a
   user may only assign roles at or below their own level (prevents privilege escalation via the invite UI).
9. **Hide vs disable.** *Hide* a control a role can **never** use; *disable + explain* one they could use but
   a prerequisite is missing. Never silently fail; an unauthorized view is an honest "you don't have
   permission" state, optionally with a "request access" CTA.
10. **Three distinct "activity" surfaces — don't conflate them.** Notifications (per-**user**, top-bar
    bell/inbox), Audit log (org-wide, immutable, admin-only, under Settings → Security), and Activity
    timeline (per-**record**, inline on the detail view).
11. **Onboarding = a 3–5 item checklist with a progress bar on Home** (Shopify Guides / Salesforce
    Assistant); checklists with progress hit ~67% completion vs ~35% without. Every empty state is
    instructional with one primary action — never a dead void.
12. **Settings deep-nest** — put a **fuzzy search box at the top of Settings**; users can't predict where a
    control lives.

### Proposed standard sitemap (sidebar groups → pages → sub-pages)

```
┌─ Top bar: global search · ⌘K command palette · Create · notifications bell · help (?) · avatar menu
│
├─ WORK (primary)
│   ├─ Dashboard / Home          → KPIs, recent activity, quick actions, "assigned to me"
│   ├─ <Entity A> (e.g. Projects)→ list (table) → detail → new/edit
│   ├─ <Entity B> …              → list → detail → new/edit
│   └─ Reports / Analytics       → charts, exports
│
├─ ADMIN  (visible to ADMIN; some items EDITOR)
│   ├─ Users & Members           → list · invite · role · deactivate (· impersonate, opt-in)
│   ├─ Roles & Permissions       → role definitions, permission matrix
│   ├─ Audit Log                 → org activity, filter, export (under "Security")
│   └─ Recycling Bin             → soft-deleted records restore  (already shipped)
│
├─ SETTINGS
│   ├─ Personal                  (every user)
│   │   ├─ Profile               → name, avatar, email
│   │   ├─ Account & Security    → password, 2FA, sessions, personal API keys
│   │   ├─ Notifications         → per-channel preferences
│   │   └─ Appearance & Language → theme (light/dark), locale (en/ar)
│   └─ Organization              (ADMIN)
│       ├─ General               → org name, branding/logo
│       ├─ Members & Roles       → (links to Admin → Users; canonical home)
│       ├─ Billing & Plan        → (when monetized)
│       ├─ Integrations          → connected apps, webhooks
│       ├─ API Keys              → machine credentials (the /api/v1 seam, ADR-013)
│       └─ Security              → SSO/SAML, session policy, audit-log link
│
└─ Footer: Help / Docs · Support · version
```

### Canonical Settings sub-structure (resolves the common confusion)
- **Profile** = who you are (name, avatar, email) — personal.
- **Account & Security** = your credentials & sessions (password, 2FA, personal tokens) — personal.
- **Organization** = the tenant (name, branding, members, billing, integrations, SSO, audit) — admin.
- Rule of thumb mirrored from Linear/Salesforce/Jira: *if it affects only you → Personal; if it affects
  everyone in the org → Organization.* Members/Roles/Billing/Audit are **always** org-level.

### RBAC — mapping to this template
Current model is `ADMIN | EDITOR | VIEWER` (enforced by `withAdminAuth` / `withEditorAuth` / `withAuth` in
`lib/api-helpers.ts`). That maps cleanly onto the benchmark spine:

| Benchmark role | This template | Manages |
|---|---|---|
| Owner / Admin | `ADMIN` | org settings, members, roles, billing, audit, security |
| Member / Editor | `EDITOR` | create/update entity data; no org admin |
| Viewer / Guest | `VIEWER` | read-only |

Roles are **managed under Admin → Users & Members** (assign on invite / edit). A future **Roles &
Permissions** page would surface the permission matrix read-only first. Billing/Developer-scoped roles
(Stripe/Vercel pattern) are a `/scale-up` consideration if/when the app monetizes or exposes API tooling —
not needed at the floor.

### Gap analysis — current template vs the standard

| Standard section | Status in template | Action |
|---|---|---|
| Dashboard/Home | ✅ `(dashboard)/page.tsx` | Enrich: KPIs + recent activity + quick actions |
| Entity lists/detail/new | ✅ `users/*` as the pattern | Reuse via `/scaffold-entity` |
| Users & Members (admin) | ✅ `users/*` | Add invite flow + deactivate UX (soft-delete exists) |
| Roles & Permissions page | ❌ none | **Add** read-only permission matrix |
| Audit Log | ✅ `audit-log/*` | Move conceptually under a Security/Admin group |
| Recycling Bin | ✅ `recycling-bin/*` | Keep under Admin |
| Settings — Personal/Profile | ✅ `settings/profile` | Split into Profile / Security / Notifications / Appearance |
| Settings — Account & Security | ⚠️ partial | **Add** sessions / 2FA / personal API keys (scale-up) |
| Settings — Notifications | ❌ none | **Add** preferences page |
| Settings — Organization | ❌ none | **Add** General / Integrations / API Keys / Security |
| Command palette (⌘K) | ❌ none | **Add** — table-stakes finder |
| Global search | ❌ none | **Add** (can start scoped per-entity) |
| Notifications (bell/inbox) | ❌ none | **Add** bell in top bar |
| Onboarding / empty states | ✅ `EmptyState` primitive | Apply consistently per the design rubric |
| Help/Docs in footer | ✅ `AppFooter` | Add help (?) entry point |

---

## §5 — Open decisions for the operator
1. **UI library direction** — (a) **shadcn/ui + Tremor** (recommended; adopt Tailwind, own components,
   improves CSP/a11y), (b) **MUI** (near drop-in, best grid, heavier), (c) **Mantine** (lighter
   batteries-included), or (d) **stay on AntD** and only do the skeleton work. Anything but (d) needs a
   superseding ADR + sign-off.
2. **Skeleton scope now** — adopt this sitemap as the documented standard only, *or* also scaffold the
   missing shells (Roles & Permissions, Org settings, ⌘K, notifications) into the template.
3. **Sequencing** — if swapping UI, do skeleton-on-AntD first then migrate, or migrate the shell first then
   build new sections in the new library.

---

## Sources
**UI:** github.com/shadcn-ui/ui · ui.shadcn.com/docs/rtl/next · github.com/mui/material-ui ·
mui.com/material-ui/customization/right-to-left · mantine.dev · github.com/chakra-ui/chakra-ui ·
github.com/heroui-inc/heroui · github.com/refinedev/refine · github.com/tremorlabs/tremor ·
radix-ui.com/primitives · catalyst.tailwindui.com · github.com/Kiranism/next-shadcn-dashboard-starter ·
github.com/arhamkhnz/next-shadcn-admin-dashboard
**IA:** linear.app/docs/{members-roles,my-issues,inbox,audit-log,account-preferences,search} ·
docs.stripe.com/{dashboard/basics,get-started/account/teams/roles,activity-logs,dashboard/search} ·
vercel.com/docs/{accounts,rbac/access-roles,audit-log,concepts/dashboard-features/command-menu} ·
notion.com/help/{home-and-my-tasks,add-members-admins-guests-and-groups,audit-log,account-settings} ·
help.salesforce.com (My Settings vs Setup; Profiles/Permission Sets/Roles; Login Access Policies) ·
support.atlassian.com (new navigation; command palette; admin roles; audit logs)
</content>
</invoke>
