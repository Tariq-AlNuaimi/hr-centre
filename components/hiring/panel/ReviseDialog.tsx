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
import type { HireVote } from "@/lib/hiring/scorecard-math";
import { useHiringMutation } from "../ui/api";
import { Field, Textarea } from "../ui/fields";
import { VotePicker } from "./ScorecardFields";
import type { MyCard } from "./types";

/** Revise my vote after the reveal — kept, with my reason on the audit trail. */
export function ReviseDialog({
  id,
  mine,
  onClose,
}: {
  id: string;
  mine: MyCard;
  onClose: () => void;
}) {
  const t = useTranslations("hiring.panel");
  const [vote, setVote] = useState<HireVote>(mine.vote);
  const [reason, setReason] = useState("");
  const revise = useHiringMutation<object>("POST", `/api/hiring/panel/${id}/revise`, {
    success: t("revised"),
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("reviseTitle")}</DialogTitle>
          <DialogDescription>{t("reviseHint")}</DialogDescription>
        </DialogHeader>
        <Field label={t("updatedVote")} htmlFor="rv-vote">
          <VotePicker id="rv-vote" value={vote} onChange={setVote} />
        </Field>
        <Field label={t("reviseReason")} htmlFor="rv-reason" required>
          <Textarea
            id="rv-reason"
            rows={3}
            maxLength={2000}
            placeholder={t("reviseReasonPlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={revise.isPending || reason.trim().length < 3}
            onClick={() =>
              revise.mutate({
                scores: mine.scores ?? {},
                strengths: mine.strengths ?? undefined,
                concerns: mine.concerns ?? undefined,
                notes: mine.notes ?? undefined,
                vote,
                reason: reason.trim(),
              })
            }
          >
            {t("recordRevision")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
