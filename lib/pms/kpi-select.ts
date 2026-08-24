import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { weightageMessage, weightageTotal } from "./kpi";

/**
 * The KPI read shape and its §5.3 summary — the counterpart to
 * `employee-select.ts`.
 *
 * A Next.js route module may only export HTTP verbs, so two route files cannot
 * share a helper between themselves; without a home in `lib/` these get copied,
 * and a copied `select` is how a column quietly appears in one payload and not
 * the other. One definition, three callers.
 */

export const KPI_SELECT = {
  id: true,
  participantId: true,
  description: true,
  weightage: true,
  descriptorOutstanding: true,
  descriptorExcellent: true,
  descriptorTarget: true,
  descriptorAlmostAchieved: true,
  descriptorUnsatisfactory: true,
  orderIndex: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.KpiSelect;

export type KpiRow = Prisma.KpiGetPayload<{ select: typeof KPI_SELECT }>;

/**
 * `weightage` crosses the wire as a decimal STRING.
 *
 * Same reasoning as `basicSalary` in `employee-select.ts`: JSON has one numeric
 * type and it is a double. §5.3 compares against exactly 100, so a client that
 * receives `33.33` as a float and adds three of them gets 99.99000000000001 and
 * disagrees with the server about whether the set is signable. The string keeps
 * the decision on the server, where `weightageComplete` already answers it.
 */
export function serializeKpi(kpi: KpiRow) {
  return { ...kpi, weightage: kpi.weightage.toString() };
}

/** §5.2's editable columns — the six texts, the weightage, and the order. */
export const EDITABLE_KPI_FIELDS = [
  "description",
  "weightage",
  "descriptorOutstanding",
  "descriptorExcellent",
  "descriptorTarget",
  "descriptorAlmostAchieved",
  "descriptorUnsatisfactory",
  "orderIndex",
] as const;

export type WeightageSummary = {
  kpiCount: number;
  weightageTotal: string;
  weightageComplete: boolean;
  weightageMessage: string | null;
};

/**
 * The live §5.3 position of one participant's KPI set.
 *
 * Returned alongside every KPI write so the drafting screen never has to make a
 * second request to learn whether the set became signable — and so the number it
 * shows is the server's, not a client-side re-sum that could drift.
 *
 * `deletedAt: null` is explicit because `Kpi` is not registered in
 * `SOFT_DELETE_MODELS` (`lib/prisma/soft-delete-extension.ts`), so nothing
 * filters withdrawn rows automatically even though the columns exist. Registering
 * it touches `lib/prisma/**`, an Ask-before surface — recorded in
 * `docs/findings-register.md` rather than done quietly.
 */
export async function weightageSummary(participantId: string): Promise<WeightageSummary> {
  const participant = await prisma.cycleParticipant.findUnique({
    where: { id: participantId },
    select: { kpis: { where: { deletedAt: null }, select: { weightage: true } } },
  });
  const kpis = participant?.kpis ?? [];
  const message = weightageMessage(kpis);
  return {
    kpiCount: kpis.length,
    weightageTotal: weightageTotal(kpis).toString(),
    weightageComplete: message === null,
    weightageMessage: message,
  };
}
