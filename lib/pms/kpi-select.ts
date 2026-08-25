import { createHash } from "node:crypto";
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

/**
 * The columns that make a KPI set what the employee agreed to — §5.2's six
 * authored texts, the weightage, and the order they are read in.
 *
 * Deliberately not `KPI_SELECT`: `createdAt`/`updatedAt` move for reasons that
 * are not content (a soft-delete restore, a backfill), and a hash that changes
 * when nothing a human would call the agreement changed is a hash nobody
 * trusts.
 */
export const KPI_HASH_SELECT = {
  id: true,
  description: true,
  weightage: true,
  descriptorOutstanding: true,
  descriptorExcellent: true,
  descriptorTarget: true,
  descriptorAlmostAchieved: true,
  descriptorUnsatisfactory: true,
  orderIndex: true,
} satisfies Prisma.KpiSelect;

export type KpiHashRow = Prisma.KpiGetPayload<{ select: typeof KPI_HASH_SELECT }>;

/**
 * A digest of the KPI set as it stands — what a signature is recorded against.
 *
 * US-12 is explicit that "neither signature prevents further edits", so a set
 * CAN move after the employee signs it. Before this, nothing distinguished
 * "signed this exact set" from "signed an earlier version of it", and HR could
 * apply §5.1's lock to content the employee never saw. This adds no lock and no
 * reject path — §5.3 is untouched — it only makes the divergence visible.
 *
 * Sorted by `(orderIndex, id)` before hashing, so the digest depends on the set
 * and its reading order, not on whatever order Postgres returned the rows in.
 * `weightage` goes in as its decimal STRING for the same reason it crosses the
 * wire as one: `1.50` and `1.5` are the same number and must hash the same, and
 * `Decimal.toString()` is what normalises them.
 */
export function kpiSetHash(kpis: readonly KpiHashRow[]): string {
  const canonical = [...kpis]
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id))
    .map((k) => [
      k.id,
      k.description,
      k.weightage.toString(),
      k.descriptorOutstanding,
      k.descriptorExcellent,
      k.descriptorTarget,
      k.descriptorAlmostAchieved,
      k.descriptorUnsatisfactory,
      k.orderIndex,
    ]);
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex")}`;
}

/** The live hash for one participant's set. Empty sets hash too — an empty
 *  agreement is still a thing a signature can be measured against. */
export async function currentKpiSetHash(participantId: string): Promise<string> {
  const kpis = await prisma.kpi.findMany({
    where: { participantId, deletedAt: null },
    select: KPI_HASH_SELECT,
    // §5.2 sets are a handful per employee; the cap is a guard, not a page.
    take: 200,
  });
  return kpiSetHash(kpis);
}
