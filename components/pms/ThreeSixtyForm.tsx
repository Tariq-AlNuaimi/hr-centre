"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { ANSWER_SCALE } from "@/lib/pms/three-sixty-scale";

/**
 * §9.7 — "Evaluators complete and submit."
 *
 * ## Why this exists
 *
 * It did not. `POST /api/three-sixty/responses` was complete, tested and called
 * by nothing: no screen in the product let a rater answer a 360. Because §8.3
 * gives every non-C-Level track a 360 weight and §8's score run refuses an
 * employee without a 360 result, that one missing form blocked §8, §10, §11 and
 * §13 for everyone in the company. It is the largest gap the red-team pass found
 * (`docs/verification/SPEC-REDTEAM.md`, F1).
 *
 * ## §9.3's scale is forced, and the UI must not soften it
 *
 * Four points, no neutral midpoint: Strongly Disagree, Disagree, Agree, Strongly
 * Agree. Rendered as a radio group per question with no pre-selection — a
 * default would be an opinion the rater did not express, and §9.5 divides by the
 * whole form, so a silently-defaulted answer is indistinguishable from a
 * considered one. Unanswered stays unanswered until they choose.
 *
 * ## Saving and submitting are different acts
 *
 * The route accepts `submit: false` for an incremental save, which is what makes
 * §9.7's IN_PROGRESS status mean something. Submit is the one-way door and the
 * route refuses it while any scored question is unanswered — §9.5 divides by the
 * form's maximum, so a gap reads as a low score rather than as unfinished. The
 * button is disabled until the form is complete, and the count says what is
 * left, so the refusal is something the rater reads rather than hits.
 *
 * ## Anonymity is not this screen's job, but it depends on it
 *
 * §13.1 consolidates comments unattributed. That holds only because a response
 * belongs to exactly the rater who wrote it — the route enforces that (404 for
 * anyone else) and this screen never shows another rater's answers.
 */

interface FormQuestion {
  id: string;
  text: string;
  orderIndex: number;
  scored: boolean;
}

interface FormResponse {
  assignment: {
    id: string;
    status: "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "OVERDUE";
    ratee: { id: string; name: string };
    templateType: string;
    deadline: string;
    submittedAt: string | null;
    canAnswer: boolean;
    blockedReason: string | null;
  };
  questions: FormQuestion[];
  answers: { questionId: string; score: number | null; text: string | null }[];
}

type Draft = Record<string, { score?: number | null; text?: string | null }>;

export function ThreeSixtyForm({ assignmentId }: { assignmentId: string }) {
  const t = useTranslations("pms.threeSixtyForm");
  const tScale = useTranslations("pms.threeSixtyForm.scale");
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});

  const form = useQuery({
    queryKey: ["pms", "360", "form", assignmentId],
    queryFn: () =>
      apiClient.get<FormResponse>(`/api/three-sixty/responses?assignmentId=${assignmentId}`),
  });

  // Saved answers underneath, the rater's unsaved edits on top.
  const saved = useMemo(() => {
    const map: Draft = {};
    for (const a of form.data?.answers ?? []) {
      map[a.questionId] = { score: a.score, text: a.text };
    }
    return map;
  }, [form.data]);

  const valueFor = (questionId: string) => ({ ...saved[questionId], ...draft[questionId] });

  const answersPayload = () => {
    const questions = form.data?.questions ?? [];
    return questions
      .map((q) => {
        const v = valueFor(q.id);
        return {
          questionId: q.id,
          ...(q.scored ? { score: v.score ?? null } : { text: v.text ?? null }),
        };
      })
      .filter((a) => ("score" in a ? a.score !== null : (a.text ?? "") !== ""));
  };

  const mutation = useMutation({
    mutationFn: (submit: boolean) =>
      apiClient.post(`/api/three-sixty/responses`, {
        assignmentId,
        answers: answersPayload(),
        submit,
      }),
    onSuccess: (_data, submit) => {
      toast.success(submit ? t("submittedToast") : t("savedToast"));
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: ["pms", "360", "form", assignmentId] });
      // My Tasks drops a submitted assignment (§4.4), so it has to re-read.
      void queryClient.invalidateQueries({ queryKey: ["pms", "360", "mine"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (form.isLoading) return <PageSkeleton />;
  if (form.isError || !form.data) {
    return (
      <SectionCard title={t("loadFailed")}>
        <EmptyState description={t("loadFailedHelp")} />
      </SectionCard>
    );
  }

  const { assignment, questions } = form.data;
  const scored = questions.filter((q) => q.scored);
  const unanswered = scored.filter((q) => (valueFor(q.id).score ?? null) === null);
  const readOnly = !assignment.canAnswer;

  return (
    <div className="space-y-6">
      <SectionCard
        title={t("about", { name: assignment.ratee.name })}
        subtitle={t(`type.${assignment.templateType}`)}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={assignment.status === "OVERDUE" ? "warning" : "outline"}>
            {t(`status.${assignment.status}`)}
          </Badge>
          <span className="text-muted-foreground">
            {t("due", { when: formatDateTime(assignment.deadline) })}
          </span>
        </div>
        {/* The route's own sentence, not a guess at it — so the reason a form is
            read-only is the same reason the write would refuse. */}
        {assignment.blockedReason && (
          <p className="mt-3 text-sm text-destructive-emphasis" role="status">
            {assignment.blockedReason}
          </p>
        )}
      </SectionCard>

      <SectionCard title={t("questionsTitle")} subtitle={t("questionsHelp")}>
        <ol className="space-y-6">
          {questions.map((question, index) => (
            <li key={question.id}>
              {question.scored ? (
                <fieldset disabled={readOnly}>
                  {/* A legend rather than a bare <p>: the four radios are one
                      question, and a screen reader needs the grouping to say
                      which question it is reading options for. */}
                  <legend className="text-sm font-medium text-foreground">
                    {index + 1}. {question.text}
                  </legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    {ANSWER_SCALE.map((point) => {
                      const id = `q-${question.id}-${point.score}`;
                      const selected = (valueFor(question.id).score ?? null) === point.score;
                      return (
                        <label
                          key={point.score}
                          htmlFor={id}
                          className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${
                            selected
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          <input
                            type="radio"
                            id={id}
                            name={`q-${question.id}`}
                            value={point.score}
                            checked={selected}
                            disabled={readOnly}
                            onChange={() =>
                              setDraft((d) => ({
                                ...d,
                                [question.id]: { ...d[question.id], score: point.score },
                              }))
                            }
                            className="accent-primary"
                          />
                          <span>{tScale(point.key)}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : (
                <div>
                  <label
                    htmlFor={`q-${question.id}`}
                    className="text-sm font-medium text-foreground"
                  >
                    {index + 1}. {question.text}
                  </label>
                  <textarea
                    id={`q-${question.id}`}
                    rows={4}
                    disabled={readOnly}
                    value={valueFor(question.id).text ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [question.id]: { ...d[question.id], text: e.target.value },
                      }))
                    }
                    placeholder={t("openEndedPlaceholder")}
                    className="mt-2 w-full rounded-md border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-60"
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
      </SectionCard>

      {!readOnly && (
        <SectionCard title={t("finishTitle")} subtitle={t("finishHelp")}>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => mutation.mutate(false)}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? t("working") : t("saveAction")}
            </Button>
            <Button
              onClick={() => mutation.mutate(true)}
              disabled={mutation.isPending || unanswered.length > 0}
            >
              {mutation.isPending ? t("working") : t("submitAction")}
            </Button>
            <span className="text-sm text-muted-foreground">
              {unanswered.length > 0
                ? t("remaining", { count: unanswered.length })
                : t("readyToSubmit")}
            </span>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
