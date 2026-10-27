# Blueprint — JML slice S6b: leaver documents

Scope: lib/jml/docs/**, lib/validations/jml/**, app/api/jml/config/documents/**, app/api/jml/leavers/[id]/documents/**, components/jml/**, app/[locale]/(dashboard)/jml/settings/documents/**, prisma/schema.prisma, prisma/migrations/20261027160000_jml_s6_documents/**, prisma/seed-jml.ts, prisma/seed-jml-documents.ts, prisma/jml-docs/**, scripts/jml-author-docs.mjs, scripts/license-allowlist.json, tests/contracts/jml-documents.test.ts, docs/decisions/ADR-083-jml-word-documents.md, docs/build-vs-buy-ledger.md, package.json, package-lock.json

Status: part of `docs/blueprints/jml.md` (slice 6, second PR). Decision: ADR-083. Port spec: HR
Offboarding §2.13 (findings F19, F20).

## What this slice delivers

- Nine document types (§16). Templates are versioned per type: an upload (≤ 2 MB, a real
  `.docx`, allowlisted placeholders only — checked on the text so a placeholder Word split across
  runs is still seen) is a DRAFT; an HR Manager (`jml.activateDocuments`) other than the uploader
  activates it and the previous active version retires (one ACTIVE per type, a partial unique
  index). Templates can be downloaded to edit in Word.
- Generation streams a `.docx` (`no-store`, `X-Generation-Id`, `X-Template-Version`); a
  `JmlGeneratedDocument` row is the only trace. Regeneration is pinned to the first version used;
  "use current" needs a reason (AC-17.2). A summary dismissal's documents are held until S1-05,
  S3-04…S3-07 are done (AC per the source). Drafts generate nothing.
- Nine plain default templates are authored by `scripts/jml-author-docs.mjs`, committed under
  `prisma/jml-docs/`, and seeded once per type (never over an HR upload). They say they are
  defaults; HR replaces them.

Scenarios — happy: generate an acceptance letter → the case's dates and names are merged → the
history shows who and which version. Worst: a template with `{netTotalAmount}` → refused naming
it; the uploader activates their own template → 403; a summary dismissal before its
confirmations → 403 naming the open tasks.
