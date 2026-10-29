# P2 platform — core documents and the Employee › Documents tab (ADR-098)

Scope: lib/core/documents/**, lib/validations/core/documents.ts, app/api/employees/[id]/documents/route.ts, app/api/employees/[id]/documents/[docId]/route.ts, app/[locale]/(dashboard)/people/[id]/page.tsx, components/people/EmployeeDocuments.tsx, lib/jml/employee-tab.ts, lib/hiring/employee-tab.ts, lib/hiring/candidate-files.ts, lib/hiring/preboarding.ts, lib/prisma/soft-delete-extension.ts, lib/prisma/recyclable.ts, prisma/schema.prisma, prisma/migrations/20261029145530_core_documents/**, tests/contracts/core-documents.test.ts, tests/contracts/ux-people-record.test.ts

Status: operator-approved P2 roadmap, item 3. Audit: `ux/shell-people.md` R16, `ux/tickets-hiring.md` P2-3.
Feature parity: n/a — a person's documents on their record (HiBob/BambooHR "Documents" tab) is the common pattern.

## Stories and acceptance criteria

- **US-1 (HR) keep a file on the record.** AC-1.1 With `people.edit` and ID-document access I
  add a PDF/image (≤ 10 MB, sniffed) with a title, kind and optional Restricted flag; I can
  remove it (soft delete). AC-1.2 A Restricted file is listed and opened only with pay access.
- **US-2 (HR, manager) one list of a person's files.** AC-2.1 The Documents tab lists record
  files, JML letters, KPI evidence and hiring package documents, newest first, each from its
  module only under that module's rule, each opened through the module's own route.
  AC-2.2 The tab shows when any source is open to me.
- **US-3 (HR) the hire's trail.** AC-3.1 A hand-over stores the joiner case it opened;
  existing hand-overs are backfilled.

## Worst paths

- Storage not configured → upload refused with a clear message (503); listing still works.
- A file whose bytes are not PDF/PNG/JPEG/WebP → refused before anything is stored.
- A viewer who can't see the person, or a document id from another person → 404.

## Data

Migration `20261029145530_core_documents`: `core_documents` and `hiring_handovers.jml_case_id` (backfilled). Evidence:
scratch replay — the hand-over whose candidate has a joiner case got its case id; the other
stayed null.
