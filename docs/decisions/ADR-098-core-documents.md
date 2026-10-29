# ADR-098 — Core documents: one store for record files, one Documents tab over every module

**Status:** Accepted — operator-approved P2 platform roadmap (item 3)
**Date:** 2026-10-29
**Decision owner:** Tariq Al-Naaimi (operator)

## Context

A person's files were spread over JML generated letters, KPI evidence, hiring package
documents and the ID fields on the record, with nowhere to keep a contract or a
certificate on the record itself, and no stored link from a hire to the joiner case its
documents belong to (audit: `ux/shell-people.md` R16; `ux/tickets-hiring.md` P2-3).

## Decision

1. **Core store** `core_documents`: files HR keep on a person's record (contract,
   certificate, letter, identity, other), private blob at a record-derived path, type
   sniffed from the bytes, ≤ 10 MB, soft-deleted (recycling bin). Seeing them needs the
   person in view (§4.2) and `people.viewIdDocuments`; a Restricted file also needs pay
   access; adding or removing needs `people.edit` in the person's scope. Reads are a
   short-lived signed URL issued after the checks; anything short of seeing them is 404.
2. **One Documents tab** (Employee › Documents) unions the core store with JML generated
   letters (JML's case gate), KPI evidence (§7.1's evidence rule) and hiring package
   documents (Hiring's gate on the requisition; payslips/bank statements only with hiring
   pay access). Module files stay where their module keeps them and open through the
   module's own route — a read model, so nothing is copied and nothing drifts. The tab
   shows when any source is open to the viewer; the ID-documents section keeps its gate.
3. **Hiring → joiner:** `HiringHandover.jmlCaseId` stores the joiner case a hand-over
   opened (backfilled from the join detail's `hiring:<candidateId>` key). The candidate's
   documents follow the person on the Documents tab via `HiringCandidate.employeeId`.
4. **Document templates — not merged.** JML letters use docxtemplater over HR-uploaded
   Word templates (ADR-083); the offer letter is react-pdf (ADR-084), a fully designed
   layout with no Word template HR maintain. Replacing it with docxtemplater would lose
   that layout until HR author a Word equivalent, and would add an approval step for the
   template; kept as is. When HR want to edit offer wording, the offer letter becomes a
   JML-style template type and moves then.

## Considered options

- **Copy every module file into `core_documents`** — rejected: two copies of the bytes'
  pointer, two permission rules to keep in step, and backfills on every module change.
- **A DMS (SharePoint, Google Drive, M-Files)** — rejected for now: Restricted pay and ID
  documents and per-module access rules would have to be mirrored outside the database.
