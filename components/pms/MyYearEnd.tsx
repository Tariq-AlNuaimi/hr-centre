"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { buttonVariants } from "@/components/ui/button-variants";
import { apiClient } from "@/lib/api-client";
import { YearEndAssessment, type YearEndKpi, type YearEndSetState } from "./YearEndAssessment";

/**
 * §7.1 from the employee's own side — the screen they could not reach.
 *
 * The assessment itself is not new: `YearEndAssessment` has always handled
 * `actingAs: "EMPLOYEE"`, and the manager's participant page has always passed
 * it for the subject. What was missing was a door. This is the door, and it
 * renders the SAME assessment rather than a second implementation of it.
 *
 * It decides nothing of its own. Every precondition — C-Level exemption (§8.3),
 * an HR-approved baseline (§5.1), an open stage (§5.4) — arrives from
 * `/api/year-end/me`, which reads it from the same `ratingBlockedReason` the
 * write route answers with. Being able to SEE the screen is not being allowed
 * to act on it, and the screen says which of the two it is.
 */

interface MyYearEndResponse {
  cycle: { id: string; year: number } | null;
  participant: { id: string; goalsApprovedAt: string | null } | null;
  stage: {
    opensAt: string;
    deadline: string;
    graceDays: number;
    state: "NOT_YET_OPEN" | "OPEN" | "LOCKED";
  } | null;
  kpis: YearEndKpi[];
  state?: YearEndSetState;
  signedParties?: ("EMPLOYEE" | "MANAGER")[];
  goalSettingExempt?: boolean;
  blockedReason?: string | null;
  storageConfigured?: boolean;
}

/** What `MyYearEnd` renders once there is genuinely something to render. */
type Ready = MyYearEndResponse & {
  cycle: NonNullable<MyYearEndResponse["cycle"]>;
  participant: NonNullable<MyYearEndResponse["participant"]>;
};

/**
 * `full` renders the rating form; `summary` renders a one-line pointer to it.
 *
 * The manager/HR page gets `summary` because the full form is TALL — three to
 * six KPIs of five radio options each, plus comment boxes and a sign-off panel.
 * Rendering it inline there pushed the roster about 1,100px down the page, so
 * the screen a manager opens every week to work their reports opened instead on
 * a form they fill in once a year. Measured by looking at the page, not guessed.
 */
type Variant = "full" | "summary";

/** The manager/HR variant: one line and a link, never the form. */
function OwnAssessmentPointer({ data }: { data: Ready }) {
  const t = useTranslations("pms.myYearEnd");
  const locale = useLocale();
  const rated = data.state?.employeeRated ?? 0;
  const total = data.state?.kpiCount ?? data.kpis.length;

  return (
    <SectionCard title={t("title")} subtitle={t("subtitle")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {rated === 0 ? t("summaryNotStarted") : t("summaryProgress", { rated, total })}
        </p>
        <Link
          href={`/${locale}/year-end/${data.cycle.id}/participants/${data.participant.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {rated === 0 ? t("summaryStart") : t("summaryResume")}
        </Link>
      </div>
    </SectionCard>
  );
}

/** The employee's own page: the real rating form, unwrapped. */
function OwnAssessmentForm({ data }: { data: Ready }) {
  return (
    <YearEndAssessment
      participantId={data.participant.id}
      stage={data.stage}
      kpis={data.kpis}
      initialState={
        data.state ?? {
          kpiCount: data.kpis.length,
          employeeRated: 0,
          managerRated: 0,
          complete: false,
          divergentKpiIds: [],
        }
      }
      // §7.1 — this route only ever returns the caller's own participant, so
      // there is exactly one side they can be acting as.
      actingAs="EMPLOYEE"
      signedParties={data.signedParties ?? []}
      goalSettingExempt={data.goalSettingExempt ?? false}
      blockedReason={data.blockedReason ?? null}
      storageConfigured={data.storageConfigured ?? false}
    />
  );
}

export function MyYearEnd({ variant = "full" }: { variant?: Variant } = {}) {
  const t = useTranslations("pms.myYearEnd");

  const mine = useQuery({
    queryKey: ["pms", "year-end", "me"],
    queryFn: () => apiClient.get<MyYearEndResponse>("/api/year-end/me"),
  });

  const data = mine.data;
  // `summary` is the MANAGER's page, where this card is a guest above their
  // roster: it says nothing rather than explaining an absence on a screen that
  // is working fine. On the employee's own page that same absence IS the
  // answer to their question, so it is spelled out.
  const quiet = variant === "summary";
  const ready = data?.cycle && data.participant ? (data as Ready) : null;

  if (mine.isLoading) return quiet ? null : <TableSkeleton rows={4} />;

  if (mine.isError) {
    if (quiet) return null;
    return (
      <SectionCard title={t("title")}>
        <EmptyState
          description={t("loadFailed")}
          actionLabel={t("retry")}
          onAction={() => void mine.refetch()}
        />
      </SectionCard>
    );
  }

  if (!ready) {
    if (quiet) return null;
    return (
      <SectionCard title={t("title")} subtitle={t("subtitle")}>
        {/* §3.5 — "not enrolled" is not "you have no KPIs". They are not in the
            cycle at all, and the remedy is HR's rather than theirs. */}
        <EmptyState
          description={data?.cycle ? t("notEnrolled", { year: data.cycle.year }) : t("noCycle")}
        />
      </SectionCard>
    );
  }

  if (!quiet) return <OwnAssessmentForm data={ready} />;

  // A manager with nothing of their own to assess, or who has already signed,
  // sees their roster rather than a card telling them so.
  if (ready.goalSettingExempt || ready.kpis.length === 0) return null;
  if (ready.signedParties?.includes("EMPLOYEE")) return null;
  return <OwnAssessmentPointer data={ready} />;
}
