import { Prisma } from "@/generated/prisma/client";
import { EDITABLE_FIELDS, type EditableField, type KpiEdit } from "./change-request";

/**
 * The change-request read shape and its wire form — the counterpart to
 * `kpi-select.ts`.
 *
 * A Next route module may export only HTTP verbs, so the submit, list, decide
 * and withdraw routes cannot share anything between themselves. Without a home
 * in `lib/` this `select` gets copied four times, and a copied select is how a
 * column appears in one payload and not another.
 */

export const CHANGE_REQUEST_SELECT = {
  id: true,
  participantId: true,
  requestedByEmployeeId: true,
  requestedAt: true,
  rationale: true,
  status: true,
  decidedByEmployeeId: true,
  decidedAt: true,
  decisionReason: true,
  // Enumerated columns only. `include: { requestedByEmployee: true }` would pull
  // `basicSalaryEnc` (Restricted, §4.5 / ADR-067) into a workflow response that
  // has no business carrying it.
  requestedByEmployee: { select: { id: true, name: true } },
  decidedByEmployee: { select: { id: true, name: true } },
  edits: {
    select: {
      id: true,
      kpiId: true,
      description: true,
      weightage: true,
      descriptorOutstanding: true,
      descriptorExcellent: true,
      descriptorTarget: true,
      descriptorAlmostAchieved: true,
      descriptorUnsatisfactory: true,
    },
    // §5.3 sets are a handful of KPIs and the boundary caps a request at 50.
    // The take is a guard against a malformed row count, not a page.
    take: 50,
  },
} satisfies Prisma.KpiChangeRequestSelect;

export type ChangeRequestRow = Prisma.KpiChangeRequestGetPayload<{
  select: typeof CHANGE_REQUEST_SELECT;
}>;

export type EditRow = ChangeRequestRow["edits"][number];

/**
 * `weightage` crosses the wire as a decimal STRING, and stays `null` when the
 * edit does not touch it.
 *
 * Same reasoning as `serializeKpi`: JSON's only numeric type is a double, §5.3
 * compares a sum against exactly 100, and a client that re-sums floats will
 * disagree with the server about whether a request is approvable. Null here
 * means UNCHANGED, never zero — the difference matters enough that the column is
 * nullable specifically to carry it.
 */
export function serializeChangeRequest(row: ChangeRequestRow) {
  return {
    ...row,
    edits: row.edits.map((edit) => ({
      ...edit,
      weightage: edit.weightage === null ? null : edit.weightage.toString(),
    })),
  };
}

/**
 * A stored edit row as the domain seam wants it — `null` columns dropped so
 * "unchanged" is expressed by absence, which is what `applyEdit` reads.
 */
export function toKpiEdit(edit: EditRow): KpiEdit {
  const out: KpiEdit = { kpiId: edit.kpiId };
  for (const field of EDITABLE_FIELDS) {
    const value = edit[field as EditableField];
    if (value !== null && value !== undefined) {
      (out as Record<string, unknown>)[field] = value;
    }
  }
  return out;
}
