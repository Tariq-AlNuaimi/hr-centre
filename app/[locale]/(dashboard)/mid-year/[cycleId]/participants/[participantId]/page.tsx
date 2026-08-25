import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { MidYearBoard } from "@/components/pms/MidYearBoard";
import type { ReviewRequest } from "@/components/pms/ChangeRequestReview";
import type { KpiVersionRow } from "@/components/pms/KpiVersionHistory";
import type { ComposerKpi } from "@/components/pms/change-request-draft";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import {
  MID_YEAR_STAGE,
  changeRequestAccessRefusal,
  withdrawBlockedReason,
} from "@/lib/pms/change-request";
import { isGoalSettingExempt, stageState, type StageWindow } from "@/lib/pms/cycle";
import { descendantEmployeeIds } from "@/lib/pms/org-tree";
import { canViewEmployee, isHr } from "@/lib/pms/permissions";

/**
 * The mid-year screen for one participant — spec §6.
 *
 * A server component that reads through Prisma directly, the same pattern the
 * goal-setting drafting page uses: the alternative is three round trips to build
 * one screen, and the client would then be assembling a view of an HR-approved
 * baseline out of separately-fetched parts.
 *
 * §4.2 is answered HERE, before anything is read into the payload, and the
 * answer is `notFound()` rather than a forbidden page — a manager probing
 * participant ids must not learn from the response which ones exist outside
 * their chain.
 */

const KPI_FIELDS = {
  id: true,
  description: true,
  weightage: true,
  descriptorOutstanding: true,
  descriptorExcellent: true,
  descriptorTarget: true,
  descriptorAlmostAchieved: true,
  descriptorUnsatisfactory: true,
} as const;

const REQUEST_FIELDS = {
  id: true,
  status: true,
  rationale: true,
  requestedAt: true,
  decidedAt: true,
  decisionReason: true,
  requestedByEmployeeId: true,
  requestedByEmployee: { select: { name: true } },
  decidedByEmployee: { select: { name: true } },
  edits: {
    select: {
      kpiId: true,
      description: true,
      weightage: true,
      descriptorOutstanding: true,
      descriptorExcellent: true,
      descriptorTarget: true,
      descriptorAlmostAchieved: true,
      descriptorUnsatisfactory: true,
    },
    take: 50,
  },
} as const;

type RequestRow = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  rationale: string;
  requestedAt: Date;
  decidedAt: Date | null;
  decisionReason: string | null;
  requestedByEmployeeId: string;
  requestedByEmployee: { name: string } | null;
  decidedByEmployee: { name: string } | null;
  edits: {
    kpiId: string;
    description: string | null;
    weightage: { toString(): string } | null;
    descriptorOutstanding: string | null;
    descriptorExcellent: string | null;
    descriptorTarget: string | null;
    descriptorAlmostAchieved: string | null;
    descriptorUnsatisfactory: string | null;
  }[];
};

/** Decimals cross into the client as STRINGS — §5.3 compares against exactly 100. */
function toReview(row: RequestRow): ReviewRequest {
  return {
    id: row.id,
    status: row.status,
    rationale: row.rationale,
    requestedAt: row.requestedAt.toISOString(),
    requestedByName: row.requestedByEmployee?.name ?? null,
    decidedByName: row.decidedByEmployee?.name ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionReason: row.decisionReason,
    edits: row.edits.map((edit) => ({
      ...edit,
      weightage: edit.weightage === null ? null : edit.weightage.toString(),
    })),
  };
}

export default async function MidYearParticipantPage({
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
        // Enumerated and salary-free by construction (§4.5 / ADR-067).
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
          year: true,
          status: true,
          stages: {
            where: { kind: MID_YEAR_STAGE },
            select: { kind: true, opensAt: true, deadline: true, graceDays: true },
          },
        },
      },
      // `deletedAt: null` written out — `Kpi` soft-deletes are not filtered on a
      // NESTED select (lib/prisma/soft-delete-extension.ts rewrites the
      // top-level where only).
      kpis: {
        where: { deletedAt: null },
        orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
        select: KPI_FIELDS,
      },
      changeRequests: {
        orderBy: { requestedAt: "desc" },
        select: REQUEST_FIELDS,
        // §6.3 wants the whole history; the cap is a guard on the payload, not a
        // page. A participant with 50 mid-year requests has a different problem.
        take: 50,
      },
    },
  });

  // A mistyped cycle in the URL must not resolve a different year's set.
  if (!participant || participant.cycleId !== cycleId) notFound();

  // §4.2 — visibility first, and 404 on failure.
  const descendants = actor.capabilities.orgWide
    ? new Set<string>()
    : actor.employeeId
      ? await descendantEmployeeIds(actor.employeeId)
      : new Set<string>();
  if (!canViewEmployee(actor, participant.employee.id, descendants)) notFound();

  const stage: StageWindow | null = participant.cycle.stages[0] ?? null;
  const exempt = isGoalSettingExempt(participant.employee.roleTrack);

  const refusal = changeRequestAccessRefusal({
    actor,
    // Resolved above against this page's own descendant set; the shared function
    // takes the answer rather than recomputing it a second, different way.
    visible: true,
    employee: participant.employee,
    cycleStatus: participant.cycle.status,
    stage,
    goalsApprovedAt: participant.goalsApprovedAt,
    now,
  });

  /**
   * The refusal, translated for a READER rather than for an HTTP client.
   *
   * `submitBlockedReason`'s 404 is the API's existence oracle (§4.2): a stranger
   * probing participant ids must not learn which exist. On a page the actor is
   * already looking at, that same sentence — "Participant not found" — is simply
   * false, and it is what an employee saw on their OWN mid-year screen, because
   * §6.2 gives the request to their MANAGER and `canActOnEmployee` refuses a
   * person acting on themselves. The status is the discriminator; every other
   * refusal already reads as a sentence and passes through unchanged.
   */
  const submitReason =
    refusal === null ? null : refusal.status === 404 ? t("changeRequest.notYours") : refusal.reason;

  const rows = participant.changeRequests as unknown as RequestRow[];
  const pending = rows.find((r) => r.status === "PENDING") ?? null;
  const decided = rows.filter((r) => r.status !== "PENDING");

  const versions = await prisma.kpiVersion.findMany({
    where: { kpiId: { in: participant.kpis.map((k) => k.id) } },
    orderBy: [{ supersededAt: "desc" }, { versionNo: "desc" }],
    select: {
      id: true,
      kpiId: true,
      versionNo: true,
      description: true,
      weightage: true,
      descriptorOutstanding: true,
      descriptorExcellent: true,
      descriptorTarget: true,
      descriptorAlmostAchieved: true,
      descriptorUnsatisfactory: true,
      supersededAt: true,
      supersededByRequestId: true,
      kpi: { select: { description: true } },
    },
    take: 200,
  });

  const kpis: ComposerKpi[] = participant.kpis.map((kpi) => ({
    ...kpi,
    weightage: kpi.weightage.toString(),
  }));

  const versionRows: KpiVersionRow[] = versions.map((v) => ({
    ...v,
    id: v.id,
    kpiId: v.kpiId,
    // The LIVE description, so a reader can tell which KPI this version belongs
    // to even when the version being shown is the one whose wording changed.
    kpiDescription: v.kpi.description,
    versionNo: v.versionNo,
    description: v.description,
    weightage: v.weightage.toString(),
    supersededAt: v.supersededAt.toISOString(),
    supersededByRequestId: v.supersededByRequestId,
  }));

  const subtitle = [
    participant.employee.email,
    participant.employee.department?.name,
    participant.employee.entity?.code,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("changeRequest.pageTitle", { name: participant.employee.name })}
        subtitle={subtitle}
        actions={
          <Link href={`/${locale}/mid-year`} className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft className="h-4 w-4" />
            {t("changeRequest.backAction")}
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{participant.cycle.year}</Badge>
        <Badge variant="outline">{t(`cycles.statusValue.${participant.cycle.status}`)}</Badge>
      </div>

      <MidYearBoard
        participantId={participant.id}
        stage={
          stage === null
            ? null
            : {
                opensAt: stage.opensAt.toISOString(),
                deadline: stage.deadline.toISOString(),
                graceDays: stage.graceDays,
                state: stageState(stage, now),
              }
        }
        kpis={kpis}
        versions={versionRows}
        pendingRequest={pending ? toReview(pending) : null}
        history={decided.map(toReview)}
        // §8.3 is its own branch in the board — a categorical absence, not a
        // blocked action — so an exempt participant renders the exemption.
        submitBlockedReason={exempt ? null : submitReason}
        canDecide={isHr(actor)}
        canWithdraw={
          pending !== null &&
          withdrawBlockedReason({
            actor,
            requestedByEmployeeId: pending.requestedByEmployeeId,
            status: "PENDING",
          }) === null
        }
        goalSettingExempt={exempt}
      />
    </div>
  );
}
