# Archived open items — 2026 (closed rows)

**Archived 2026-08-17** from `docs/OPEN-ITEMS.md` (governance-consolidation pass, C4). Nothing was
deleted: every row below was already marked ✅ **DONE**, ⬜ **MOOT**, or **WON'T DO** by an operator
decision. They were moved off the live backlog so `docs/OPEN-ITEMS.md` shows only what is actually
still open (items 8–11, all "blocked on external config").

The authoritative records remain `docs/findings-register.md` (+ its archive,
`docs/archive/findings-register-2026.md`) and `SECURITY.md §15/§16`. This file is the backlog's
closed-row history — read it to see what was decided and why, not to pick work up.

| #   | Item                                                                          | Category     | Effort | Closed                       |
| --- | ----------------------------------------------------------------------------- | ------------ | ------ | ---------------------------- |
| 1   | ✅ **DONE** (2026-07-25) — Breadcrumb humanizes raw route segment             | UI polish    | S      | shipped                      |
| 2   | ✅ **DONE** (2026-07-25) — Scaffold emits a per-enum humanized label file     | Harness/i18n | M      | shipped                      |
| 3   | ✅ **DONE** (2026-07-25) — Pinned `ccusage`/`scan`/`lhci` floats              | Supply-chain | S      | shipped                      |
| 4–7 | ⬜ **MOOT** (2026-07-25) — Asset Tracker feature work; demo domain removed    | Feature      | —      | domain removed               |
| 12  | ✅ **DONE** (2026-07-25) — bcryptjs removed; Argon2id is the only algorithm   | Debt sunset  | S      | shipped                      |
| 13  | ❌ **WON'T DO** (2026-07-25) — AntD type-shim retirement                      | Debt         | M      | reclassified as deliberate   |
| 14  | ❌ **WON'T DO** (2026-07-25) — Better Auth migration                          | Auth         | L      | already settled by ADR-056   |
| 15  | ❌ **WON'T DO** (2026-07-25) — bus-factor program                             | Process      | L      | bounded slice shipped        |
| 16  | ✅ **VERIFIED+FIXED** (2026-07-25) — Atomic audit recipe (opt-in, now proven) | Security     | M      | verified against Postgres 16 |
| 17  | ✅ **DONE** (2026-07-25) — Per-account lockout (limiter half already ADR-035) | Security     | M      | shipped                      |
| 18  | ✅ **DONE** (2026-07-25) — uptime recipe written; Storybook recipe de-staled  | Ops/DX       | M      | shipped                      |

---

## Closed — shipped

### 1. Breadcrumb route-segment humanization — ✅ **DONE (2026-07-25)**

The dashboard breadcrumb rendered the raw path segment (`asset`, `custom-field-def`) instead of a
label ("Assets", "Custom fields"). Fixed in `components/layout/Breadcrumbs.tsx`: a
`segmentToNavKey` lookup with a kebab/snake → Title Case humanizing fallback for segments with no
nav key. Register: `V2-301/design` (a).

### 2. Scaffold enum-humanization → next-intl — ✅ **DONE (2026-07-25)**

The pilot carried a per-feature humanizer for enum values (LAPTOP → "Laptop"); it went with the
demo domain (2026-07-25), but the scaffold-side gap it described was the durable part. Fixed in
`scripts/scaffold-entity.mjs`, which now emits `components/<kebab>/<Pascal>Labels.ts` — a humanized
display label per enum value (`humanizeEnumValue`) — for every scaffolded entity; the DB/API keep
the raw enum VALUES, only display is humanized. Routing those labels through `messages/*.json`
(V2-305 copy chokepoint) remains the eventual shape. Register: `V2-301/design` (b). (The scaffold
**copy** pluralization/humanization was already fixed 2026-07-18.)

### 3. Pin the `@latest` dev-tool floats — ✅ **DONE (2026-07-25)**

`npm run tokens` (`ccusage@latest`), plus the pre-existing `scan` and `lhci` `@latest` floats, were
unpinned. All three are now pinned in `package.json`: `ccusage@20.0.18`, `react-scan@0.5.7`,
`@lhci/cli@0.15.1`. Register: `V2-106/supply-chain`.

### 4–7. Asset Tracker feature gaps — ⬜ **MOOT (2026-07-25)**

These four items tracked table-stakes gaps in the V2-210 **Asset Tracker pilot** (location,
warranty, list bulk actions, retiring the `category` enum axis). All four shipped, and then the
whole demo domain was **removed from the template** on 2026-07-25 — it was pilot residue that
every fork inherited hard-wired into the sidebar, never advertised in `README.md`, with no
removal path. The work, its blueprint, its benchmark, and its captures are recoverable from the
archive tag (`docs/ARCHIVE.md`); the adjudication is in `docs/archive/findings-register-2026.md`.
Nothing here is actionable — a fork that wants an asset tracker runs `/scaffold-entity`.

### 12. bcryptjs sunset — ✅ **DONE (2026-07-25)**

Was listed as a pending debt sunset; it SHIPPED 2026-07-25 (removed; Argon2id-only). The waived
half — the "0 legacy hashes for 90 days" durability condition, unobservable in an ephemeral
container — is recorded on the register entry. See `docs/archive/findings-register-2026.md`.

### 16. Atomic audit (Postgres triggers) — ✅ **VERIFIED + FIXED (2026-07-25)**

`ADR-010` accepted a non-atomic audit gap for the prototype rail. The closing recipe
(`docs/recipes/shared-security/4-atomic-audit-triggers.md`) existed but had **never been run** —
unrun PL/pgSQL for a control a fork would be asked to _prove_. Now executed verbatim against real
Postgres 16 with a committed 12-case battery: atomicity (`ROLLBACK` → 0 audit rows) and the
bulk/`upsert` coverage the app extension can't see are **proven**. Found + fixed one real defect —
an unresolvable actor GUC raised an FK violation that **broke the data write itself**; it now
degrades to an unattributed audit row. Evidence: `docs/verification/atomic-audit-triggers/`.

**Still opt-in, deliberately** — NOT the template default. ADR-010 accepts app-level audit for the
prototype rail and the recipe says not to add trigger ceremony to a throwaway. A fork that needs
tamper-evident audit applies it (and, per the recipe, records its own ADR). SECURITY.md §16 row 2.

### 17. Account lockout / distributed rate limit — ✅ **DONE (2026-07-25)**

This item was **two things, and one was already built**:

- **Distributed rate limit — already shipped (ADR-035).** `lib/rate-limit.ts` already uses shared
  Valkey/Redis state when `VALKEY_URL`/`REDIS_URL` is set, degrading to in-memory otherwise. Nothing
  to build; it activates on config. The backlog text understated this.
- **Per-account lockout — genuinely missing, now built.** `lib/account-lockout.ts` counts failures
  per EMAIL (the IP bucket structurally can't: an attacker rotating IPs stays under every bucket
  while hammering one account) and is wired into `lib/auth.ts` `authorize()`. **ON by default** —
  5 fails / 15 min window / 15 min lock, tunable via `ACCOUNT_LOCKOUT_*`.

Built on the **already-shipped** `rate-limiter-flexible` + Valkey seam, NOT the recipe's Upstash
pairing — the recipe predates ADR-035, and adopting it would have meant a second Redis vendor, a
second set of credentials, and a duplicate degrade path (build-vs-buy ledger 2026-07-25). Zero new
dependencies. Non-enumerable by construction: a miss and a bad password both count and both return
`null`. 7 contract tests. SECURITY.md §16 row 4 + the A07 row updated.

### 18. uptime monitoring / Storybook — ✅ **DONE (2026-07-25)**

Storybook already had a recipe (`docs/recipes/dx/1-storybook.md`) but it was **materially stale** —
it described the shared components as **AntD** components and its decorator imported
`ConfigProvider` from `antd`, which ADR-029 uninstalled; following it produced
`Cannot find module 'antd'` on the first run. Corrected to the real `next-intl` +
`DirectionProvider` + `dark`-class stack (5 stale references fixed). Uptime had no recipe — wrote
`docs/recipes/ops/1-uptime-monitoring.md`, grounded in the health endpoint the template **already
ships** (`/api/health`: public per `i18n/route-decision.ts`, real `SELECT 1` DB check, honest
200/503). Includes the Neon free-tier auto-suspend trap and the 2-consecutive-failures rule.
Neither recipe was executed (Storybook is a large devDependency install; uptime is third-party SaaS
config) — both state their verification status explicitly.

---

## Closed — WON'T DO (2026-07-25, operator decision)

Removed from the backlog rather than deferred, because a deferred item comes back. None of the
three changes anything for a person using the app; keeping them listed manufactured the appearance
of pending work.

- **13. antd type-shim** (`components/shared/table-types.ts`) — **KEEP THE SHIM.** 78 lines of
  working types. Retiring it meant re-authoring a 605-line conversion core + 11 column-authoring
  sites and visually re-verifying ~10 list screens, for zero user-visible change. It is no longer
  "debt" — it is a deliberate, working abstraction. If `DataTable` is ever rewritten for a real
  reason, the shim goes then, as a side effect.
- **14. Better Auth migration** — **already decided by ADR-056** ("stay frozen"). Listing it here
  re-opened a settled decision as apparent work every time the backlog was read. Auth.js v5 is in
  the ADR-001 locked stack and works; account lockout (item 17) was just added to it. If a real
  trigger ever fires, ADR-056 is the entry point — not this file.
- **15. bus-factor program** — the bounded slice that matters shipped (the harness mental-model map,
  now merged into `docs/ARCHITECTURE.md`, plus the V2-505 maintainer runbook). The rest is
  multi-maintainer redundancy and CI activation for a **solo operator with no second maintainer and
  no paid Actions**. Re-open when a second maintainer actually exists.
