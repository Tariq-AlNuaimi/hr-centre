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
import { NativeSelect } from "@/components/org/NativeSelect";
import { useHiringMutation } from "../ui/api";
import { Field, Textarea } from "../ui/fields";
import { Notice } from "../ui/states";
import type { Comparison } from "./comparison-types";

const MIN_NOTE = 20;

/** Step 8: choose the preferred candidate with a written decision note. */
export function SelectPreferredDialog({
  id,
  v,
  initial,
  onClose,
}: {
  id: string;
  v: Comparison;
  initial?: string;
  onClose: () => void;
}) {
  const t = useTranslations("hiring.comparison");
  const [candidateId, setCandidateId] = useState(initial ?? v.finalists[0]?.candidateId ?? "");
  const [note, setNote] = useState("");
  const pick = v.finalists.find((f) => f.candidateId === candidateId);
  const select = useHiringMutation<{
    action: "select-preferred";
    candidateId: string;
    note: string;
  }>("POST", `/api/hiring/requisitions/${id}/comparison`, {
    success: t("selected"),
    onSuccess: onClose,
  });
  const short = note.trim().length < MIN_NOTE;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("selectTitle")}</DialogTitle>
          <DialogDescription>{t("selectHint")}</DialogDescription>
        </DialogHeader>
        <Field label={t("candidate")} htmlFor="cmp-cand" required>
          <NativeSelect
            id="cmp-cand"
            value={candidateId}
            onChange={(e) => setCandidateId(e.target.value)}
          >
            {v.finalists.map((f) => (
              <option key={f.candidateId} value={f.candidateId}>
                {f.weighted === null
                  ? f.name
                  : t("candidateOption", { name: f.name, score: f.weighted.toFixed(1) })}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {pick && pick.coverage.outstanding ? (
          <Notice tone="warning">
            {t("selectOutstanding", { count: pick.coverage.outstanding })}
          </Notice>
        ) : null}
        <Field
          label={t("note")}
          htmlFor="cmp-note"
          required
          hint={t("noteHint", { min: MIN_NOTE })}
          error={note && short ? t("noteShort", { min: MIN_NOTE }) : undefined}
        >
          <Textarea
            id="cmp-note"
            maxLength={4000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <p className="text-xs text-muted-foreground">{t("selectEffect")}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={select.isPending || short || !candidateId}
            onClick={() =>
              select.mutate({ action: "select-preferred", candidateId, note: note.trim() })
            }
          >
            {t("confirmSelect")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reject a finalist who is not the preferred candidate; the notice follows the usual hold rules. */
export function RejectFinalistDialog({
  id,
  v,
  onClose,
}: {
  id: string;
  v: Comparison;
  onClose: () => void;
}) {
  const t = useTranslations("hiring.comparison");
  const options = v.finalists.filter((f) => !f.preferred);
  const [candidateId, setCandidateId] = useState(options[0]?.candidateId ?? "");
  const [reason, setReason] = useState("");
  const reject = useHiringMutation<{
    action: "reject-finalist";
    candidateId: string;
    reason: string;
  }>("POST", `/api/hiring/requisitions/${id}/comparison`, {
    success: t("rejected"),
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("rejectTitle")}</DialogTitle>
          <DialogDescription>{t("rejectHint")}</DialogDescription>
        </DialogHeader>
        <Field label={t("candidate")} htmlFor="cmp-rej" required>
          <NativeSelect
            id="cmp-rej"
            value={candidateId}
            onChange={(e) => setCandidateId(e.target.value)}
          >
            {options.map((f) => (
              <option key={f.candidateId} value={f.candidateId}>
                {f.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("reason")} htmlFor="cmp-reason" required>
          <Textarea
            id="cmp-reason"
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={reject.isPending || reason.trim().length < 3 || !candidateId}
            onClick={() =>
              reject.mutate({ action: "reject-finalist", candidateId, reason: reason.trim() })
            }
          >
            {t("confirmReject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
