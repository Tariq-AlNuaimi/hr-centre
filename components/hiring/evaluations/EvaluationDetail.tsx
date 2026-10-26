"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import type { HireVote } from "@/lib/hiring/scorecard-math";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { useCrumb } from "../ui/crumb";
import { QueryState } from "../ui/states";
import { ScoreDots, VoteBadge, useRoundLabel } from "../interviews/bits";
import { whenLabel } from "../interviews/time";
import { EvaluationForm } from "./EvaluationForm";

type Card = {
  id: string;
  vote: HireVote;
  submitted: boolean;
  submittedAt: string | null;
  scores: Record<string, number> | null;
  strengths: string | null;
  concerns: string | null;
  notes: string | null;
  candidate: { id: string; name: string };
  panelist: { id: string; name: string } | null;
  competencies: string[];
  interview: {
    id: string;
    round: string;
    scheduledDate: string;
    requisition: { id: string; title: string; competencies: string[] };
  };
};

/** `/hiring/evaluations/[id]` (Interview Hub evaluation detail): the scorecard readout and a correction form. */
export function EvaluationDetail({ id }: { id: string }) {
  const t = useTranslations("hiring.evaluations");
  const tp = useTranslations("hiring.panel");
  const router = useRouter();
  const locale = useLocale();
  const roundLabel = useRoundLabel();
  const q = useHiringQuery<Card>(`/api/hiring/evaluations/${id}`);
  const [editing, setEditing] = useState(false);
  const update = useHiringMutation<object>("PUT", `/api/hiring/evaluations/${id}`, {
    success: t("updated"),
    onSuccess: () => setEditing(false),
  });
  const c = q.data;
  useCrumb(id, c?.candidate.name);
  const scores = c?.scores ?? {};
  const competencies = c
    ? [...new Set([...c.interview.requisition.competencies, ...Object.keys(scores)])]
    : [];
  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      {c ? (
        <div className="space-y-4">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {[roundLabel(c.interview.round), c.panelist?.name ?? t("unknownPanelist")].join(" · ")}
          </p>
          <PageHeader
            title={t("detailTitle", { name: c.candidate.name })}
            subtitle={t("detailSubtitle", {
              requisition: c.interview.requisition.title,
              when: whenLabel(c.interview.scheduledDate),
            })}
            actions={
              <>
                <Button
                  variant="outline"
                  onClick={() => router.push(`/${locale}/hiring/evaluations`)}
                >
                  <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                  {t("backToList")}
                </Button>
                <Button onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" />
                  {t("edit")}
                </Button>
              </>
            }
          />
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <SectionCard title={tp("competencies")} noBodyPadding>
                {competencies.length === 0 ? (
                  <p className="p-5 text-sm text-muted-foreground">{t("noCompetencies")}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {competencies.map((k) => (
                      <li key={k} className="flex flex-wrap items-center gap-3 px-5 py-3">
                        <span className="flex-1">{k}</span>
                        {scores[k] ? (
                          <ScoreDots label={k} value={scores[k]} />
                        ) : (
                          <span className="text-sm text-muted-foreground">{t("notScored")}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
              <div className="grid gap-4 md:grid-cols-2">
                <SectionCard title={tp("strengths")}>
                  <p
                    className={
                      c.strengths ? "text-sm whitespace-pre-wrap" : "text-sm text-muted-foreground"
                    }
                  >
                    {c.strengths ?? t("noStrengths")}
                  </p>
                </SectionCard>
                <SectionCard title={tp("concerns")}>
                  <p
                    className={
                      c.concerns ? "text-sm whitespace-pre-wrap" : "text-sm text-muted-foreground"
                    }
                  >
                    {c.concerns ?? t("noConcerns")}
                  </p>
                </SectionCard>
              </div>
              <SectionCard title={tp("notes")}>
                <p
                  className={
                    c.notes ? "text-sm whitespace-pre-wrap" : "text-sm text-muted-foreground"
                  }
                >
                  {c.notes ?? t("noNotes")}
                </p>
              </SectionCard>
            </div>
            <div className="space-y-4">
              <SectionCard title={tp("voteTitle")}>
                {c.submitted ? (
                  <VoteBadge vote={c.vote} />
                ) : (
                  <p className="text-sm text-muted-foreground">{t("draftVote")}</p>
                )}
              </SectionCard>
              <SectionCard title={t("status")}>
                <div className="space-y-1 text-sm">
                  <Badge variant={c.submitted ? "success" : "outline"}>
                    {c.submitted ? t("submitted") : t("draft")}
                  </Badge>
                  {c.submittedAt ? (
                    <p className="text-xs text-muted-foreground">{whenLabel(c.submittedAt)}</p>
                  ) : null}
                </div>
              </SectionCard>
            </div>
          </div>
          <Dialog open={editing} onOpenChange={setEditing}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t("edit")}</DialogTitle>
              </DialogHeader>
              {editing ? (
                <EvaluationForm
                  competencies={competencies}
                  initial={{
                    scores,
                    vote: c.submitted ? c.vote : null,
                    strengths: c.strengths ?? "",
                    concerns: c.concerns ?? "",
                    notes: c.notes ?? "",
                    submitted: c.submitted,
                  }}
                  submitting={update.isPending}
                  submitLabel={t("save")}
                  onCancel={() => setEditing(false)}
                  onSubmit={(v) => update.mutate(v)}
                />
              ) : null}
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
    </QueryState>
  );
}
