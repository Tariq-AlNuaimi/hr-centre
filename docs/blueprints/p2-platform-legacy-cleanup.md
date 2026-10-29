# P2 platform — drop the legacy module stores

Scope: prisma/schema.prisma, prisma/migrations/20261029153000_drop_legacy_module_stores/**, lib/prisma/soft-delete-extension.ts, lib/prisma/recyclable.ts, lib/jml/email/templates.ts, tests/contracts/scrub-completeness.test.ts

Status: operator-approved P2 roadmap ("old tables dropped only after the new path is live and verified").
Feature parity: n/a — clean-up.

## Stories and acceptance criteria

- **US-1 (operator) no second copy left to drift.** AC-1.1 The tables whose data moved to
  core stores are dropped: `hive_escalation_reply_tokens` (→ `core_magic_links`, PR #57),
  `hiring_settings`, `hive_ticket_settings` (→ `core_module_settings`, #61),
  `hiring_offer_approvals` (→ `core_approval_*`, #63), `jml_email_template_overrides`,
  `hive_email_templates` (→ `core_email_templates`, #65), `hiring_import_batches`
  (→ `import_batches`, #67), `hiring_grades`, `hiring_competencies` (→ `core_grades`,
  `core_competencies`, #69). AC-1.2 Each new path was deployed READY with its migration run
  and `/api/health` ok before this. AC-1.3 Nothing in code reads the dropped tables.
- **US-2 (operator) nothing written during a roll-out is lost.** AC-2.1 Before dropping, the
  migration re-runs the idempotent copies (`ON CONFLICT DO NOTHING`, core values win) for
  reply tokens, Hiring settings (not the AI keys, which are platform settings now),
  JML template overrides, grades and competencies.

## Worst paths

- A row exists only in a legacy table (written by an old instance mid-deploy) → swept into
  the core store by the same migration before the drop.
