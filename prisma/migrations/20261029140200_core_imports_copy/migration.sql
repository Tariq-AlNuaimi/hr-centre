-- ADR-096: copy every Hiring candidate import into the core import record
-- (its own migration because the FAILED status value added in the previous one
-- cannot be used in the same transaction). Row errors in the old JSON log
-- become row issues. `hiring_import_batches` stays until the new path is
-- verified live.
INSERT INTO "import_batches" ("id", "kind", "filename", "status", "uploadedById", "rows_total", "rows_created", "rows_rejected", "applied_at", "createdAt", "updatedAt")
SELECT 'hib_' || h."id",
  'hiring.' || h."kind",
  '(upload)',
  (CASE h."status"::text WHEN 'COMPLETED' THEN 'APPLIED' WHEN 'FAILED' THEN 'FAILED' ELSE 'PREVIEWED' END)::"ImportStatus",
  (SELECT u."id" FROM "users" u WHERE u."id" = h."createdById"),
  h."total", h."processed", h."failed",
  CASE WHEN h."status"::text = 'COMPLETED' THEN h."updatedAt" END,
  h."createdAt", h."updatedAt"
FROM "hiring_import_batches" h
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "import_row_issues" ("id", "batchId", "row_number", "reference", "rule", "message", "severity", "createdAt")
SELECT 'hib_' || h."id" || '_' || e.ord,
  'hib_' || h."id",
  COALESCE((e.err->>'row')::int, 0),
  e.err->>'name',
  'row_invalid',
  COALESCE(e.err->>'error', 'Row rejected'),
  'REJECT',
  h."createdAt"
FROM "hiring_import_batches" h,
  jsonb_array_elements(CASE WHEN jsonb_typeof(h."log"::jsonb -> 'errors') = 'array' THEN h."log"::jsonb -> 'errors' ELSE '[]'::jsonb END) WITH ORDINALITY AS e(err, ord)
ON CONFLICT ("id") DO NOTHING;
