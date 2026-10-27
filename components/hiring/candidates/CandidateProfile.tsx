"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { CalendarPlus, ExternalLink, FileSignature, Mail, Pencil, Star } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDateTime } from "@/lib/format";
import type { Stage } from "@/lib/hiring/stage-rules";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { NationalityDot, ScoreChip, StageBadge } from "../ui/stage";
import { useCrumb } from "../ui/crumb";
import { QueryState } from "../ui/states";
import { Tabs } from "../ui/tabs";
import { isOmani } from "@/lib/hiring/candidate-rules";
import { CandidateForm, EMPTY_CANDIDATE, toBody } from "./CandidateForm";
import { CvCard } from "./CvCard";
import { DataRequestCard } from "./DataRequestCard";
import { PackageTab } from "./PackageTab";
import { ProfileTab } from "./ProfileTab";
import { StageRail } from "./StageRail";
import { TimelineTab } from "./TimelineTab";
import type { CandidateDetail } from "./types";

/** From the decision onwards the package (step 9) is part of the record. */
const PACKAGE_STAGES = [
  "DECISION_PENDING",
  "OFFER_DRAFTED",
  "OFFER_EXTENDED",
  "OFFER_ACCEPTED",
  "PRE_ONBOARDING",
  "HIRED",
];

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** `/hiring/candidates/[id]` (Interview Hub `CandidateDetailClient`). */
export function CandidateProfile({ id }: { id: string }) {
  const t = useTranslations("hiring.candidate");
  const {
    data: c,
    isLoading,
    error,
    refetch,
  } = useHiringQuery<CandidateDetail>(`/api/hiring/candidates/${id}`);
  const [editing, setEditing] = useState(false);
  useCrumb(id, c?.name);
  return (
    <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()}>
      {c ? (
        <div className="space-y-4">
          <Header c={c} onEdit={() => setEditing(true)} />
          <StageRail candidateId={c.id} stage={c.stage as Stage} canEdit={c.can.manage} />
          <Tabs
            tabs={[
              { key: "profile", label: t("tabProfile"), content: <ProfileTab c={c} /> },
              {
                key: "interviews",
                label: t("tabInterviews", { count: c.interviews.length }),
                content: <InterviewsTab c={c} />,
              },
              { key: "documents", label: t("tabDocuments"), content: <CvCard c={c} /> },
              {
                key: "package",
                label: t("tabPackage"),
                hidden: !c.can.manage || !PACKAGE_STAGES.includes(c.stage),
                content: <PackageTab candidateId={c.id} />,
              },
              {
                key: "timeline",
                label: t("tabTimeline"),
                content: (
                  <div className="space-y-4">
                    <TimelineTab c={c} />
                    <DataRequestCard candidateId={c.id} hired={c.stage === "HIRED"} />
                  </div>
                ),
              },
            ]}
          />
          <EditDialog c={c} open={editing} onOpenChange={setEditing} />
        </div>
      ) : null}
    </QueryState>
  );
}

function Header({ c, onEdit }: { c: CandidateDetail; onEdit: () => void }) {
  const t = useTranslations("hiring.candidate");
  const contact = c.contact;
  const next = c.interviews.find((i) => i.status === "SCHEDULED" || i.status === "IN_PROGRESS");
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-card p-5">
      <Avatar className="h-14 w-14" aria-hidden>
        <AvatarFallback className="bg-primary text-lg font-bold text-primary-foreground">
          {initials(c.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-60 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-h3 font-semibold text-foreground">{c.name}</h1>
          <ScoreChip value={contact?.overallScore} />
          {c.preferred ? (
            <Badge
              variant="warning"
              title={
                c.preferred.note
                  ? t("preferredNote", { note: c.preferred.note })
                  : t("preferredHint")
              }
            >
              <Star aria-hidden className="h-3 w-3" />
              {t("preferred")}
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          {c.requisition ? <span className="font-medium">{c.requisition.title}</span> : null}
          {contact?.nationality ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <NationalityDot omani={isOmani(contact.nationality)} />
              {contact.nationality}
            </span>
          ) : null}
          {contact?.currentEmployer ? (
            <span className="text-muted-foreground">
              {t("fromEmployer", { employer: contact.currentEmployer })}
            </span>
          ) : null}
          <StageBadge stage={c.stage} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {contact?.email ? (
          <a className={buttonVariants({ variant: "outline" })} href={`mailto:${contact.email}`}>
            <Mail className="h-4 w-4" />
            {t("email")}
          </a>
        ) : null}
        {contact?.linkedinUrl ? (
          <a
            className={buttonVariants({ variant: "outline" })}
            href={contact.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-4 w-4" />
            {t("linkedin")}
          </a>
        ) : null}
        {c.can.manage ? (
          <Button variant="outline" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            {t("edit")}
          </Button>
        ) : null}
        <OfferLink c={c} />
        {next ? (
          <Badge variant="info">
            {t("interviewScheduled", { date: formatDateTime(next.scheduledDate) })}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

/** The offer, or drafting one once the decision is made (Interview Hub "Draft offer" next step). */
function OfferLink({ c }: { c: CandidateDetail }) {
  const t = useTranslations("hiring.candidate");
  const locale = useLocale();
  if (c.offer) {
    return (
      <Link
        className={buttonVariants({ variant: "outline" })}
        href={`/${locale}/hiring/offers/${c.offer.id}`}
      >
        <FileSignature className="h-4 w-4" />
        {t("viewOffer")}
      </Link>
    );
  }
  if (!c.can.manage || !["DECISION_PENDING", "OFFER_DRAFTED"].includes(c.stage)) return null;
  return (
    <Link className={buttonVariants()} href={`/${locale}/hiring/offers/new?candidateId=${c.id}`}>
      <FileSignature className="h-4 w-4" />
      {t("draftOffer")}
    </Link>
  );
}

function InterviewsTab({ c }: { c: CandidateDetail }) {
  const t = useTranslations("hiring.candidate");
  const tr = useTranslations("hiring.round");
  const locale = useLocale();
  return (
    <SectionCard
      title={t("interviewsTitle")}
      subtitle={t("interviewsHint")}
      actions={
        c.can.manage && c.requisition ? (
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href={`/${locale}/hiring/interviews/new?candidateId=${c.id}`}
          >
            <CalendarPlus className="h-4 w-4" />
            {t("scheduleInterview")}
          </Link>
        ) : null
      }
    >
      {c.interviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noInterviews")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {c.interviews.map((iv) => (
            <li key={iv.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <Link
                  className="font-medium hover:underline"
                  href={`/${locale}/hiring/interviews/${iv.id}`}
                >
                  {tr(iv.round)}
                </Link>
                <p className="text-xs text-muted-foreground">{formatDateTime(iv.scheduledDate)}</p>
              </div>
              <Badge
                variant={
                  iv.status === "COMPLETED"
                    ? "success"
                    : iv.status === "CANCELLED"
                      ? "outline"
                      : "info"
                }
              >
                {t(`interviewStatus.${iv.status}`)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function EditDialog({
  c,
  open,
  onOpenChange,
}: {
  c: CandidateDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("hiring.candidate");
  const tf = useTranslations("hiring.candidateForm");
  const show = { comp: c.can.viewComp, dei: c.can.viewDei, pii: c.can.viewPii };
  const save = useHiringMutation<object>("PUT", `/api/hiring/candidates/${c.id}`, {
    success: t("updated"),
    onSuccess: () => onOpenChange(false),
  });
  const contact = c.contact;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("editTitle", { name: c.name })}</DialogTitle>
        </DialogHeader>
        {open ? (
          <CandidateForm
            initial={{
              ...EMPTY_CANDIDATE,
              requisitionId: c.requisition?.id ?? "",
              name: c.name,
              email: contact?.email ?? "",
              phone: contact?.phone ?? "",
              nationality: contact?.nationality ?? "",
              currentEmployer: contact?.currentEmployer ?? "",
              linkedinUrl: contact?.linkedinUrl ?? "",
              nec: contact?.nec ?? "",
              gender: c.dei?.gender ?? "",
              source: c.source,
              sourceAttribution: c.sourceAttribution ?? "",
              referredBy: c.referredBy,
              salaryExpectation: c.salaryExpectation?.toString() ?? "",
            }}
            show={show}
            submitting={save.isPending}
            submitLabel={tf("save")}
            onSubmit={(v) =>
              save.mutate(
                contact
                  ? toBody(v, show)
                  : { name: v.name, source: v.source, requisitionId: v.requisitionId || null },
              )
            }
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
