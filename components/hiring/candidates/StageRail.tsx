"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Ban, ClipboardCheck, Lock, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RAIL_STEPS,
  stageTransitionError,
  stepEntryStage,
  stepForStage,
  type Stage,
} from "@/lib/hiring/stage-rules";
import { cn } from "@/lib/utils";
import { Field, Textarea } from "../ui/fields";
import { Notice } from "../ui/states";
import { useStageMove } from "./useStageMove";

const INTERVIEW_STEP = 3;
const EVALUATE_STEP = 4;
const DECIDE_STEP = 5;

/**
 * The stage rail on a profile (Interview Hub `CandidateStageHeader`): click a
 * later step to move forward (gates apply), an earlier one to move back (a
 * reason is asked), refuse with a reason, or reactivate a closed candidate.
 */
export function StageRail({
  candidateId,
  stage,
  canEdit,
}: {
  candidateId: string;
  stage: Stage;
  canEdit: boolean;
}) {
  const t = useTranslations("hiring.candidate");
  const tStep = useTranslations("hiring.steps");
  const ts = useTranslations("hiring.stage");
  const { move, busy, dialog } = useStageMove();
  const [reasonFor, setReasonFor] = useState<Stage | null>(null);
  const [reason, setReason] = useState("");
  const step = stepForStage(stage);
  const terminal = step < 1;

  const ask = (to: Stage) => {
    setReason("");
    setReasonFor(to);
  };
  const onStep = (target: number) => {
    const to = stepEntryStage(target);
    if (target === step || stageTransitionError(stage, to)) return;
    if (target < step) ask(to);
    else void move(candidateId, to);
  };
  const lm = step >= DECIDE_STEP ? "approved" : step >= EVALUATE_STEP ? "requested" : "none";

  return (
    <section
      aria-label={t("railLabel")}
      className="space-y-3 rounded-md border border-border bg-card p-4"
    >
      {terminal ? (
        <Notice
          tone={stage === "REJECTED" ? "danger" : "warning"}
          title={t("offPipeline", { stage: ts(stage) })}
        >
          {canEdit ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={busy}
              onClick={() => onStep(2)}
            >
              <RotateCcw className="h-4 w-4" />
              {t("reactivate")}
            </Button>
          ) : null}
        </Notice>
      ) : (
        <ol aria-label={t("railSteps")} className="flex flex-wrap gap-1">
          {RAIL_STEPS.map((s) => {
            const disabled = !canEdit || busy || s === 0 || s === step;
            return (
              <li key={s}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-current={s === step ? "step" : undefined}
                  onClick={() => onStep(s)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm",
                    s === step
                      ? "border-primary bg-accent-subtle font-semibold text-primary-emphasis"
                      : s < step
                        ? "border-border text-foreground"
                        : "border-border text-muted-foreground",
                    !disabled && "hover:bg-muted",
                  )}
                >
                  {tStep(String(s))}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <>
            <Button
              variant="outline"
              disabled={busy || step < INTERVIEW_STEP || step >= DECIDE_STEP}
              title={
                step < INTERVIEW_STEP
                  ? t("unlocksAt", { step: tStep(String(INTERVIEW_STEP)) })
                  : undefined
              }
              onClick={() => void move(candidateId, "DECISION_PENDING")}
            >
              {step < INTERVIEW_STEP ? (
                <Lock className="h-4 w-4" />
              ) : (
                <ClipboardCheck className="h-4 w-4" />
              )}
              {t("requestLm")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || terminal}
              onClick={() => ask("REJECTED")}
            >
              <Ban className="h-4 w-4" />
              {t("refuse")}
            </Button>
          </>
        ) : null}
        <span className="flex-1" />
        <Badge variant={lm === "approved" ? "success" : lm === "requested" ? "warning" : "default"}>
          {t(`lm.${lm}`)}
        </Badge>
      </div>
      <Dialog open={reasonFor !== null} onOpenChange={(o) => !o && setReasonFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reasonFor === "REJECTED"
                ? t("refuseTitle")
                : t("moveBackTitle", { stage: reasonFor ? ts(reasonFor) : "" })}
            </DialogTitle>
          </DialogHeader>
          <Field label={t("reason")} htmlFor="rail-reason" hint={t("reasonHint")}>
            <Textarea id="rail-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonFor(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant={reasonFor === "REJECTED" ? "destructive" : "default"}
              disabled={busy}
              onClick={() => {
                const to = reasonFor;
                if (!to) return;
                setReasonFor(null);
                void move(candidateId, to, { reason: reason.trim() || undefined });
              }}
            >
              {reasonFor === "REJECTED" ? t("refuse") : t("move")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dialog}
    </section>
  );
}
