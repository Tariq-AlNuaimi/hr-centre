# ADR-083 — JML leaver documents: `docxtemplater` core + `pizzip`, `.docx` only, nothing retained

**Status:** Accepted (built)
**Date:** 2026-10-27
**Decision owner:** Tariq Al-Naaimi
**Supersedes (in part):** ADR-001 (locked stack) — adds two runtime dependencies for the JML
module's documents. ADR-001 otherwise stands.
**Relates to:** ADR-086 (one JML case engine), HR Offboarding ADR-HRO-001 (the decision ported),
ADR-051 (licence elections), docs/blueprints/jml-s6-leavers.md.

## Context

HR Offboarding generated nine Word documents per exit (acceptance of resignation, termination
and non-renewal notifications, bank termination notice, repatriation ticket request, IT access
revocation instruction, final settlement worksheet, transmittal to Finance, certificate of
service) from templates HR uploads and an HR Manager approves (BR-OFF-034: author ≠ approver).
It stored no files (BR-OFF-027): the document is streamed and only the generation metadata kept.
The port must keep that — and the source shipped no template files at all (port spec F19): the
nine templates lived in its database, which this port must not read.

## Decision

1. **Engine:** `docxtemplater` 3.71.1 with the **default parser only** (no `angular-parser`, no
   paid modules) — a template is data, never code; `pizzip` 3.3.0 opens the `.docx`. Options as
   in the source: `paragraphLoop`, `linebreaks`, `nullGetter: () => ""`.
2. **Placeholders are an allowlist** (case reference, names, org units, exit facts and dates,
   line manager, HR owner, issue date, document title). An unknown placeholder refuses the
   upload — a letter must not silently lose a paragraph. No Restricted field is mergeable, so
   the settlement worksheet and transmittal carry no money (F20 stays as designed); the figures
   are read on the Settlement tab by those allowed.
3. **Nothing is retained:** the file is streamed (`Cache-Control: no-store`); a
   `JmlGeneratedDocument` row records who generated which template version.
4. **Templates:** upload (≤ 2 MB, valid `.docx`, allowlisted placeholders) creates a DRAFT
   version; an HR Manager (`jml.activateDocuments`) activates it — retiring the previous active
   version of that type — and cannot activate their own upload. Nine **default** templates are
   authored programmatically (`scripts/jml-author-docs.mjs`, committed under `prisma/jml-docs/`)
   and seeded once as the active version; they are plain and say so, so HR replaces them with
   their real letters by uploading and activating.
5. **Summary dismissal:** every document is held until the five confirmation tasks the source
   named are complete or not applicable.
6. **Licence:** docxtemplater is MIT; pizzip is MIT OR GPL-3.0 — the MIT branch is elected in
   `scripts/license-allowlist.json` (same election as jszip).

## Consequences

- No server-side PDF; HR exports from Word. A PDF need is a `/scale-up` question.
- The defaults are placeholders for HR's real letters; HR must upload and activate their own.
