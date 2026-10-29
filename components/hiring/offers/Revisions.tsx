"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
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
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDate } from "@/lib/format";
import { diffOfferTerms, restartsApproval, type OfferTerms } from "@/lib/hiring/offer-package";
import { useHiringMutation } from "../ui/api";
import { Field, Textarea } from "@/components/shared/FormControls";
import { Notice } from "../ui/states";
import { AllowanceEditor, type Allowance } from "./OfferForm";
import { muscatDay } from "./bits";
import type { OfferDetail, VersionView } from "./types";

/** The sent versions (Interview Hub `OfferRevisions`). */
export function Revisions({
  versions,
  canRevise,
  onRevise,
}: {
  versions: VersionView[];
  canRevise: boolean;
  onRevise: () => void;
}) {
  const t = useTranslations("hiring.offerRevisions");
  return (
    <SectionCard
      title={t("title")}
      subtitle={t("hint")}
      actions={
        canRevise ? (
          <Button size="sm" variant="outline" onClick={onRevise}>
            {t("revise")}
          </Button>
        ) : null
      }
    >
      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="divide-y divide-border">
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm"
            >
              <div>
                <p>
                  <span className="font-mono font-semibold">{t("v", { n: v.versionNumber })}</span>{" "}
                  · {v.summary}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    formatDate(v.createdAt),
                    v.createdByName,
                    v.restartedApproval ? t("restarted") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {v.candidateNote ? (
                  <p className="mt-1 text-xs whitespace-pre-wrap italic">{v.candidateNote}</p>
                ) : null}
              </div>
              <Badge variant={v.current ? "success" : "outline"}>
                {v.current ? t("current") : t("superseded")}
              </Badge>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

const toAllowances = (m: Record<string, number> | null): Allowance[] =>
  Object.entries(m ?? {}).map(([key, amount]) => ({ key, amount: String(amount) }));
const fromAllowances = (a: Allowance[]) => {
  const m = Object.fromEntries(
    a.filter((x) => x.key && x.amount.trim() !== "").map((x) => [x.key, Number(x.amount)]),
  );
  return Object.keys(m).length ? m : null;
};

/** Send a revised offer (Interview Hub `ReviseOfferModal`); the impact line says whether approval restarts. */
export function ReviseDialog({ o, onClose }: { o: OfferDetail; onClose: () => void }) {
  const t = useTranslations("hiring.offerRevisions");
  const [salary, setSalary] = useState(o.salary == null ? "" : String(o.salary));
  const [allowances, setAllowances] = useState(toAllowances(o.allowances));
  const [startDate, setStartDate] = useState(muscatDay(o.startDate));
  const [note, setNote] = useState("");
  const prev: OfferTerms = { salary: o.salary, allowances: o.allowances, startDate: o.startDate };
  const patch: OfferTerms = {
    ...(o.compHidden
      ? {}
      : { salary: salary === "" ? null : Number(salary), allowances: fromAllowances(allowances) }),
    startDate: new Date(startDate).toISOString(),
  };
  const changed = diffOfferTerms(prev, patch);
  const revise = useHiringMutation<object, { restartedApproval: boolean }>(
    "POST",
    `/api/hiring/offers/${o.id}/versions`,
    {
      onSuccess: onClose,
      success: restartsApproval(changed) ? t("sentToApproval") : t("sent"),
    },
  );
  const send = () =>
    revise.mutate({
      ...(changed.includes("salary") ? { salary: patch.salary } : {}),
      ...(changed.includes("allowances") ? { allowances: patch.allowances } : {}),
      ...(changed.includes("startDate") ? { startDate: patch.startDate } : {}),
      ...(note.trim() ? { candidateNote: note.trim() } : {}),
    });
  return (
    <Dialog open onOpenChange={(x) => !x && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {o.compHidden ? null : (
            <>
              <Field label={t("basic")} htmlFor="rv-basic" hint={t("basicHint")}>
                <Input
                  id="rv-basic"
                  type="number"
                  min={0}
                  step="0.001"
                  className="w-48"
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                />
              </Field>
              <Field label={t("allowances")} htmlFor="rv-allowances">
                <AllowanceEditor value={allowances} onChange={setAllowances} />
              </Field>
            </>
          )}
          <Field label={t("startDate")} htmlFor="rv-start">
            <Input
              id="rv-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label={t("note")} htmlFor="rv-note" hint={t("noteHint")}>
            <Textarea
              id="rv-note"
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <Notice tone={restartsApproval(changed) ? "warning" : "info"}>
            {changed.length === 0
              ? t("impactNone")
              : restartsApproval(changed)
                ? t("impactRestart")
                : t("impactKeep")}
          </Notice>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={revise.isPending || changed.length === 0} onClick={send}>
            {t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
