import type { HiringStage, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { recordImport } from "@/lib/core/imports/record";
import { cellText, ImportFileError, readWorkbook } from "@/lib/pms/import/loaders/xlsx";
import type { HiringActor } from "./access";
import { applyStageChange, stageHistoryFor } from "./candidate-stage";
import { candidateReadWhere, LIST_SELECT, projectRows } from "./candidates";
import { HiringRuleError } from "./http";
import type { LoadedRequisition } from "./requisitions";
import { skippedGates } from "./stage-gates";
import { classifyStageMove, stageTransitionError, stagesForStep } from "./stage-rules";

/**
 * Bulk work on candidates (Interview Hub `bulk-actions.ts`, `import/candidates`,
 * `candidates/export`). A bulk move NEVER makes a governed move for a whole
 * selection — a reject past the first interview, a regression, a phase cross
 * or anything skipping a mandatory step is skipped and counted, and has to be
 * made one candidate at a time. Each run leaves a `HiringBulkJob` row.
 *
 * Interview Hub's bulk "send email" is not ported: that deployment sent no email
 * at all (ADR-059), so the action always reported every row as skipped.
 */

type BulkSummary = {
  requested: number;
  processed: number;
  skipped: number;
  failed: number;
};

async function inScope(actor: HiringActor, ids: string[]) {
  const scope = await candidateReadWhere(actor, "hiring.manage");
  if (scope === null) return [];
  return prisma.hiringCandidate.findMany({
    where: { AND: [scope, { id: { in: [...new Set(ids)] } }] },
    select: { id: true, stage: true, requisitionId: true, preferredAt: true },
    take: ids.length,
  });
}

export async function bulkStageMove(actor: HiringActor, ids: string[], toStage: HiringStage) {
  const rows = await inScope(actor, ids);
  if (rows.length === 0) throw new HiringRuleError("No candidates were found.", 404);
  const job = await prisma.hiringBulkJob.create({
    data: {
      actionKind: "stage_move",
      status: "IN_PROGRESS",
      input: { candidateIds: rows.map((r) => r.id), stage: toStage },
      createdById: actor.userId,
    },
    select: { id: true },
  });
  const history = await stageHistoryFor(rows.map((r) => r.id));
  const summary: BulkSummary = {
    requested: new Set(ids).size,
    processed: 0,
    skipped: new Set(ids).size - rows.length,
    failed: 0,
  };
  for (const c of rows) {
    const visited = [
      c.stage,
      ...(history.get(c.id) ?? []).flatMap((h) => [h.fromStage, h.toStage]),
    ];
    const refused =
      stageTransitionError(c.stage, toStage) !== null ||
      classifyStageMove(c.stage, toStage) !== null ||
      skippedGates(c.stage, toStage, visited).length > 0;
    if (refused) {
      summary.skipped += 1;
      continue;
    }
    try {
      await applyStageChange({
        cand: c,
        toStage,
        movedById: actor.userId,
        reason: "Bulk stage move",
      });
      summary.processed += 1;
    } catch {
      summary.failed += 1;
    }
  }
  await prisma.hiringBulkJob.update({
    where: { id: job.id },
    data: { status: "COMPLETED", output: summary, completedAt: new Date() },
    select: { id: true },
  });
  return summary;
}

export type ExportRow = Awaited<ReturnType<typeof projectRows>>[number];

/** Export rows: never comp, DEI, NEC, notes; contact + score only where the reader sees PII. */
export async function exportRows(
  actor: HiringActor,
  filter: {
    ids?: string[];
    search?: string;
    stage?: HiringStage;
    phase?: number;
    requisitionId?: string;
  },
) {
  const scope = await candidateReadWhere(actor, "hiring.manage");
  if (scope === null) return [];
  const and: Prisma.HiringCandidateWhereInput[] = [scope];
  if (filter.ids) and.push({ id: { in: filter.ids } });
  if (filter.stage) and.push({ stage: filter.stage });
  if (filter.phase) and.push({ stage: { in: stagesForStep(filter.phase) } });
  if (filter.requisitionId) and.push({ requisitionId: filter.requisitionId });
  if (filter.search) {
    and.push({
      OR: [
        { name: { contains: filter.search, mode: "insensitive" } },
        { email: { contains: filter.search, mode: "insensitive" } },
      ],
    });
  }
  const rows = await prisma.hiringCandidate.findMany({
    where: { AND: and },
    orderBy: { createdAt: "desc" },
    take: 10_000,
    select: LIST_SELECT,
  });
  return projectRows(actor, rows);
}

// ---------------------------------------------------------------- import

const IMPORT_ROW_CAP = 500;
type ImportField = "name" | "email" | "phone" | "currentEmployer";
const HEADER_MAP: Record<string, ImportField> = {
  name: "name",
  email: "email",
  phone: "phone",
  currentemployer: "currentEmployer",
  employer: "currentEmployer",
  company: "currentEmployer",
};

/** Header row → column index per field (first match wins). */
function mapHeaders(header: unknown[]): Map<ImportField, number> {
  const map = new Map<ImportField, number>();
  header.forEach((raw, i) => {
    const field =
      HEADER_MAP[
        String(raw ?? "")
          .toLowerCase()
          .replace(/[^a-z]/g, "")
      ];
    if (field && !map.has(field)) map.set(field, i);
  });
  return map;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A spreadsheet of candidates for one requisition (≤ 500 rows). A row without a
 * name is skipped; a malformed email or a name over 255 characters is reported
 * against its spreadsheet row and the rest still import.
 */
export async function importCandidates(
  actor: HiringActor,
  l: LoadedRequisition,
  buffer: Buffer,
  fileName = "candidates.xlsx",
) {
  let sheet: unknown[][];
  try {
    sheet = (await readWorkbook(buffer))[0]?.data ?? [];
  } catch (e) {
    if (e instanceof ImportFileError) throw new HiringRuleError(e.message, 400);
    throw e;
  }
  const columns = mapHeaders(sheet[0] ?? []);
  if (!columns.has("name"))
    throw new HiringRuleError('No "Name" column found in the first row.', 400);
  const body = sheet.slice(1);
  if (body.length > IMPORT_ROW_CAP) {
    throw new HiringRuleError(
      `This file has ${body.length} rows; imports are capped at ${IMPORT_ROW_CAP} per upload. Split the file and import it in batches.`,
      413,
    );
  }
  const read = (row: unknown[], f: ImportField) => {
    const i = columns.get(f);
    return i === undefined ? null : cellText(row[i]);
  };
  const errors: { row: number; name: string; error: string }[] = [];
  let created = 0;
  for (const [i, row] of body.entries()) {
    const name = read(row, "name");
    if (!name) continue;
    const email = read(row, "email")?.toLowerCase() ?? null;
    if (name.length > 255 || (email && !EMAIL.test(email))) {
      errors.push({
        row: i + 2,
        name,
        error: name.length > 255 ? "Name is too long" : "Email is not valid",
      });
      continue;
    }
    await prisma.hiringCandidate.create({
      data: {
        requisitionId: l.req.id,
        name,
        email,
        phone: read(row, "phone"),
        currentEmployer: read(row, "currentEmployer"),
        source: "MANUAL_ENTRY",
      },
      select: { id: true },
    });
    created += 1;
  }
  // The core import record (ADR-096), listed under Admin › Imports.
  const batchId = await recordImport({
    kind: "hiring.candidates",
    filename: fileName,
    status: "APPLIED",
    uploadedById: actor.userId,
    rowsTotal: body.length,
    rowsCreated: created,
    rowsRejected: errors.length,
    issues: errors.slice(0, 50).map((e) => ({
      rowNumber: e.row,
      reference: e.name,
      rule: "row_invalid",
      message: e.error,
    })),
  });
  return { created, failed: errors.length, batchId, errors: errors.slice(0, 20) };
}
