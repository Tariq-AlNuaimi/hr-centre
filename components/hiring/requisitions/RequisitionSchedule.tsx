"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import type { RoundPlanEntry } from "@/lib/hiring/interview-rules";
import { useHiringMe, useHiringMutation, useHiringQuery } from "../ui/api";
import { useCrumb } from "../ui/crumb";
import { FlowRail } from "../ui/flow-rail";
import { Notice, QueryState } from "../ui/states";
import { useRoundLabel } from "../interviews/bits";
import { ScheduleList } from "../interviews/ScheduleList";
import type { InterviewRow } from "../interviews/types";
import { BriefEditor } from "./BriefEditor";

type Schedule = {
  requisition: { id: string; title: string };
  plan: RoundPlanEntry[];
  rows: InterviewRow[];
  carried: { candidateId: string; candidateName: string; focus: string }[];
  can: { manage: boolean };
};

/** `/hiring/requisitions/[id]/interviews` (Interview Hub `PositionInterviewSchedule`). */
export function RequisitionSchedule({ id }: { id: string }) {
  const t = useTranslations("hiring.schedule");
  const router = useRouter();
  const locale = useLocale();
  const roundLabel = useRoundLabel();
  const { me } = useHiringMe();
  const q = useHiringQuery<Schedule>(`/api/hiring/requisitions/${id}/interviews`);
  const [editing, setEditing] = useState(false);
  const confirm = useHiringMutation<{ iid: string; confirmed: boolean }>(
    "POST",
    (b) => `/api/hiring/interviews/${b.iid}/confirm`,
    { success: t("confirmed") },
  );
  const s = q.data;
  useCrumb(id, s?.requisition.title);
  const mine = (r: InterviewRow) => r.panelists.find((p) => p.userId === me?.userId);
  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      {s ? (
        <div className="space-y-4">
          <PageHeader
            title={t("title")}
            subtitle={
              s.plan.length
                ? t("subtitle", { title: s.requisition.title, count: s.plan.length })
                : t("subtitleNone", { title: s.requisition.title })
            }
            actions={
              <>
                <a
                  className={buttonVariants({ variant: "outline" })}
                  href={`/api/hiring/interviews/calendar?requisitionId=${id}`}
                >
                  <CalendarDays className="h-4 w-4" />
                  {t("exportCalendar")}
                </a>
                {s.can.manage ? (
                  <Button
                    onClick={() =>
                      router.push(`/${locale}/hiring/interviews/new?requisitionId=${id}`)
                    }
                  >
                    <Plus className="h-4 w-4" />
                    {t("schedule")}
                  </Button>
                ) : null}
              </>
            }
          />
          <FlowRail current={3} />
          <div className="grid gap-6 lg:grid-cols-3">
            <section aria-labelledby="upcoming" className="space-y-3 lg:col-span-2">
              <div className="flex items-baseline justify-between">
                <h2 id="upcoming" className="text-base font-semibold">
                  {t("upcoming")}
                </h2>
                <span className="text-xs text-muted-foreground">{t("roundsVary")}</span>
              </div>
              <ScheduleList
                rows={s.rows}
                hideRequisition
                rowExtra={(r) => {
                  const m = mine(r);
                  return m && !m.confirmedAt ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={confirm.isPending}
                      onClick={() => confirm.mutate({ iid: r.id, confirmed: true })}
                    >
                      <Check className="h-4 w-4" />
                      {t("confirm")}
                    </Button>
                  ) : null;
                }}
                empty={
                  <p className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                    {s.can.manage ? t("emptyHr") : t("emptyPanel")}
                  </p>
                }
              />
            </section>
            <div className="space-y-4">
              <SectionCard
                title={t("briefTitle")}
                actions={
                  s.can.manage ? (
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                      <Pencil className="h-4 w-4" />
                      {t("editBrief")}
                    </Button>
                  ) : null
                }
              >
                {s.plan.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {s.can.manage ? t("noRoundsHr") : t("noRounds")}
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {s.plan.map((e) => (
                      <li key={e.round}>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{roundLabel(e.round, e.ordinal)}</span>
                          {e.configured ? null : <Badge variant="outline">{t("notWritten")}</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t("briefLine", {
                            competencies: e.competencies.length
                              ? e.competencies.join(", ")
                              : t("noCompetencies"),
                            minutes: e.durationMinutes,
                          })}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </SectionCard>
              {s.carried.length ? (
                <SectionCard title={t("carriedTitle", { n: s.plan[0]?.ordinal ?? 1 })}>
                  <ul className="space-y-2 text-sm">
                    {s.carried.map((c) => (
                      <li key={c.candidateId}>
                        <span className="font-semibold">{c.candidateName}</span>
                        <span className="text-muted-foreground"> — {c.focus}</span>
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              ) : null}
              <Notice tone="info">{t("antiAnchoring")}</Notice>
            </div>
          </div>
          {s.can.manage && editing ? (
            <BriefEditor requisitionId={id} plan={s.plan} onClose={() => setEditing(false)} />
          ) : null}
        </div>
      ) : null}
    </QueryState>
  );
}
