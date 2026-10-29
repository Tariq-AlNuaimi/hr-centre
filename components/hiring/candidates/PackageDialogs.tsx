"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { NativeSelect } from "@/components/org/NativeSelect";
import { DOCUMENT_KINDS } from "@/lib/validations/hiring/candidate";
import { useHiringMutation } from "../ui/api";
import { Check, Field, Textarea } from "@/components/shared/FormControls";
import { Notice } from "../ui/states";

/** Upload one piece of package evidence (PDF or image ≤ 10 MB) — multipart, so not via hiringFetch. */
export function UploadDocumentDialog({
  open,
  onOpenChange,
  candidateId,
  showAmount,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  candidateId: string;
  showAmount: boolean;
}) {
  const t = useTranslations("hiring.package");
  const tk = useTranslations("hiring.documentKind");
  const qc = useQueryClient();
  const [kind, setKind] = useState("PAYSLIP");
  const [label, setLabel] = useState("");
  const [month, setMonth] = useState("");
  const [amount, setAmount] = useState("");
  const [fromCandidate, setFromCandidate] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setLabel("");
    setMonth("");
    setAmount("");
    setFile(null);
    setFromCandidate(false);
  };
  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", kind);
      body.append("label", label);
      if (month) body.append("periodMonth", new Date(`${month}-01T00:00:00.000Z`).toISOString());
      if (showAmount && amount) body.append("statedAmount", amount);
      if (fromCandidate) body.append("fromCandidate", "true");
      const res = await fetch(`/api/hiring/candidates/${candidateId}/documents`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(e?.error ?? t("uploadFailed"));
      }
      toast.success(t("uploaded"));
      void qc.invalidateQueries({ queryKey: ["hiring"] });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("uploadTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t("kind")} htmlFor="doc-kind" required>
            <NativeSelect id="doc-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {tk(k)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("label")} htmlFor="doc-label" required>
            <Input
              id="doc-label"
              maxLength={160}
              placeholder={t("labelPlaceholder")}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field label={t("month")} htmlFor="doc-month">
            <Input
              id="doc-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </Field>
          {showAmount ? (
            <Field label={t("amount")} htmlFor="doc-amount" hint={t("amountHint")}>
              <Input
                id="doc-amount"
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          ) : null}
          <Field label={t("file")} htmlFor="doc-file" hint={t("fileHint")} required>
            <Input
              id="doc-file"
              type="file"
              accept=".pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Check id="doc-from" checked={fromCandidate} onChange={setFromCandidate}>
            {t("fromCandidateCheck")}
          </Check>
          <Notice tone="warning" title={t("restrictedTitle")}>
            {t("restrictedBody")}
          </Notice>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button disabled={busy || !file || !label.trim()} onClick={() => void submit()}>
            {t("uploadConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Declined to share salary history" — a legitimate answer, recorded verbatim and attributed. */
export function DeclineDialog({
  open,
  onOpenChange,
  candidateId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  candidateId: string;
}) {
  const t = useTranslations("hiring.package");
  const [reason, setReason] = useState("");
  const decline = useHiringMutation<{ action: "decline"; reason: string }>(
    "POST",
    `/api/hiring/candidates/${candidateId}/package`,
    {
      success: t("recorded"),
      onSuccess: () => {
        setReason("");
        onOpenChange(false);
      },
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("declineTitle")}</DialogTitle>
          <DialogDescription>{t("declineNote")}</DialogDescription>
        </DialogHeader>
        <Field
          label={t("declineReason")}
          htmlFor="decline-reason"
          hint={t("declineReasonHint")}
          required
        >
          <Textarea
            id="decline-reason"
            maxLength={1000}
            placeholder={t("declinePlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={decline.isPending || !reason.trim()}
            onClick={() => decline.mutate({ action: "decline", reason: reason.trim() })}
          >
            {t("declineConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
