"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
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
import { formatDate, formatDateTime } from "@/lib/format";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { Check, Field, Textarea } from "@/components/shared/FormControls";
import { QueryState } from "../ui/states";
import { omr } from "./bits";
import type { NoteView } from "./types";

/**
 * The negotiation thread (Interview Hub `NegotiationThread`): the candidate's
 * pre-offer alignment notes and the offer's negotiation notes, in order.
 * Pay talk — comp readers only; others see why it is hidden.
 */
export function Negotiation({ path, canPost }: { path: string; canPost: boolean }) {
  const t = useTranslations("hiring.negotiation");
  const q = useHiringQuery<{ notes: NoteView[]; restricted: boolean }>(path);
  const [body, setBody] = useState("");
  const post = useHiringMutation<{ body: string }>("POST", path, {
    success: t("logged"),
    onSuccess: () => setBody(""),
  });
  return (
    <SectionCard title={t("title")} subtitle={t("hint")}>
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rows={3}>
        {q.data?.restricted ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" aria-hidden />
            {t("restricted")}
          </p>
        ) : (
          <div className="space-y-3">
            {q.data?.notes.length ? (
              <ul className="space-y-3">
                {q.data.notes.map((n) => (
                  <li key={n.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{n.authorName}</span>
                      <span>{formatDateTime(n.createdAt)}</span>
                      {n.kind === "PRE_OFFER_ALIGNMENT" ? (
                        <Badge variant="info">{t("beforeOffer")}</Badge>
                      ) : null}
                      {n.candidateConfirmed ? (
                        <Badge variant="success">{t("confirmed")}</Badge>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    {n.discussedSalary != null || n.discussedStartDate ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[
                          n.discussedSalary != null
                            ? t("discussedBasic", { amount: omr(n.discussedSalary) })
                            : null,
                          n.discussedStartDate
                            ? t("discussedStart", { date: formatDate(n.discussedStartDate) })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            )}
            {canPost ? (
              <div className="space-y-2">
                <Textarea
                  aria-label={t("logLabel")}
                  placeholder={t("logPlaceholder")}
                  rows={2}
                  maxLength={4000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={post.isPending || !body.trim()}
                    onClick={() => post.mutate({ body: body.trim() })}
                  >
                    {t("log")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </QueryState>
    </SectionCard>
  );
}

/** Pre-offer alignment (Interview Hub `PreOfferAlignmentModal`): negotiate first, then extend. */
export function AlignmentDialog({
  candidateId,
  candidateName,
  onClose,
}: {
  candidateId: string;
  candidateName: string;
  onClose: () => void;
}) {
  const t = useTranslations("hiring.negotiation");
  const [basic, setBasic] = useState("");
  const [start, setStart] = useState("");
  const [body, setBody] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const save = useHiringMutation<object>(
    "POST",
    `/api/hiring/candidates/${candidateId}/negotiations`,
    { success: t("alignmentSaved"), onSuccess: onClose },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("alignmentTitle", { name: candidateName })}</DialogTitle>
          <DialogDescription>{t("alignmentHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("discussedBasicLabel")} htmlFor="al-basic" hint={t("perMonthHint")}>
            <Input
              id="al-basic"
              type="number"
              min={0}
              step="0.001"
              value={basic}
              onChange={(e) => setBasic(e.target.value)}
            />
          </Field>
          <Field label={t("discussedStartLabel")} htmlFor="al-start">
            <Input
              id="al-start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field
            label={t("landed")}
            htmlFor="al-body"
            required
            hint={t("landedHint")}
            className="sm:col-span-2"
          >
            <Textarea
              id="al-body"
              rows={4}
              maxLength={4000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Check id="al-confirmed" checked={confirmed} onChange={setConfirmed}>
              {t("candidateConfirmed")}
            </Check>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={save.isPending || !body.trim()}
            onClick={() =>
              save.mutate({
                body: body.trim(),
                discussedSalary: basic === "" ? null : Number(basic),
                discussedStartDate: start || null,
                candidateConfirmed: confirmed,
              })
            }
          >
            {t("saveAlignment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
