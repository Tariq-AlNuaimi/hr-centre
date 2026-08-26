import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { YearEndAssessment, type YearEndKpi } from "@/components/pms/YearEndAssessment";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { RATING_LEVELS, YEAR_END_STAGE, ratingBlockedReason } from "@/lib/pms/rating";
import { yearEndState } from "@/lib/pms/year-end";
import { isGoalSettingExempt, stageState, type StageWindow } from "@/lib/pms/cycle";
import { visibilityDescendants } from "@/lib/pms/org-tree";
import { canActOnEmployee, canViewEmployee } from "@/lib/pms/permissions";

/**
 * §7.1 — one participant's year-end assessment.
 *
 * A server component reading through Prisma directly, the same pattern the
 * goal-setting and mid-year screens use: the alternative is three round trips to
 * assemble one view of an assessment, and §4.2's boundary is answered HERE,
 * before anything is read into the payload.
 *
 * WHICH SIDE the viewer acts as is decided by relationship, not by a toggle:
 * the subject self-assesses, their direct line manager reviews (§4.2), and
 * anyone else in the chain looks on. HR sees everything and acts on nothing here
 * — §7.1 gives both signatures to named parties, and §5.5 is HR's real path past
 * a stuck one.
 */

export default async function YearEndParticipantPage({
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
        // Enumerated and salary-free by construction (§4.5).
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
            where: { kind: YEAR_END_STAGE },
            select: { kind: true, opensAt: true, deadline: true, graceDays: true },
          },
        },
      },
      kpis: {
        where: { deletedAt: null },
        orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          description: true,
          weightage: true,
          descriptorOutstanding: true,
          descriptorExcellent: true,
          descriptorTarget: true,
          descriptorAlmostAchieved: true,
          descriptorUnsatisfactory: true,
          ratings: {
            select: { party: true, level: true, comment: true, ratedAt: true },
          },
        },
      },
      signOffs: {
        where: { stageKind: YEAR_END_STAGE },
        select: { party: true, signedAt: true },
      },
    },
  });

  // A mistyped cycle in the URL must not resolve a different year's assessment.
  if (!participant || participant.cycleId !== cycleId) notFound();

  // §4.2 — visibility first, 404 rather than 403.
  const descendants = await visibilityDescendants(actor);
  if (!canViewEmployee(actor, participant.employee.id, descendants)) notFound();

  const stage: StageWindow | null = participant.cycle.stages[0] ?? null;
  const exempt = isGoalSettingExempt(participant.employee.roleTrack);

  // Which side this viewer is. The subject self-assesses; their DIRECT manager
  // reviews. Anyone else with visibility looks on (§4.2's view-only rule).
  const isSubject = actor.employeeId !== null && actor.employeeId === participant.employee.id;
  const isDirectManager =
    !isSubject && canActOnEmployee(actor, participant.employee) && !actor.capabilities.orgWide;
  const actingAs: "EMPLOYEE" | "MANAGER" | null = isSubject
    ? "EMPLOYEE"
    : isDirectManager
      ? "MANAGER"
      : null;

  const kpis: YearEndKpi[] = participant.kpis.map((kpi) => {
    const find = (party: "EMPLOYEE" | "MANAGER") => {
      const r = kpi.ratings.find((x) => x.party === party);
      return r ? { level: r.level, comment: r.comment, ratedAt: r.ratedAt.toISOString() } : null;
    };
    return {
      id: kpi.id,
      description: kpi.description,
      // Decimal crosses as a STRING — §5.3/§8.2 arithmetic stays off floats.
      weightage: kpi.weightage.toString(),
      // §7.1 — the five sentences the manager authored for THIS KPI, in §8.1's
      // order. The screen asks which one describes the year; the number is only
      // how §8 will later score it.
      levels: RATING_LEVELS.map(({ level, field }) => ({ level, text: kpi[field] })),
      employeeRating: find("EMPLOYEE"),
      managerRating: find("MANAGER"),
    };
  });

  const state = yearEndState(
    participant.kpis,
    participant.kpis.flatMap((k) =>
      k.ratings.map((r) => ({ kpiId: k.id, party: r.party, level: r.level })),
    ),
  );

  // The same sentence the write route would answer with, so the screen and the
  // API never disagree about why an action is unavailable.
  const refusal =
    actingAs === null
      ? null
      : ratingBlockedReason({
          actor,
          party: actingAs,
          subject: participant.employee,
          stage,
          now,
          goalsApprovedAt: participant.goalsApprovedAt,
          // Asked about the SET, not one KPI: this drives the page-level notice,
          // and §7.1's per-KPI ordering is enforced per row by the route.
          employeeRated: state.employeeRated > 0,
        });

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
        title={t("yearEnd.pageTitle", { name: participant.employee.name })}
        subtitle={subtitle}
        actions={
          <Link href={`/${locale}/year-end`} className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft className="h-4 w-4" />
            {t("yearEnd.backAction")}
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{participant.cycle.year}</Badge>
        <Badge variant="outline">{t(`cycles.statusValue.${participant.cycle.status}`)}</Badge>
      </div>

      <YearEndAssessment
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
        initialState={state}
        actingAs={actingAs}
        signedParties={participant.signOffs.map((s) => s.party)}
        goalSettingExempt={exempt}
        blockedReason={exempt ? null : (refusal?.reason ?? null)}
      />
    </div>
  );
}
