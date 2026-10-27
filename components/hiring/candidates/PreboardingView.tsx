"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, CheckCircle2, Circle, RefreshCw, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/org/NativeSelect";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDate } from "@/lib/format";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { useCrumb } from "../ui/crumb";
import { Field, Textarea } from "../ui/fields";
import { FlowRail } from "../ui/flow-rail";
import { Notice, QueryState } from "../ui/states";

type Person = { id: string; name: string };
type View = {
  candidate: { id: string; name: string; stage: string };
  route: "TRANSFERRED" | "RETAINED" | "UNASSIGNED";
  owner: Person | null;
  checklist: { key: string; cleared: boolean }[];
  joiningDate: string | null;
  joiner: {
    employee: { id: string; name: string; status: string } | null;
    caseId: string | null;
    caseStatus: string | null;
  };
  handover: {
    kind: string;
    from: Person | null;
    to: Person | null;
    note: string | null;
    completedAt: string;
  } | null;
  recipients: Person[];
  can: { record: boolean; retryHandoff: boolean };
};

/**
 * Pre-boarding and handover (Interview Hub steps 14–15). The joiner is handed
 * to JML at acceptance (pre-joiner record + onboarding draft); this screen
 * shows that, the pre-boarding checklist, and records who carries the hire
 * into onboarding.
 */
export function PreboardingView({ id }: { id: string }) {
  const t = useTranslations("hiring.preboarding");
  const q = useHiringQuery<View>(`/api/hiring/candidates/${id}/preboarding`);
  useCrumb(id, q.data?.candidate.name);
  const v = q.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        subtitle={v ? t("subtitle", { name: v.candidate.name }) : undefined}
      />
      <FlowRail current={7} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {v ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="space-y-4">
              <RouteCard v={v} />
              <Checklist v={v} />
              {v.handover ? (
                <Recorded h={v.handover} />
              ) : v.can.record ? (
                <RecordForm v={v} />
              ) : null}
            </div>
            <JoinerCard v={v} candidateId={id} />
          </div>
        ) : null}
      </QueryState>
    </div>
  );
}

function RouteCard({ v }: { v: View }) {
  const t = useTranslations("hiring.preboarding");
  const tone = v.route === "UNASSIGNED" ? "warning" : "info";
  return (
    <Notice tone={tone} title={t(`route.${v.route}`)}>
      {t(`routeHint.${v.route}`, { owner: v.owner?.name ?? "—" })}
    </Notice>
  );
}

function Checklist({ v }: { v: View }) {
  const t = useTranslations("hiring.preboarding");
  return (
    <SectionCard title={t("checklistTitle")} subtitle={t("checklistHint")}>
      <ul className="space-y-2 text-sm">
        {v.checklist.map((c) => (
          <li key={c.key} className="flex items-center gap-2">
            {c.cleared ? (
              <CheckCircle2 aria-hidden className="h-4 w-4 text-status-ok-fg" />
            ) : (
              <Circle aria-hidden className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="flex-1">{t(`item.${c.key}`)}</span>
            <Badge variant={c.cleared ? "success" : "outline"}>
              {c.cleared ? t("cleared") : t("outstanding")}
            </Badge>
          </li>
        ))}
      </ul>
      {v.joiningDate ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("joining", { date: formatDate(v.joiningDate) })}
        </p>
      ) : null}
    </SectionCard>
  );
}

function RecordForm({ v }: { v: View }) {
  const t = useTranslations("hiring.preboarding");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const record = useHiringMutation<object>(
    "POST",
    `/api/hiring/candidates/${v.candidate.id}/preboarding`,
    { success: t("recorded") },
  );
  const transfer = v.route === "TRANSFERRED";
  const ready = v.checklist.every((c) => c.cleared);
  return (
    <SectionCard
      title={t("recordTitle")}
      subtitle={
        transfer ? t("recordHintTransfer") : t("recordHintRetain", { owner: v.owner?.name ?? "—" })
      }
    >
      <div className="space-y-4">
        {!ready ? <Notice tone="warning">{t("clearFirst")}</Notice> : null}
        {transfer ? (
          <Field label={t("recipient")} htmlFor="pb-to" required>
            <NativeSelect id="pb-to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">{t("chooseRecipient")}</option>
              {v.recipients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        <Field label={t("note")} htmlFor="pb-note" required={transfer} hint={t("noteHint")}>
          <Textarea
            id="pb-note"
            maxLength={4000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <Button
          disabled={!ready || record.isPending || (transfer && (!to || !note.trim()))}
          onClick={() => record.mutate({ action: "record", toUserId: transfer ? to : null, note })}
        >
          <ArrowRight className="h-4 w-4" />
          {t("record")}
        </Button>
      </div>
    </SectionCard>
  );
}

function Recorded({ h }: { h: NonNullable<View["handover"]> }) {
  const t = useTranslations("hiring.preboarding");
  return (
    <SectionCard title={t("recordedTitle")}>
      <p className="text-sm">
        {t(h.kind === "TRANSFERRED" ? "recordedTransfer" : "recordedRetain", {
          from: h.from?.name ?? "—",
          to: h.to?.name ?? "—",
          date: formatDate(h.completedAt),
        })}
      </p>
      {h.note ? (
        <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{h.note}</p>
      ) : null}
    </SectionCard>
  );
}

function JoinerCard({ v, candidateId }: { v: View; candidateId: string }) {
  const t = useTranslations("hiring.preboarding");
  const tp = useTranslations("pms.statusValue");
  const locale = useLocale();
  const retry = useHiringMutation<object>(
    "POST",
    `/api/hiring/candidates/${candidateId}/preboarding`,
    { success: t("handedOff") },
  );
  const j = v.joiner;
  return (
    <SectionCard title={t("joinerTitle")} subtitle={t("joinerHint")}>
      <div className="space-y-3 text-sm">
        {j.employee ? (
          <p>
            <Link
              href={`/${locale}/people/${j.employee.id}`}
              className="font-medium text-primary-emphasis hover:underline"
            >
              {j.employee.name}
            </Link>{" "}
            <Badge variant="info">{tp(j.employee.status)}</Badge>
          </p>
        ) : (
          <p className="text-muted-foreground">{t("noEmployee")}</p>
        )}
        {j.caseId ? (
          <p>
            <Link
              href={`/${locale}/jml/joiners/${j.caseId}`}
              className="font-medium text-primary-emphasis hover:underline"
            >
              {t("openCase")}
            </Link>{" "}
            {j.caseStatus ? (
              <Badge variant="outline">{t(`caseStatus.${j.caseStatus}`)}</Badge>
            ) : null}
          </p>
        ) : (
          <p className="text-muted-foreground">{t("noCase")}</p>
        )}
        {v.can.retryHandoff ? (
          <Button
            variant="outline"
            size="sm"
            disabled={retry.isPending}
            onClick={() => retry.mutate({ action: "handoff" })}
          >
            {j.employee ? <RefreshCw className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {t("handoff")}
          </Button>
        ) : null}
      </div>
    </SectionCard>
  );
}
