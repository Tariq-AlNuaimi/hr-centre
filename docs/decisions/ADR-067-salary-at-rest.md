# ADR-067 — Encryption at rest for `employees.basicSalary`

- **Status:** **Accepted — Option 2 (application-level AES-256-GCM).** Decided by the operator
  2026-08-25, against the recommendation below. Implementation pending.
- **Date:** 2026-08-24, decided 2026-08-25
- **Deciders:** Tariq Al-Naaimi (operator)
- **Related:** SECURITY.md §1 (data classes), §7 (encryption posture row), §12; ADR-065
  (identity & roles); ADR-006 (Vercel + Neon); spec §4.5, §11.3, §11.6, §11.7

## Context

`employees.basicSalary` is classified **Restricted** — the same class as `AUTH_SECRET` and
`users.passwordHash`. It is stored as a plaintext `Decimal` column in Neon Postgres.

The controls around it today are real, and all of them are **access-layer**:

| Control                                                | Where                                           |
| ------------------------------------------------------ | ----------------------------------------------- |
| Omitted from the Prisma `select` for unentitled actors | `lib/pms/employee-select.ts`                    |
| Scrubbed from every audit row                          | `SCRUB_FIELDS`, `lib/prisma/audit-extension.ts` |
| Banned as an export column                             | `no-restricted-export-column` ESLint rule       |
| Redacted in the SQL diagnostics helper                 | `scripts/neon-sql.mjs` `REDACT_FIELDS`          |
| Rendered as `[redacted]` in import preview diffs       | `lib/pms/import/reconcile.ts`                   |

Those were verified on live wire payloads: a line manager's `GET /api/employees` response does
not contain the key at all, for anyone, including their own direct reports (§4.5).

**What none of them protect against is someone who reads the database directly.** A Neon
connection string, a support export, a backup, or a compromised `DATABASE_URL` yields every
salary in the company in one `SELECT`. SECURITY.md §7 anticipated exactly this row before the
column existed; it now exists.

A second fact, established the same day and relevant here: a platform `Role.ADMIN` can reach HR
Super Admin access by two routes (ADR-065, "What this separation does and does not buy"). That
is an _application_-path disclosure, so **encryption at rest would not stop it** — the app would
decrypt for them. Encryption addresses the database-access threat only. Conflating the two is
the main way this decision gets made badly.

## Decision drivers

1. **Real Omani salary figures for named employees.** Not a generic PII column: this is the
   payload where "the database dump is the breach" applies most sharply, and where the people
   affected are the operator's own colleagues.
2. **Phase 5 computes money from it** (§11.3 bonus, §11.4 ÷365 pro-ration, §11.7 payroll export).
   Whatever is chosen has to survive that.
3. **Scale is small.** The org is three entities and on the order of hundreds of employees (the
   fixture is 43). This matters more than it first appears: it is what makes Option 2's usual
   objection — "you lose SQL ordering and aggregation" — much weaker here than it sounds.
4. **This is a prototype rail** (ADR-006, Vercel + Neon, `git push` deploys). Operator-managed
   key infrastructure is explicitly out of scope for this rail; SECURITY.md's own preamble says
   forks needing operator-managed encryption keys "belong on the IT team's stack from day zero".
5. **`/handoff` is the destination** (ADR-006 §6). Whatever is decided has to be something IT can
   take ownership of, not a bespoke scheme only this codebase understands.

## Options

### Option 1 — Accept plaintext, with the access-layer controls, and record it

Keep today's posture. Write the accepted risk into SECURITY.md §7 and the threat model as a
decision rather than an oversight, and tighten the operational controls around database access:
restrict who holds the Neon connection string, turn on Neon's audit/history features, and treat
`DATABASE_URL` rotation as a real runbook step.

- **Good:** zero engineering cost; nothing about Phase 5 changes; queryable, sortable and
  summable in SQL; no key management; no migration; IT inherits a boring Postgres column.
- **Good:** honest about what the real residual threat is — an insider or a leaked connection
  string — and puts effort where that threat actually lives (credential handling), rather than
  buying a cryptographic control that a compromised app would decrypt anyway.
- **Bad:** a database dump is a total compensation breach. Neon's at-rest disk encryption does
  not help here — it protects the physical media, not a legitimate `SELECT`.
- **Bad:** if Rihal has, or later adopts, a policy requiring column-level encryption for
  compensation data, this fails it and the migration cost only grows.

### Option 2 — Application-level AES-256-GCM on the column

Encrypt in the service layer, store ciphertext in a `String` column, decrypt in
`employee-select.ts`'s entitled path. Key in a Vercel env var (Restricted, rotatable).

- **Good:** a database dump yields ciphertext. This is the control that actually addresses the
  stated threat.
- **Good:** **cheaper here than the usual objection implies.** The standard argument against it
  is "you lose ordering, ranges and aggregation in SQL". Check that against what this system
  actually does: §11.3 computes a bonus **per employee** from that employee's own salary, and
  §11.4 pro-rates it per employee. Neither is a cross-row SQL operation. §11.7's payroll export
  is a per-employee row list. At a few hundred employees, decrypting the entitled set in
  application code is microseconds and bounded.
- **Bad:** key management on a rail that has none. A lost key is unrecoverable salary data; a
  rotated key needs a re-encryption pass. This is the whole cost, and it is not small — it is an
  operational commitment that outlives this session.
- **Bad:** breaks any future "sort the directory by salary" or "sum payroll by department"
  feature done in SQL, which would then have to move into app code with a full-set decrypt.
- **Bad:** contradicts SECURITY.md's own stated boundary for this rail (see driver 4). Taking
  this option should probably come with a superseding note on that.
- **Bad:** the migration is a data migration on Restricted values, which is the least forgiving
  kind to get wrong.

### Option 3 — `pgcrypto` (encrypt/decrypt inside Postgres)

- **Good:** less app-side plumbing than Option 2.
- **Bad:** **does not address the stated threat.** If the key travels in the SQL statement, then
  anyone with database access can decrypt — which is precisely the actor Option 2 exists to stop.
  It defends against a stolen _disk_, which Neon already handles. Listed for completeness and to
  be explicitly rejected, because it is the option that most looks like a solution without being
  one.

### Option 4 — Do not store salary at all; fetch it at bonus time

Keep only what the PMS needs to _display_ (nothing — §4.5 means almost nobody may see it), and
have Phase 5 pull salary from Odoo/payroll at computation time.

- **Good:** the strongest posture. Data you never hold cannot leak, and payroll is already the
  system of record (§3.1 names Odoo as the source).
- **Good:** aligns with the import layer's existing design — `Employee` is already a projection
  of Odoo, not the master.
- **Bad:** requires an Odoo integration that does not exist yet (the v2 loader seam in
  `lib/pms/import/loaders/` is documented but unimplemented), so it converts a Phase 5 decision
  into a Phase 5 _dependency_ on another team's system and its availability at computation time.
- **Bad:** §11.6 wants the salary that applied at a point in time; live-fetching gives today's,
  which is wrong for a cycle that closed last month. Would need a snapshot — which is storing it
  again, just later and with more moving parts.

## Decision (2026-08-25)

**Option 2 — application-level AES-256-GCM on the column.** The operator chose this over the
recommendation below, having read it. The recommendation is left intact rather than rewritten to
agree, because a decision doc that quietly edits away the argument it was decided against is worth
nothing to the person who reads it in a year.

Two things about the choice, stated so nobody has to reconstruct them later:

- **The recommendation's central objection does not apply as strongly here as it does in general.**
  Option 2's real cost was named as "a lost key is unrecoverable salary data" on a rail with no key
  management. But `Employee` is a _projection of Odoo_ (§3.1), and salary arrives through the Excel
  import. A lost key therefore costs a re-import, not the data. That materially changes the risk
  profile of this option, and it is the strongest argument for the operator's choice.
- **This does not close the ADR-065 path.** A platform `Role.ADMIN` reaching HR Super Admin access
  reads salary _through the application_, which decrypts for them. Encryption addresses the
  database-read threat only. The audit trail remains the compensating control for the other one,
  and the audit-visibility fix (findings register, 2026-08-25) is what makes it real.

## Implementation spec

### Envelope

```
v1.<base64url iv>.<base64url ciphertext>.<base64url authTag>
```

Node's built-in `crypto` — `aes-256-gcm`, a fresh random 12-byte IV per write. No new dependency,
so no ADR-032 build-vs-buy gate on a crypto library and nothing new in the client bundle.

The `v1.` prefix is not decoration: it is what makes rotation a migration rather than a rewrite.

### The key is bound to the row

GCM's additional authenticated data is the employee's **`odooId`**, not the cuid `id`.

Two reasons, and the second is the one that matters. `odooId` is known _before_ the row exists, so
the import can encrypt in the same pass that builds the insert — a cuid is generated by Prisma at
insert time and would force an update-after-insert on a Restricted value. And binding to the
business key means a ciphertext lifted from one row and pasted onto another **fails to decrypt**:
someone with database write access cannot move a director's salary onto a row they are entitled to
read. Without AAD, that attack works against every scheme on this list.

### Where the seam is

The grep is the good news here — salary has five touchpoints, not fifty:

| Path                                             | Direction | Change                              |
| ------------------------------------------------ | --------- | ----------------------------------- |
| `lib/pms/import/run.ts` (create + update)        | write     | encrypt before the Prisma call      |
| `app/api/employees/[id]/route.ts` PATCH          | write     | encrypt before the Prisma call      |
| `prisma/seed-pms.ts`                             | write     | encrypt fixture values              |
| `lib/pms/employee-select.ts` `serializeEmployee` | read      | decrypt in the entitled branch only |
| `lib/pms/import/run.ts` (reads existing to diff) | read      | decrypt to compare old vs new       |

`lib/crypto/field-encryption.ts` is the only new module. §4.5's entitlement check does not move:
decryption happens _inside_ the branch that already decides whether the caller may see the column,
so an unentitled caller does not reach the ciphertext, let alone the plaintext.

### The column is renamed, deliberately

`basicSalary Decimal? @db.Decimal(14,3)` becomes `basicSalaryEnc String? @map("basic_salary_enc")`.

Keeping the name and changing the type would let any path that was missed compile and silently hand
a ciphertext string to something expecting a number. Renaming makes every un-migrated read a
**type error**, which is the difference between a migration you can trust and one you hope about.
The API contract does not change: `serializeEmployee` already emits a decimal _string_, and it
still will.

### STEP 3 IS BLOCKED — do not drop `basic_salary` (operator decision, 2026-08-25)

Steps 1 and 2 are **done in production**: the ciphertext column exists and all 36 salaries
are encrypted and verified. Step 3 — the migration that drops the plaintext column — is
**deliberately not scheduled**, and this section is the interlock.

**Why.** The production key exists in exactly one place: Vercel, as a _Sensitive_ environment
variable, which is write-only. `vercel env pull` returns the literal string `[SENSITIVE]`;
nobody — not the operator, not a future session, not Vercel support — can read that value
back. Asked when they wanted to take custody of it, the operator chose to **keep it with
Vercel until development finishes**.

That is a defensible call _only while `basic_salary` still holds the plaintext_, because the
plaintext is the recovery path. Lose the Vercel value today and the fix is: set a new key,
re-run `scripts/encrypt-salaries.mjs`, done. Drop the column first and the same event is
unrecoverable — 36 rows of ciphertext with no key and no source.

**So the ordering is a hard constraint, not a preference:**

1. Operator generates a key they control and stores it somewhere they can read it.
2. It replaces the Vercel value; `scripts/encrypt-salaries.mjs` re-runs from the plaintext.
3. `--verify` passes.
4. _Only then_ does step 3 become available.

Until step 1 happens, **any change that drops, truncates or stops populating
`employees.basic_salary` is a data-loss defect**, however tidy it looks. The column carries a
`/// LEGACY, pending drop` comment in `schema.prisma` that says the same thing at the point
someone would act on it.

### Migration is three steps, not one

A data migration on Restricted values is the least forgiving kind, so it does not happen in one
irreversible shot:

1. Additive migration: add `basic_salary_enc`. `basic_salary` stays, untouched.
2. A one-off script encrypts every non-null `basic_salary` into `basic_salary_enc`, then verifies
   by decrypting all of them and comparing to the source. It refuses to proceed on a single
   mismatch.
3. Only after that verification passes: a second migration drops `basic_salary`.

Between steps 1 and 3 the database holds both, which is the point — step 2 is reversible.

### Rotation

`SALARY_ENCRYPTION_KEY` is the current key; `SALARY_ENCRYPTION_KEY_PREVIOUS` is optional. Decrypt
tries current then previous; writes always use current. Rotating is: set previous to the old key,
set current to the new one, deploy, run the re-encryption pass, then clear previous. Both are
**Restricted** (SECURITY.md §1) — 32 random bytes, base64, never logged, never in a diff.

### What this costs, recorded honestly

- No SQL `ORDER BY`, range filter, or `SUM` on salary, ever, without decrypting in application
  code. Nothing does that today; §11.3's bonus and §11.4's pro-ration are per-employee, and
  §11.7's payroll export is a row list. A future "sort the directory by pay" or "total payroll by
  department" feature has to be built as a bounded application-side pass, and at a few hundred
  employees that is fine. At tens of thousands it would not be.
- Two more Restricted environment variables to hold, rotate and hand over at `/handoff`.
- `scripts/neon-sql.mjs` `REDACT_FIELDS` and the `no-restricted-export-column` ESLint rule become
  partly redundant. **They stay** — defence in depth costs nothing here, and they still cover the
  plaintext that exists in transit and in memory.

### Consequences

- SECURITY.md §7's "Column encryption of Restricted fields" row moves from a flagged gap to an
  implemented control, with the key-handling runbook named as its dependency.
- SECURITY.md §1 gains `SALARY_ENCRYPTION_KEY` and `SALARY_ENCRYPTION_KEY_PREVIOUS` as Restricted.
- The threat model gains a row for database-read disclosure, now mitigated, and keeps the row for
  application-path disclosure (ADR-065), which is not.
- Phase 5 reads salary through `field-encryption.ts` and nowhere else.

## Recommendation

**Option 1 now, with Option 4 as the Phase 5 design target, and Option 2 only if a policy
requires it.**

Reasoning, in order of weight:

1. The threat encryption addresses (direct database read) is narrower than it feels, and the
   threat that is _actually_ live — a platform admin reaching HR access through the app — is
   untouched by every cryptographic option here. Spending the effort on encryption while that
   path exists would be buying the wrong control. The audit-visibility fix recorded in
   `docs/findings-register.md` is worth more per unit of effort, and it is a much smaller change.
2. Option 2's real cost is not the code — it is owning a key on a rail explicitly designed not
   to own keys, all the way through `/handoff`. That is a commitment to make deliberately, not
   as a reflex to the word "salary".
3. Option 4 is genuinely better than both and becomes available when the Odoo loader lands. It
   should be recorded as the intended end state so Phase 5 is designed toward it rather than
   away from it.

**This recommendation is not self-executing.** Option 1 means writing down an accepted risk about
real people's pay, and that is the operator's signature to give, not mine.

## Consequences if Option 1 is chosen

- SECURITY.md §7's "Column encryption of Restricted fields" row changes from a flagged gap to a
  recorded, dated, owned acceptance, and the threat model gains a row for database-read
  disclosure with its compensating controls named.
- The operational controls become load-bearing and must be treated as such: who holds
  `DATABASE_URL`, how it rotates, and whether Neon's history/audit features are on.
- Phase 5 is designed so the salary read is funnelled through **one** service function, so that
  moving to Option 2 or Option 4 later is a change in one place rather than a hunt.

## Migration triggers

Revisit if any of these become true:

- Rihal adopts a policy requiring column-level encryption for compensation data.
- The Odoo loader lands, making Option 4 real.
- The system moves off the prototype rail to IT-managed infrastructure with existing key
  management (`/handoff`), where Option 2's main cost is already paid by someone else.
- Salary needs to be sorted, ranged or aggregated **in SQL** by a real feature — which would
  raise the cost of Option 2 and should be weighed at that moment, not assumed away now.
