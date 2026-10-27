"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { FileText, Handshake, Pencil, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { useCrumb } from "../ui/crumb";
import { FlowRail } from "../ui/flow-rail";
import { QueryState } from "../ui/states";
import { AcceptanceSection } from "./AcceptanceSection";
import { ApprovalPanel } from "./ApprovalPanel";
import { AlignmentDialog, Negotiation } from "./Negotiation";
import { OfferForm, toOfferBody, type OfferFormValues } from "./OfferForm";
import { PackageCard } from "./PackageCard";
import { ReviseDialog, Revisions } from "./Revisions";
import { OfferStatusBadge, muscatDay } from "./bits";
import { VacantStepsNotice, vacantRoles } from "../ui/vacant-steps";
import type { ApprovalViewData, OfferDetail, OfferStatus, VersionView } from "./types";

type Dialogs = "edit" | "revise" | "align" | "accept" | null;

/** `/hiring/offers/[id]` (Interview Hub offer detail): package, chain, revisions, negotiation, acceptance. */
export function OfferDetailView({ id }: { id: string }) {
  const q = useHiringQuery<OfferDetail>(`/api/hiring/offers/${id}`);
  const versions = useHiringQuery<{ versions: VersionView[] }>(`/api/hiring/offers/${id}/versions`);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const o = q.data;
  useCrumb(id, o?.candidate.name);
  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      {o ? (
        <div className="space-y-4">
          <Header o={o} onDialog={setDialog} />
          <FlowRail current={6} />
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <PackageCard o={o} />
              {o.status !== "DRAFTING" && o.status !== "APPROVED" ? (
                <Revisions
                  versions={versions.data?.versions ?? []}
                  canRevise={o.can.revise}
                  onRevise={() => setDialog("revise")}
                />
              ) : null}
              <Negotiation
                path={`/api/hiring/offers/${id}/negotiations`}
                canPost={o.can.postNotes}
              />
              <AcceptanceSection
                o={o}
                versions={versions.data?.versions ?? []}
                accepting={dialog === "accept"}
                onDialog={setDialog}
              />
              {o.can.transitions.length ? <MoveStatus o={o} /> : null}
            </div>
            <ApprovalPanel offerId={id} />
          </div>
          {dialog === "revise" ? <ReviseDialog o={o} onClose={() => setDialog(null)} /> : null}
          {dialog === "align" ? (
            <AlignmentDialog
              candidateId={o.candidate.id}
              candidateName={o.candidate.name}
              onClose={() => setDialog(null)}
            />
          ) : null}
          {dialog === "edit" ? <EditDialog o={o} onClose={() => setDialog(null)} /> : null}
        </div>
      ) : null}
    </QueryState>
  );
}

function Header({ o, onDialog }: { o: OfferDetail; onDialog: (d: Dialogs) => void }) {
  const t = useTranslations("hiring.offer");
  const router = useRouter();
  const locale = useLocale();
  const remove = useHiringMutation<undefined>("DELETE", `/api/hiring/offers/${o.id}`, {
    success: t("deleted"),
    onSuccess: () => router.push(`/${locale}/hiring/offers`),
  });
  const preOffer = ["DRAFTING", "PENDING_APPROVAL", "APPROVED"].includes(o.status);
  return (
    <PageHeader
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          {t("title", { name: o.candidate.name })}
          <OfferStatusBadge status={o.status} />
        </span>
      }
      subtitle={
        <>
          <Link
            className="hover:underline"
            href={`/${locale}/hiring/requisitions/${o.requisition.id}`}
          >
            {o.requisition.title}
          </Link>
          {" · "}
          <Link className="hover:underline" href={`/${locale}/hiring/candidates/${o.candidate.id}`}>
            {t("viewCandidate")}
          </Link>
        </>
      }
      actions={
        <>
          {o.can.letter ? (
            <a
              className={buttonVariants({ variant: "outline" })}
              href={`/api/hiring/offers/${o.id}/letter`}
              target="_blank"
              rel="noreferrer"
            >
              <FileText className="h-4 w-4" />
              {t("previewLetter")}
            </a>
          ) : null}
          {o.can.postNotes && preOffer ? (
            <Button variant="outline" onClick={() => onDialog("align")}>
              <Handshake className="h-4 w-4" />
              {t("recordAlignment")}
            </Button>
          ) : null}
          {o.can.revise ? (
            <Button variant="outline" onClick={() => onDialog("revise")}>
              <Send className="h-4 w-4" />
              {t("sendRevised")}
            </Button>
          ) : null}
          {o.can.edit ? (
            <Button variant="outline" onClick={() => onDialog("edit")}>
              <Pencil className="h-4 w-4" />
              {t("edit")}
            </Button>
          ) : null}
          {o.can.delete ? (
            <ConfirmAction
              title={t("deleteConfirm")}
              description={t("deleteHint")}
              onConfirm={() => remove.mutate(undefined)}
            >
              <Button variant="ghost" size="icon" aria-label={t("delete")}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </ConfirmAction>
          ) : null}
        </>
      }
    />
  );
}

function MoveStatus({ o }: { o: OfferDetail }) {
  const t = useTranslations("hiring.offer");
  const ts = useTranslations("hiring.offerStatus");
  const move = useHiringMutation<{ status: OfferStatus }>("PUT", `/api/hiring/offers/${o.id}`, {
    success: t("moved"),
  });
  // Same query (and cache entry) as the approval panel beside it: a step nobody
  // can decide blocks submission here, and the server refuses it too.
  const approvals = useHiringQuery<ApprovalViewData>(`/api/hiring/offers/${o.id}/approvals`);
  const vacant =
    o.can.transitions.includes("PENDING_APPROVAL") && approvals.data
      ? vacantRoles(approvals.data.chain)
      : [];
  return (
    <SectionCard title={t("moveTitle")} subtitle={t(`moveHint.${o.status}`)}>
      {vacant.length ? (
        <div className="mb-3">
          <VacantStepsNotice roles={vacant} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {o.can.transitions.map((s) => (
          <ConfirmAction
            key={s}
            title={t("moveConfirm", { status: ts(s).toLowerCase() })}
            description={t(`moveEffect.${s}`)}
            onConfirm={() => move.mutate({ status: s })}
          >
            <Button
              variant={s === "PENDING_APPROVAL" || s === "SENT" ? "default" : "outline"}
              disabled={
                move.isPending ||
                (s === "PENDING_APPROVAL" && (vacant.length > 0 || approvals.isLoading))
              }
            >
              {t(`moveTo.${s}`)}
            </Button>
          </ConfirmAction>
        ))}
      </div>
    </SectionCard>
  );
}

function EditDialog({ o, onClose }: { o: OfferDetail; onClose: () => void }) {
  const t = useTranslations("hiring.offer");
  const save = useHiringMutation<object>("PUT", `/api/hiring/offers/${o.id}`, {
    success: t("updated"),
    onSuccess: onClose,
  });
  const initial: OfferFormValues = {
    candidate: {
      id: o.candidate.id,
      name: o.candidate.name,
      stage: o.candidate.stage,
      requisition: { id: o.requisition.id, title: o.requisition.title },
    },
    salary: o.salary == null ? "" : String(o.salary),
    allowances: Object.entries(o.allowances ?? {}).map(([key, amount]) => ({
      key,
      amount: String(amount),
    })),
    startDate: muscatDay(o.startDate),
    probationMonths: String(o.probationMonths),
    noticePeriod: o.noticePeriod ?? "",
    contractType: o.contractType ?? "Permanent",
    benefits: o.benefits ?? "",
  };
  return (
    <Dialog open onOpenChange={(x) => !x && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("editTitle")}</DialogTitle>
        </DialogHeader>
        <OfferForm
          lockCandidate
          initial={initial}
          showPay={!o.compHidden}
          submitting={save.isPending}
          submitLabel={t("save")}
          onCancel={onClose}
          onSubmit={(v) => save.mutate(toOfferBody(v, !o.compHidden))}
        />
      </DialogContent>
    </Dialog>
  );
}
