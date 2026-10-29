"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { defaultDueAt } from "@/lib/hiring/assessment-rules";
import { useHiringMutation } from "../ui/api";
import { Field, Textarea } from "@/components/shared/FormControls";
import type { AssessmentRow } from "./AssessmentView";
import type { Policy } from "./AssessmentPolicy";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Record that the assessment was sent (the provider sends it; nothing is emailed from here). */
export function InviteDialog({
  open,
  onOpenChange,
  requisitionId,
  recipients,
  policy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  requisitionId: string;
  recipients: AssessmentRow[];
  policy: Policy;
}) {
  const t = useTranslations("hiring.assessment");
  const [due, setDue] = useState(() => isoDay(defaultDueAt(new Date())));
  const [minDue] = useState(() => isoDay(defaultDueAt(new Date(), 1)));
  const invite = useHiringMutation<object, { invited: number; reused: number }>(
    "POST",
    `/api/hiring/requisitions/${requisitionId}/assessment`,
    { success: t("invitesRecorded"), onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("inviteTitle")}</DialogTitle>
          <DialogDescription>
            {t("inviteHint", { months: policy.validityMonths })}
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{t("recipients")}</dt>
            <dd>{recipients.map((r) => r.candidateName).join(", ")}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("assessmentName")}</dt>
            <dd>{policy.name}</dd>
          </div>
        </dl>
        <Field label={t("completeBy")} htmlFor="as-due">
          <Input
            id="as-due"
            type="date"
            className="w-48"
            value={due}
            min={minDue}
            onChange={(e) => setDue(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={invite.isPending || !due || recipients.length === 0}
            onClick={() =>
              invite.mutate({
                action: "invite",
                candidateIds: recipients.map((r) => r.candidateId),
                dueAt: new Date(`${due}T12:00:00.000Z`).toISOString(),
              })
            }
          >
            {t("inviteConfirm", { count: recipients.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** D3 — record the result the provider returned (score, percentile, interview focus). */
export function RecordResultDialog({
  row,
  onClose,
  requisitionId,
}: {
  row: AssessmentRow | null;
  onClose: () => void;
  requisitionId: string;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {row ? (
          <RecordForm
            key={row.candidateId}
            row={row}
            onClose={onClose}
            requisitionId={requisitionId}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RecordForm({
  row,
  onClose,
  requisitionId,
}: {
  row: AssessmentRow;
  onClose: () => void;
  requisitionId: string;
}) {
  const t = useTranslations("hiring.assessment");
  const [score, setScore] = useState(row.score?.toString() ?? "");
  const [percentile, setPercentile] = useState(row.percentile?.toString() ?? "");
  const [focus, setFocus] = useState(row.interviewFocus ?? "");
  const record = useHiringMutation<object>(
    "POST",
    `/api/hiring/requisitions/${requisitionId}/assessment`,
    {
      success: t("resultRecorded"),
      onSuccess: onClose,
    },
  );
  const n = Number(score);
  const valid = score !== "" && Number.isInteger(n) && n >= 0 && n <= 100;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("recordTitle")}</DialogTitle>
        <DialogDescription>{row.candidateName}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("score")} htmlFor="as-score" hint={t("scoreHint")} required>
          <Input
            id="as-score"
            type="number"
            min={0}
            max={100}
            value={score}
            onChange={(e) => setScore(e.target.value)}
          />
        </Field>
        <Field label={t("percentile")} htmlFor="as-pct">
          <Input
            id="as-pct"
            type="number"
            min={0}
            max={100}
            value={percentile}
            onChange={(e) => setPercentile(e.target.value)}
          />
        </Field>
      </div>
      <Field label={t("focus")} htmlFor="as-focus" hint={t("focusHint")}>
        <Textarea id="as-focus" value={focus} onChange={(e) => setFocus(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button
          disabled={!valid || record.isPending}
          onClick={() =>
            record.mutate({
              action: "record",
              candidateId: row.candidateId,
              score: n,
              percentile: percentile === "" ? null : Number(percentile),
              interviewFocus: focus,
            })
          }
        >
          {t("saveResult")}
        </Button>
      </DialogFooter>
    </>
  );
}
