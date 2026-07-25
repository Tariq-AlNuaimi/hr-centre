# Open items — the "come back to this later" backlog

**Snapshot: 2026-07-18.** One place to see everything deferred, waived, dormant, or scheduled in
the repo, so you can pick any of it up cold. This is a **convenience index** — the authoritative
records stay in `docs/findings-register.md`, `docs/HARNESS-V2-CLOSEOUT.md`, and `SECURITY.md §15/§16`.
When you resolve an item, update the source record; re-generate the gist here if useful.

**Legend** — Effort: S (hours) · M (a day) · L (multi-day/own program). Blocked-by tells you what
gates it.

| #   | Item                                                                          | Category        | Effort       | Blocked by                          |
| --- | ----------------------------------------------------------------------------- | --------------- | ------------ | ----------------------------------- |
| 1   | ✅ **DONE** (2026-07-25) — Breadcrumb humanizes raw route segment             | UI polish       | S            | —                                   |
| 2   | ✅ **DONE** (2026-07-25) — Scaffold emits a per-enum humanized label file     | Harness/i18n    | M            | —                                   |
| 3   | ✅ **DONE** (2026-07-25) — Pinned `ccusage`/`scan`/`lhci` floats              | Supply-chain    | S            | —                                   |
| 4   | ✅ **DONE** (2026-07-25) — Asset **location** field (T4)                      | Feature         | S            | —                                   |
| 5   | ✅ **DONE** (2026-07-25) — Asset **warranty** fields (T6)                     | Feature         | S            | —                                   |
| 6   | ✅ **DONE** (2026-07-25) — Asset list **bulk actions** (multi-select delete)  | Feature         | M            | —                                   |
| 7   | ✅ **DONE** (2026-07-25) — Retired the `category` enum axis (Category entity) | Feature/UX      | M            | —                                   |
| 8   | WS-5 embeddings **provider round-trip**                                       | AI/RAG          | S once keyed | `EMBEDDINGS_API_KEY` + egress       |
| 9   | `ai-eval` `/ship` gate (dormant)                                              | AI quality      | —            | a fork adds `AI_API_KEY` + fixtures |
| 10  | SSO / Microsoft Entra (dormant)                                               | Auth            | —            | `AUTH_MICROSOFT_ENTRA_ID_*` env     |
| 11  | Dormant CI (`sast.yml`/`zizmor.yml`/`lhci`/senior-review)                     | CI/security     | —            | paid Actions / handoff              |
| 12  | Remove **bcryptjs**                                                           | Debt sunset     | S            | legacy `$2*` hashes = 0 for 90d     |
| 13  | Retire the **antd type-shim**                                                 | Debt sunset     | S            | next DataTable refactor             |
| 14  | **Better Auth** migration                                                     | Auth/program    | L            | ADR-056 trigger fires               |
| 15  | Full **bus-factor** program (multi-maintainer, CI)                            | Harness/program | L            | team growth                         |
| 16  | ✅ **VERIFIED+FIXED** (2026-07-25) — Atomic audit recipe (opt-in, now proven) | Security        | M            | —                                   |
| 17  | ✅ **DONE** (2026-07-25) — Per-account lockout (limiter half already ADR-035) | Security        | M            | —                                   |
| 18  | uptime monitoring / Storybook recipes (#28)                                   | Ops/DX          | M            | need arises                         |

---

## A. Actionable now (no external dependency)

### 1. Breadcrumb route-segment humanization — **S**

The dashboard breadcrumb renders the raw path segment (`asset`, `custom-field-def`) instead of a
label ("Assets", "Custom fields"). Add a segment→label lookup (or next-intl key) in the shared
breadcrumb component. Register: `V2-301/design` (a).

### 2. Scaffold enum-humanization → next-intl — **M**

`components/asset/asset-labels.ts` is a per-feature humanizer for enum values (LAPTOP → "Laptop").
`scripts/scaffold-entity.mjs` should generate a label map per enum for every scaffolded entity, and
ultimately route those labels through `messages/*.json` (V2-305 copy chokepoint) instead of a
per-feature map. Register: `V2-301/design` (b). (The scaffold **copy** pluralization/humanization
was already fixed 2026-07-18 — this is the remaining enum-label piece.)

### 3. Pin the `@latest` dev-tool floats — **S**

`npm run tokens` (`ccusage@latest`), plus the pre-existing `scan` and `lhci` `@latest` floats, are
unpinned. Low blast radius (local dev-reporting), `npm audit` clean. Pin all three in one pass.
Register: `V2-106/supply-chain`.

### 4–6. Asset Tracker feature gaps — ✅ **ALL DONE (2026-07-25)**

The pilot graduated to T2/T9/T11; these three remaining table-stakes sub-features are now closed
(`docs/blueprints/asset-tracker.md` parity table + app-floor checklist updated):

- **T4 location** — ✅ `Asset.location` (nullable, additive migration), on the form + record type.
- **T6 warranty** — ✅ `Asset.warrantyExpiresAt` + `warrantyTerms` (same migration).
- **Bulk actions** — ✅ multi-select on the list via the shared `DataTable`'s existing
  `rowSelection`, driving `POST /api/asset/bulk-delete`. The bulk write stays audited: per-row
  `prisma.asset.delete` inside ONE `$transaction`, never `deleteMany` (ADR-010 /
  `no-unaudited-bulk-write`) — verified live (3 deletes → 3 DELETE `audit_logs` rows + all three
  soft-deleted/recoverable). Captures + critique: `docs/verification/asset-bulk-actions/`.

### 7. Cascade: replace the enum axis — ✅ **DONE (2026-07-25)**

Operator product call: **drop the enum axis.** The asset form's legacy `category` `Select` is
removed; an asset's category is derived from `model → AssetModel.category → Category`, now the
single source of truth. The list column renders the derived name (`-` when an asset has no model)
and filters by category entity (`?categoryId=` → `where: { model: { categoryId } }`). Enum reads/
writes are gone from validation, form, columns, list route, and CSV import.

**Phase 2 SHIPPED (same day).** With phase 1 confirmed unreleased — nothing was ever deployed
running the pre-phase-1 code, so the one-deploy soak had nothing to wait for — the operator chose to
drop immediately. Migration `20260725060000_drop_asset_category_enum_axis` removes the column then
the `AssetCategory` type. Hand-written to keep out the `DROP TABLE "document_embedding"` that
`migrate dev` proposes (the pgvector RAG store isn't a Prisma model, so the differ mis-reads it as
drift); RAG table verified intact afterwards. Captures/critique:
`docs/verification/asset-category-entity/`.

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

### 15 & 18. Bigger DX/ops slices — **L / M**

- **Full bus-factor program** (#27): a bounded slice shipped (`docs/harness-orientation.md` + the
  V2-505 maintainer runbook); the full program (multi-maintainer redundancy, CI activation) remains.
- **uptime monitoring / Storybook** (#28): `docs/oss-catalog.md` catalog entries suffice for now;
  wire real ones when the need arises.

---

## B. Blocked on external config (self-activate when a fork turns them on)

These aren't "unfinished" — they're built and **dormant by design**, waiting on env/keys. No code
work needed to "do" them; they light up on configuration.

- **8. WS-5 embeddings provider round-trip** — the pgvector substrate is verified (`fixed`,
  `tests/integration/pgvector.test.ts`); the provider half (`ragUpsert`/`ragQuery` through
  voyage/cohere) is `waived` until a fork sets `EMBEDDINGS_PROVIDER` + `EMBEDDINGS_API_KEY` with
  egress. **Watch the 1024-vs-1536 dimension trap** — set `EMBEDDINGS_DIMENSIONS` and the
  `vector(N)` column in lockstep. Register: WS-5 (adjudicated SPLIT 2026-07-17).
- **9. `ai-eval` `/ship` gate** — no-op (exit 0) until a fork sets `AI_API_KEY` AND writes
  `tests/ai-evals/*.eval.ts` fixtures; then it enforces. Register: `quality/ai` (adjudicated).
- **10. SSO / Microsoft Entra** — wired in `lib/auth.ts`, dormant until
  `AUTH_MICROSOFT_ENTRA_ID_ID` + `_SECRET` + issuer are set (then a "Sign in with Microsoft" button
  appears; `AUTH_ENFORCE_SSO=true` makes it the only path). SECURITY.md §1 (SSO/OAuth).
- **11. Dormant CI** — `sast.yml` / `zizmor.yml` (PyPI-pinned) / `lhci` / the `senior-code-reviewer`
  workflow are authored but `workflow_dispatch`-only (free-plan / ADR-007/037). They activate at
  `/handoff` to a team with paid Actions. The local `/audit` + `/ship` + post-push agent cover the
  gap meanwhile.

---

## C. Condition- / time-triggered debt sunsets

- **12. bcryptjs** (`lib/password.ts`) — kept ONLY to verify pre-existing `$2*` hashes. Run the
  count query in the sunset block; when durably **0 for 90 days**, delete the bcrypt branch +
  `npm uninstall bcryptjs`. Register: `debt sunset V2-409`.
- **13. antd type-shim** (`components/shared/table-types.ts`) — a compatibility shim; retire it
  after the next DataTable refactor. Register: `debt sunset V2-409`.

---

## D. Decision-gated (needs an operator call before any work)

- **14. Better Auth migration** — ADR-056 recorded **STAY FROZEN**; a migration (2FA/passkeys/
  magic-link) only starts if an ADR-056 trigger fires, and then as its own blueprinted program. Not
  pending work — a standing decision to revisit on a trigger.

---

## Not included here (intentional, not debt)

- Scaffold/template **stub TODOs** (`scripts/scaffold-ai-endpoint.mjs` prompt-crafting comments,
  `uat-pdf.mjs` `TODO(P#)` report-section anchors) are template placeholders a fork fills in per use,
  not repo backlog.
- The HARNESS-V2 program itself is **CLOSED** (all 48 items done; `docs/HARNESS-V2-CLOSEOUT.md`).

## How to pick something up

1. Read the source record (the register/SECURITY/blueprint pointer on the item).
2. `/blueprint` if it's a real multi-file feature (items 4–7, 15–17); act directly for the S items.
3. Land it green (`/ship`), update the source record's status, and refresh this index.
