# ADR-080 — Hiring module: access model, compensation at rest, references to core

Status: accepted (operator-authorised port, 2026-10-26) · Blueprint: `docs/blueprints/hiring.md`

## Context

Interview Hub (Ant Design, its own users and roles) is being folded into HR Centre as the
`hiring` module. Its rules are kept; its identity model, encryption scheme and UI are not
portable as-is. Three decisions shape every later slice.

## Decision 1 — Business roles become role-builder permissions

Interview Hub decided authority from an access role (ADMIN / EDITOR / VIEWER), an 11-value
business role and a nullable user entity. HR Centre has one mechanism: permissions held in a
scope. The module adds 17 scope-honouring permissions (`hiring.view`, `.manage`, `.viewComp`,
`.viewPii`, `.viewDei`, the Group-only `.configure` and `.erase`, and one per approval role:
`.hrManager`, `.hrSpecialist`, `.hiringManager`, `.panelist`, `.departmentHead`, `.director`,
`.operationsManager`, `.operationsDirector`, `.coo`, `.ceo`) and ten starter roles. An approval
step is resolved as "users holding `hiring.<role>` in a scope covering the requisition's company"
(`usersHoldingPermission`). Interview Hub's access ADMIN maps to `hiring.configure`.

Consequences: Interview Hub defect D1 (Operations Director not assignable) cannot recur; an approver
no longer needs general edit rights to approve; a scoped grant can never act outside its company
(out of scope = 404).

Rejected: keeping a business-role column on a hiring profile table — a second authority system
beside the role builder, which is exactly what HR Centre F-c removed.

## Decision 2 — Compensation sealed at the service seam, not by a Prisma extension

Six fields (offer salary and allowances, candidate expectation, payslip stated amount, version
terms, negotiated salary) are AES-256-GCM ciphertext in `*Enc` text columns, using HR Centre's
ADR-067 envelope (`lib/crypto/field-encryption.ts`) with a dedicated keyring
(`HIRING_COMP_ENCRYPTION_KEY`, `_PREVIOUS` for rotation) and AAD `hiring:<model>:<id>:<field>`.
`lib/hiring/comp-crypto.ts` is the only crossing. The candidate civil ID uses the existing
ID-document keyring.

Why not port Interview Hub's `encv1` extension: it is keyed by field NAME across every model
(a later core column called `salary` would be sealed silently), it has no AAD (a ciphertext can be
copied between rows), and it must be composed outermost of HR Centre's own audit/soft-delete
pair in `lib/prisma.ts`. With no data to migrate (fresh database), the explicit seam is simpler and
strictly safer. The invariants survive: the columns cannot be filtered or sorted (they hold
ciphertext and have `Enc` names), the key missing ⇒ writes refuse (no plaintext fallback), and a
contract test proves round-trip, binding and fail-closed.

## Decision 3 — Core rows referenced by id, no relations onto core models

Hiring tables reference `User`, `OrgEntity`, `Department` and `Employee` through plain id columns,
validated on write, with display names resolved in one batched query per response. Prisma relations
would require back-relation fields on core models, which belong to the JML/foundation owners and
would turn every module into a merge conflict on `User`. The cost is no database FK on those
columns; the hiring services are the only writers and check existence.

## Other recorded choices

- Onboarding templates/tasks are not ported (JML owns joiner checklists); acceptance creates a
  PRE_JOINER employee + JOIN case instead.
- Dropped inert data: `talentPoolFlag`, `pipelineConfig`, `slaOverrides`, `AiUsage.agentId`,
  orphan enums `ChangeRequestStatus`, `FeedbackKind`.
- Postgres FTS/trigram indexes are not recreated; search is bounded `contains` over indexed
  columns (requisition and candidate lists are hundreds, not millions, of rows).
- Email remains off for hiring (Interview Hub ADR-059): agency links and rejection notices are
  sent by a person; the app keeps the queues.
