"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Bell, ClipboardPen } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDate } from "@/lib/format";
import {
  advanceableCount,
  effectiveStatus,
  percentileBand,
  type AssessmentStatusValue,
} from "@/lib/hiring/assessment-rules";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { FlowRail } from "../ui/flow-rail";
import { useCrumb } from "../ui/crumb";
import { Notice, QueryState } from "../ui/states";
import { InviteDialog, RecordResultDialog } from "./AssessmentDialogs";
import { AssessmentPolicy, type Policy } from "./AssessmentPolicy";

export type AssessmentRow = {
  candidateId: string;
  candidateName: string;
  status: string;
  invitedAt: string | null;
  score: number | null;
  percentile: number | null;
  interviewFocus: string | null;
  completedAt: string | null;
  dueAt: string | null;
  remindersSent: number;
};
type View = { requisition: { id: string; title: string }; policy: Policy; rows: AssessmentRow[] };

const STATUS_TONE: Record<string, "success" | "info" | "default" | "warning"> = {
  COMPLETED: "success",
  IN_PROGRESS: "info",
  INVITED: "default",
  EXPIRED: "warning",
  NOT_SENT: "default",
};
const BAND_TONE = { TOP_DECILE: "success", ABOVE: "info", BELOW: "default" } as const;

/**
 * The aptitude-assessment step (Interview Hub `/positions/[id]/assessment`):
 * record invitations, reminders and results; advance everyone with a result
 * the policy does not hold. A score never rejects anyone on its own.
 */
export function AssessmentView({ id }: { id: string }) {
  const t = useTranslations("hiring.assessment");
  const q = useHiringQuery<View>(`/api/hiring/requisitions/${id}/assessment`);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [recording, setRecording] = useState<AssessmentRow | null>(null);
  const post = useHiringMutation<
    Record<string, unknown>,
    { advanced?: number; reminded?: number; held?: { reason: string }[] }
  >("POST", `/api/hiring/requisitions/${id}/assessment`);
  const view = useMemo(() => {
    const now = new Date();
    return (q.data?.rows ?? []).map((r) => ({
      ...r,
      status:
        r.status === "NOT_SENT"
          ? "NOT_SENT"
          : effectiveStatus(
              r.status as AssessmentStatusValue,
              r.dueAt ? new Date(r.dueAt) : null,
              now,
            ),
    }));
  }, [q.data]);
  const policy = q.data?.policy;
  useCrumb(id, q.data?.requisition.title);
  const allIds = view.map((r) => r.candidateId);
  const outstanding = view.filter(
    (r) => r.status === "INVITED" || r.status === "IN_PROGRESS",
  ).length;
  const needsInvite = view.filter((r) => r.status === "NOT_SENT" || r.status === "EXPIRED");
  const canAdvance = policy ? advanceableCount(view, policy) : 0;

  const detail = (r: AssessmentRow) => {
    if (!r.invitedAt) return t("detailNone");
    const sent = formatDate(r.invitedAt);
    switch (r.status) {
      case "COMPLETED":
        return r.completedAt
          ? t("detailCompleted", { date: formatDate(r.completedAt) })
          : t("statuses.COMPLETED");
      case "IN_PROGRESS":
        return t("detailInProgress", { date: sent });
      case "EXPIRED":
        return r.dueAt
          ? t("detailExpired", { date: formatDate(r.dueAt) })
          : t("detailExpiredNoDate");
      default:
        return r.remindersSent > 0
          ? t("detailReminded", { date: sent, count: r.remindersSent })
          : t("detailInvited", { date: sent });
    }
  };

  const columns = [
    {
      title: t("colCandidate"),
      key: "c",
      render: (_: unknown, r: AssessmentRow) => (
        <span className="font-medium">{r.candidateName}</span>
      ),
    },
    {
      title: t("colStatus"),
      key: "s",
      render: (_: unknown, r: AssessmentRow) => (
        <div className="flex flex-col gap-1">
          <Badge variant={STATUS_TONE[r.status] ?? "default"} className="self-start">
            {t(`statuses.${r.status}`)}
          </Badge>
          <span className="text-xs text-muted-foreground">{detail(r)}</span>
        </div>
      ),
    },
    {
      title: t("colScore"),
      key: "score",
      align: "center" as const,
      render: (_: unknown, r: AssessmentRow) => r.score ?? "—",
    },
    {
      title: t("colPercentile"),
      key: "p",
      render: (_: unknown, r: AssessmentRow) => {
        const band = policy ? percentileBand(r.percentile, r.score, policy.passThreshold) : null;
        return band ? (
          <Badge variant={BAND_TONE[band]} title={t("percentileOf", { n: r.percentile ?? 0 })}>
            {t(`bands.${band}`)}
          </Badge>
        ) : (
          "—"
        );
      },
    },
    {
      title: t("colFocus"),
      key: "f",
      render: (_: unknown, r: AssessmentRow) =>
        r.interviewFocus ?? <span className="text-muted-foreground">{t("noFocus")}</span>,
    },
    {
      title: "",
      key: "a",
      align: "right" as const,
      render: (_: unknown, r: AssessmentRow) =>
        r.status !== "NOT_SENT" ? (
          <Button size="sm" variant="outline" onClick={() => setRecording(r)}>
            <ClipboardPen className="h-4 w-4" />
            {t("record")}
          </Button>
        ) : null,
    },
  ];

  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      {q.data && policy ? (
        <div className="space-y-4">
          <PageHeader
            title={t("title")}
            subtitle={t("subtitle", { title: q.data.requisition.title, count: view.length })}
            actions={
              <>
                <Button
                  variant="outline"
                  disabled={outstanding === 0 || post.isPending}
                  onClick={() =>
                    post.mutate(
                      { action: "remind", candidateIds: allIds },
                      {
                        onSuccess: (r) =>
                          r.reminded
                            ? toast.success(t("reminded", { count: r.reminded }))
                            : toast.warning(t("nothingToChase")),
                      },
                    )
                  }
                >
                  <Bell className="h-4 w-4" />
                  {t("remind")}
                </Button>
                <Button
                  disabled={canAdvance === 0 || post.isPending}
                  onClick={() =>
                    post.mutate(
                      { action: "advance", candidateIds: allIds },
                      {
                        onSuccess: (r) => toast.success(t("advanced", { count: r.advanced ?? 0 })),
                      },
                    )
                  }
                >
                  <ArrowRight className="h-4 w-4" />
                  {t("advance", { count: canAdvance })}
                </Button>
              </>
            }
          />
          <FlowRail current={2} />
          {post.data?.held?.length ? (
            <Notice tone="warning" title={t("heldTitle", { count: post.data.held.length })}>
              {post.data.held[0].reason}
            </Notice>
          ) : null}
          {needsInvite.length > 0 ? (
            <Notice tone="info" title={t("waiting", { count: needsInvite.length })}>
              <p>{t("reuseHint", { months: policy.validityMonths })}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => setInviteOpen(true)}
              >
                {t("sendAssessment")}
              </Button>
            </Notice>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <SectionCard
              title={t("results")}
              actions={<span className="text-xs text-muted-foreground">{t("resultsHint")}</span>}
            >
              <DataTable<AssessmentRow>
                rowKey="candidateId"
                columns={columns}
                dataSource={view}
                emptyText={
                  <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
                }
              />
            </SectionCard>
            <AssessmentPolicy policy={policy} />
          </div>
          <InviteDialog
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            requisitionId={id}
            recipients={needsInvite}
            policy={policy}
          />
          <RecordResultDialog
            row={recording}
            onClose={() => setRecording(null)}
            requisitionId={id}
          />
        </div>
      ) : null}
    </QueryState>
  );
}
