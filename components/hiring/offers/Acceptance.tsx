"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
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
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useHiringMutation } from "../ui/api";
import { Field } from "@/components/shared/FormControls";
import { muscatDay } from "./bits";
import type { OfferDetail, VersionView } from "./types";

/** The offer timeline and the acceptance record (Interview Hub `OfferAcceptancePanel`). */
export function AcceptancePanel({
  o,
  versions,
  onRecord,
}: {
  o: OfferDetail;
  versions: VersionView[];
  onRecord: () => void;
}) {
  const t = useTranslations("hiring.offerAcceptance");
  const accepted = o.status === "ACCEPTED";
  const timeline = [
    ...versions.map((v) => ({
      k: v.id,
      label: v.versionNumber === 1 ? t("extended") : t("revisedSent"),
      at: v.createdAt,
    })),
    ...(o.signedAt ? [{ k: "signed", label: t("signedReturned"), at: o.signedAt }] : []),
  ];
  const facts = [
    { k: "status", label: t("status"), value: accepted ? t("accepted") : t("notAccepted") },
    {
      k: "joining",
      label: t("joiningDate"),
      value: o.joiningDate ? formatDate(o.joiningDate) : t("notConfirmed"),
    },
    { k: "signed", label: t("signedDoc"), value: o.signedFileName ?? t("notReturned") },
    { k: "notice", label: t("noticeServed"), value: o.noticeDetail ?? t("notRecorded") },
    {
      k: "counter",
      label: t("countersigned"),
      value: o.countersignedBy
        ? t("countersignedBy", {
            name: o.countersignedBy,
            date: o.countersignedAt ? formatDate(o.countersignedAt) : "—",
          })
        : t("notCountersigned"),
    },
  ];
  return (
    <SectionCard
      title={t("title")}
      actions={
        o.can.accept ? (
          <Button size="sm" onClick={onRecord}>
            {t("record")}
          </Button>
        ) : null
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t("timeline")}
          </h3>
          <ol className="space-y-1.5 text-sm">
            {timeline.map((e) => (
              <li key={e.k} className="flex justify-between gap-2">
                <span>{e.label}</span>
                <span className="text-muted-foreground">{formatDate(e.at)}</span>
              </li>
            ))}
          </ol>
        </div>
        <dl className="space-y-1.5 text-sm">
          {facts.map((f) => (
            <div key={f.k}>
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {o.can.uploadSigned ? <SignedUpload o={o} /> : null}
    </SectionCard>
  );
}

function SignedUpload({ o }: { o: OfferDetail }) {
  const t = useTranslations("hiring.offerAcceptance");
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/hiring/offers/${o.id}/signed`, { method: "POST", body });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(e?.error ?? t("uploadFailed"));
      }
      toast.success(t("uploaded"));
      void qc.invalidateQueries({ queryKey: ["hiring"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
      {o.signedFileName ? (
        <a
          className="text-primary-emphasis hover:underline"
          href={`/api/hiring/offers/${o.id}/signed`}
          target="_blank"
          rel="noreferrer"
        >
          {t("openSigned", { name: o.signedFileName })}
        </a>
      ) : null}
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        className="sr-only"
        aria-label={t("uploadSigned")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        <Upload className="h-4 w-4" />
        {o.signedFileName ? t("replaceSigned") : t("uploadSigned")}
      </Button>
    </div>
  );
}

/** Record acceptance (Interview Hub `RecordAcceptanceModal`): joining date must be the offered start date. */
type HandoffReply = { ok: true } | { ok: false; reason: string };

export function AcceptDialog({ o, onClose }: { o: OfferDetail; onClose: () => void }) {
  const t = useTranslations("hiring.offerAcceptance");
  const offered = muscatDay(o.startDate);
  const [joining, setJoining] = useState(offered);
  const [notice, setNotice] = useState("");
  const [counter, setCounter] = useState("");
  const accept = useHiringMutation<object, { handoff: HandoffReply | null }>(
    "POST",
    `/api/hiring/offers/${o.id}/acceptance`,
    {
      success: t("recorded"),
      onSuccess: (r) => {
        if (r.handoff?.ok) toast.success(t("handedOff"));
        else if (r.handoff) toast.warning(t("handoffFailed", { reason: r.handoff.reason }));
        onClose();
      },
    },
  );
  const mismatch = joining !== offered;
  return (
    <Dialog open onOpenChange={(x) => !x && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialogTitle", { name: o.candidate.name })}</DialogTitle>
          <DialogDescription>{t("dialogHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field
            label={t("joiningDate")}
            htmlFor="ac-join"
            required
            hint={t("joiningHint")}
            error={mismatch ? t("joiningMismatch", { date: formatDate(o.startDate) }) : undefined}
          >
            <Input
              id="ac-join"
              type="date"
              value={joining}
              onChange={(e) => setJoining(e.target.value)}
            />
          </Field>
          <Field label={t("noticeLabel")} htmlFor="ac-notice" hint={t("noticeHint")}>
            <Input
              id="ac-notice"
              maxLength={500}
              value={notice}
              onChange={(e) => setNotice(e.target.value)}
            />
          </Field>
          <Field label={t("countersignedLabel")} htmlFor="ac-counter" hint={t("countersignedHint")}>
            <Input
              id="ac-counter"
              maxLength={200}
              value={counter}
              onChange={(e) => setCounter(e.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={accept.isPending || mismatch || !joining}
            onClick={() =>
              accept.mutate({
                joiningDate: joining,
                noticeDetail: notice.trim() || null,
                countersignedBy: counter.trim() || null,
              })
            }
          >
            {t("record")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
