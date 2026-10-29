import type { ImportStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * The platform's one import record (ADR-096). Each module keeps its own parser,
 * rules and preview → apply flow; every run is recorded here with its kind,
 * counts and row issues, so Admin › Imports can list them all.
 *
 * Kinds: `people` (lib/pms/import, which writes its batch itself — it predates
 * this helper and its apply step re-reads the batch), `jml.exits`,
 * `hiring.candidates`.
 */

export const IMPORT_KINDS = ["people", "jml.exits", "hiring.candidates"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

const MAX_ISSUES = 500;

export type RecordedIssue = {
  rowNumber: number;
  /** The row's own key: a case reference, a name. Never pay or ID numbers. */
  reference?: string | null;
  field?: string | null;
  rule: string;
  message: string;
  severity?: "REJECT" | "WARNING";
};

export async function recordImport(input: {
  kind: Exclude<ImportKind, "people">;
  filename: string;
  status: ImportStatus;
  uploadedById: string | null;
  uploadedByEmail?: string | null;
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated?: number;
  rowsRejected: number;
  issues?: readonly RecordedIssue[];
}): Promise<string> {
  const issues = (input.issues ?? []).slice(0, MAX_ISSUES);
  const batch = await prisma.importBatch.create({
    data: {
      kind: input.kind,
      filename: input.filename.slice(0, 255),
      status: input.status,
      uploadedById: input.uploadedById,
      uploadedByEmail: input.uploadedByEmail ?? null,
      rowsTotal: input.rowsTotal,
      rowsCreated: input.rowsCreated,
      rowsUpdated: input.rowsUpdated ?? 0,
      rowsRejected: input.rowsRejected,
      appliedAt: input.status === "APPLIED" ? new Date() : null,
      issues: {
        create: issues.map((i) => ({
          rowNumber: i.rowNumber,
          reference: i.reference?.slice(0, 255) ?? null,
          field: i.field ?? null,
          rule: i.rule,
          message: i.message.slice(0, 500),
          severity: i.severity ?? "REJECT",
        })),
      },
    },
    select: { id: true },
  });
  return batch.id;
}

/**
 * The import kinds this viewer may list — each module's own gate: people needs
 * the import-preview capability, historical exits JML configure, candidate
 * imports hiring manage (anywhere). The list shows counts, never row contents.
 */
export function visibleImportKinds(can: {
  peopleImport: boolean;
  jmlConfigure: boolean;
  hiringManage: boolean;
}): ImportKind[] {
  return IMPORT_KINDS.filter(
    (k) =>
      (k === "people" && can.peopleImport) ||
      (k === "jml.exits" && can.jmlConfigure) ||
      (k === "hiring.candidates" && can.hiringManage),
  );
}
