import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { KpiDraftBoard, type KpiRecord } from "@/components/pms/KpiDraftBoard";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import {
  GOAL_SETTING_STAGE,
  kpiSetAccessRefusal,
  weightageMessage,
  weightageTotal,
} from "@/lib/pms/kpi";
import { KPI_SELECT, kpiSetHash, serializeKpi } from "@/lib/pms/kpi-select";
import { staleParties } from "@/lib/pms/signoff";
import { isGoalSettingExempt, stageState, type StageWindow } from "@/lib/pms/cycle";
import { descendantEmployeeIds } from "@/lib/pms/org-tree";
import { canActOnEmployee, canViewEmployee } from "@/lib/pms/permissions";

/**
 * KPI drafting for one participant — spec §5.1, §5.2, §5.3, §5.4, §4.2, §8.3.
 *
 * A React Server Component that hands a serializable snapshot to the client
 * island below it (`KpiDraftBoard`), which owns every write through the API
 * routes. That split is deliberate, not incidental:
 *
 *   READS run here because there is no list endpoint for a participant's KPI
 *   set — the write routes return the set summary, not its rows — and because a
 *   server read is the template's own pattern for a page (`UI → API route →
 *   service → Prisma`; only server components and API routes touch `prisma`).
 *   The columns are enumerated, never `include: { employee: true }`: this screen
 *   is one a line manager lives in, and `basicSalary` is Restricted (§4.5).
 *
 *   WRITES go through `/api/kpis` and `/api/signoffs`, so the gates below are
 *   only ever affordances. Every one of them is re-checked server-side on the
 *   write, and a user who defeats a disabled button gets the same sentence back
 *   as a 409.
 *
 * The gates are not restated here. `kpiSetAccessRefusal` in `lib/pms/kpi.ts` is
 * the single implementation of §4.2 → §8.3 → §2 → §5.4/§5.1, and both this page
 * and `POST /api/kpis` call it. They used to ask the same questions in the same
 * order with the same sentences by CONVENTION, including two copied string
 * literals — which is exactly how a screen and the route behind it stop agreeing
 * about why an edit was refused.
 */

/**
 * `serializeKpi` is the ONE place `weightage` becomes a decimal string (§5.3
 * compares against exactly 100; a JSON number is a float). The row is then cut
 * to what the board renders — no timestamps travel to the client.
 */
function toKpiRecord(kpi: Parameters<typeof serializeKpi>[0]): KpiRecord {
  const row = serializeKpi(kpi);
  return {
    id: row.id,
    description: row.description,
    weightage: row.weightage,
    descriptorOutstanding: row.descriptorOutstanding,
    descriptorExcellent: row.descriptorExcellent,
    descriptorTarget: row.descriptorTarget,
    descriptorAlmostAchieved: row.descriptorAlmostAchieved,
    descriptorUnsatisfactory: row.descriptorUnsatisfactory,
    orderIndex: row.orderIndex,
  };
}

/** The stage window as the client renders it: ISO instants plus the server's verdict. */
function toStageProps(stage: StageWindow | null, now: Date) {
  if (!stage) return null;
  return {
    opensAt: stage.opensAt.toISOString(),
    deadline: stage.deadline.toISOString(),
    graceDays: stage.graceDays,
    state: stageState(stage, now),
  };
}

export default async function KpiDraftingPage({
  params,
}: {
  params: Promise<{ locale: string; cycleId: string; participantId: string }>;
}) {
  const { locale, cycleId, participantId } = await params;
  const t = await getTranslations("pms");

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);

  const actor = await resolveActor(session);
  const now = new Date();

  const participant = await prisma.cycleParticipant.findUnique({
    where: { id: participantId },
    select: {
      id: true,
      cycleId: true,
      goalsApprovedAt: true,
      employee: {
        // Enumerated, narrow, and salary-free by construction (§4.5).
        select: {
          id: true,
          name: true,
          email: true,
          roleTrack: true,
          managerId: true,
          department: { select: { name: true } },
          entity: { select: { code: true } },
        },
      },
      cycle: {
        select: {
          id: true,
          year: true,
          status: true,
          stages: {
            where: { kind: GOAL_SETTING_STAGE },
            select: { kind: true, opensAt: true, deadline: true, graceDays: true },
          },
        },
      },
      // `deletedAt: null` is written out: `Kpi` is not in the soft-delete
      // extension's model set, and a nested relation would not be filtered even
      // if it were (lib/prisma/soft-delete-extension.ts).
      kpis: {
        where: { deletedAt: null },
        orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
        select: KPI_SELECT,
      },
      signOffs: { select: { party: true, signedAt: true, kpiSetHash: true } },
    },
  });

  // A mistyped cycle in the URL must not resolve a different year's set.
  if (!participant || participant.cycleId !== cycleId) notFound();

  // §4.2 — visibility first, and 404 rather than 403 on failure: a manager
  // probing participant ids must not learn that a row exists outside their
  // chain from the status code. Same reasoning as POST /api/kpis.
  const descendants = actor.capabilities.orgWide
    ? new Set<string>()
    : actor.employeeId
      ? await descendantEmployeeIds(actor.employeeId)
      : new Set<string>();
  if (!canViewEmployee(actor, participant.employee.id, descendants)) notFound();

  const exempt = isGoalSettingExempt(participant.employee.roleTrack);
  const stage: StageWindow | null = participant.cycle.stages[0] ?? null;

  const target = { id: participant.employee.id, managerId: participant.employee.managerId };
  const refusal = kpiSetAccessRefusal({
    actor,
    // Visibility was already resolved above, against this page's own descendant
    // set — the route resolves it differently and both are correct, which is why
    // the shared function takes the answer rather than recomputing it.
    visible: true,
    employee: {
      id: participant.employee.id,
      managerId: participant.employee.managerId,
      roleTrack: participant.employee.roleTrack,
    },
    cycleStatus: participant.cycle.status,
    stage,
    goalsApprovedAt: participant.goalsApprovedAt,
    now,
  });
  // §8.3 is its own branch in the board — a categorical absence, not a blocked
  // edit — so an exempt participant renders the exemption, not a refusal.
  const editBlockedReason = exempt ? null : (refusal?.reason ?? null);

  const kpis: KpiRecord[] = participant.kpis.map(toKpiRecord);

  const employeeSigned = participant.signOffs.find((s) => s.party === "EMPLOYEE") ?? null;
  const managerSigned = participant.signOffs.find((s) => s.party === "MANAGER") ?? null;
  // Hashed from the set as it stands, then compared with what each party signed.
  // A null stored hash means "predates the column", which is unknown, not stale.
  const stale = staleParties(participant.signOffs, kpiSetHash(participant.kpis));

  // The set summary, computed from the same rows the board renders. The BOOLEAN
  // is what decides §5.3, here as at the API — the total is a string for display.
  const message = weightageMessage(participant.kpis);

  const subtitleParts = [
    participant.employee.email,
    participant.employee.department?.name,
    participant.employee.entity?.code,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("kpi.title", { name: participant.employee.name })}
        subtitle={subtitleParts.join(" · ")}
        actions={
          <Link href={`/${locale}/goal-setting`} className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft className="h-4 w-4" />
            {t("kpi.backAction")}
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{participant.cycle.year}</Badge>
        <Badge variant="outline">{t(`cycles.statusValue.${participant.cycle.status}`)}</Badge>
        <span className="text-sm text-muted-foreground">
          {editBlockedReason === null && !exempt
            ? t("kpi.subtitleEditable")
            : t("kpi.subtitleReadOnly")}
        </span>
      </div>

      <KpiDraftBoard
        participantId={participant.id}
        goalSettingExempt={exempt}
        stage={toStageProps(stage, now)}
        editBlockedReason={editBlockedReason}
        initialKpis={kpis}
        initialSet={{
          kpiCount: participant.kpis.length,
          weightageTotal: weightageTotal(participant.kpis).toString(),
          weightageComplete: message === null,
          weightageMessage: message,
        }}
        initialSignOff={{
          employeeSignedAt: employeeSigned?.signedAt.toISOString() ?? null,
          managerSignedAt: managerSigned?.signedAt.toISOString() ?? null,
          // US-12 lets the set move after a signature. These say whether it did.
          staleParties: stale,
        }}
        goalsApprovedAt={participant.goalsApprovedAt?.toISOString() ?? null}
        isSubject={actor.employeeId === participant.employee.id}
        canSignAsManager={canActOnEmployee(actor, target)}
      />
    </div>
  );
}
