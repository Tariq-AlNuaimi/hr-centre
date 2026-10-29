"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarPlus, Check, ExternalLink, Pencil, Trash2, Video } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { SectionCard } from "@/components/shared/SectionCard";
import { AiInsightCard } from "../ai/AiInsightCard";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { useCrumb } from "../ui/crumb";
import { FlowRail } from "../ui/flow-rail";
import { Textarea } from "@/components/shared/FormControls";
import { PersonPicker } from "../ui/person-picker";
import { Notice, QueryState } from "../ui/states";
import { Tabs } from "@/components/shared/UrlTabs";
import { initials, useRoundLabel } from "./bits";
import { whenLabel } from "./time";
import { EditDialog } from "./EditInterviewDialog";
import type { InterviewDetailData as Detail } from "./types";

/** `/hiring/interviews/[id]` (Interview Hub `/interviews/[id]`). */
export function InterviewDetail({ id }: { id: string }) {
  const t = useTranslations("hiring.interview");
  const ts = useTranslations("hiring.interviewStatus");
  const locale = useLocale();
  const roundLabel = useRoundLabel();
  const {
    data: d,
    isLoading,
    error,
    refetch,
  } = useHiringQuery<Detail>(`/api/hiring/interviews/${id}`);
  const [editing, setEditing] = useState(false);
  useCrumb(id, d?.candidate.name);
  const base = `/${locale}/hiring`;
  return (
    <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()}>
      {d ? (
        <div className="space-y-4">
          <div className="space-y-4 rounded-md border border-border bg-card p-5">
            <div className="flex flex-wrap items-center gap-4">
              <span className="grid h-12 w-12 place-items-center rounded-lg bg-accent-subtle text-primary-emphasis">
                <Video aria-hidden className="h-5 w-5" />
              </span>
              <div className="min-w-60 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-h3 font-semibold">{d.candidate.name}</h1>
                  <Badge variant="outline">{roundLabel(d.round, d.roundOrdinal)}</Badge>
                  <Badge variant="info">{ts(d.status)}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[d.requisition.title, whenLabel(d.scheduledDate), d.location]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  className={buttonVariants({ variant: "outline" })}
                  href={`/api/hiring/interviews/${id}/ics`}
                >
                  <CalendarPlus className="h-4 w-4" />
                  {t("downloadIcs")}
                </a>
                {d.meetingLink ? (
                  <a
                    className={buttonVariants({ variant: "outline" })}
                    href={d.meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {t("join")}
                  </a>
                ) : null}
                {d.can.score ? (
                  <Link
                    className={buttonVariants({ variant: d.can.manage ? "outline" : "default" })}
                    href={`${base}/panel/${id}/brief`}
                  >
                    {t("myBrief")}
                  </Link>
                ) : null}
                {d.can.manage ? (
                  <Button onClick={() => setEditing(true)}>
                    <Pencil className="h-4 w-4" />
                    {t("edit")}
                  </Button>
                ) : null}
              </div>
            </div>
            <FlowRail current={3} />
          </div>
          <Tabs
            tabs={[
              { key: "transcript", label: t("tabTranscript"), content: <TranscriptTab d={d} /> },
              { key: "details", label: t("tabDetails"), content: <DetailsTab d={d} /> },
            ]}
          />
          {d.can.manage ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Link
                className={buttonVariants({ variant: "outline" })}
                href={`${base}/candidates/${d.candidate.id}`}
              >
                {t("decide")}
              </Link>
              <Link className={buttonVariants()} href={`${base}/evaluations/new?interviewId=${id}`}>
                {t("recordScorecard")}
              </Link>
            </div>
          ) : null}
          {d.can.manage ? <EditDialog d={d} open={editing} onOpenChange={setEditing} /> : null}
        </div>
      ) : null}
    </QueryState>
  );
}

function TranscriptTab({ d }: { d: Detail }) {
  const t = useTranslations("hiring.interview");
  const [text, setText] = useState(d.transcript ?? "");
  const save = useHiringMutation<{ transcript: string }>("PUT", `/api/hiring/interviews/${d.id}`, {
    success: t("transcriptSaved"),
  });
  return (
    <div className="space-y-4">
      <SectionCard title={t("transcriptTitle")}>
        {d.can.manage ? (
          <div className="space-y-3">
            <Textarea
              aria-label={t("transcriptTitle")}
              className="min-h-60"
              placeholder={t("transcriptPlaceholder")}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={save.isPending}
              onClick={() => save.mutate({ transcript: text })}
            >
              {t("saveTranscript")}
            </Button>
          </div>
        ) : d.transcript ? (
          <p className="text-sm whitespace-pre-wrap">{d.transcript}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noTranscript")}</p>
        )}
      </SectionCard>
      {d.judgmentsHidden ? (
        <Notice tone="info">{t("judgmentsHidden")}</Notice>
      ) : (
        <AiInsightCard
          kind="transcript"
          entityId={d.id}
          canRun={d.can.manage}
          transcript={text.trim() ? text : undefined}
        />
      )}
    </div>
  );
}

function DetailsTab({ d }: { d: Detail }) {
  const t = useTranslations("hiring.interview");
  const roundLabel = useRoundLabel();
  const ts = useTranslations("hiring.interviewStatus");
  const add = useHiringMutation<{ userId: string }>(
    "POST",
    `/api/hiring/interviews/${d.id}/panelists`,
    { success: t("panelUpdated") },
  );
  const remove = useHiringMutation<{ userId: string }>(
    "DELETE",
    (b) => `/api/hiring/interviews/${d.id}/panelists?userId=${encodeURIComponent(b.userId)}`,
    { success: t("panelUpdated") },
  );
  const confirm = useHiringMutation<{ confirmed: boolean }>(
    "POST",
    `/api/hiring/interviews/${d.id}/confirm`,
    { success: t("confirmed") },
  );
  const entity = useHiringQuery<{ entityId: string }>(
    d.can.manage ? `/api/hiring/requisitions/${d.requisition.id}` : null,
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title={t("detailsTitle")}>
        <DescriptionList
          columns={1}
          items={[
            { key: "c", label: t("candidate"), value: d.candidate.name },
            { key: "r", label: t("requisition"), value: d.requisition.title },
            { key: "round", label: t("round"), value: roundLabel(d.round, d.roundOrdinal) },
            { key: "s", label: t("status"), value: ts(d.status) },
            { key: "w", label: t("when"), value: whenLabel(d.scheduledDate) },
            { key: "l", label: t("location"), value: d.location ?? "—" },
            {
              key: "m",
              label: t("meetingLink"),
              value: d.meetingLink ? (
                <a
                  href={d.meetingLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-primary-emphasis hover:underline"
                >
                  {d.meetingLink}
                </a>
              ) : (
                "—"
              ),
            },
            {
              key: "n",
              label: t("notes"),
              value: d.judgmentsHidden ? (
                t("hiddenUntilSubmit")
              ) : (
                <span className="whitespace-pre-wrap">{d.notes ?? "—"}</span>
              ),
            },
          ]}
        />
      </SectionCard>
      <SectionCard title={t("panelTitle")}>
        {d.panelists.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noPanel")}</p>
        ) : null}
        <ul className="space-y-3">
          {d.panelists.map((p, i) => (
            <li key={p.userId} className="flex items-center gap-3">
              <Avatar className="h-8 w-8" aria-hidden>
                <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                  {initials(p.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{p.name}</p>
                {p.email ? <p className="text-xs text-muted-foreground">{p.email}</p> : null}
              </div>
              {i === 0 ? <Badge variant="brand">{t("lead")}</Badge> : null}
              <Badge variant={p.confirmedAt ? "success" : "default"}>
                {p.confirmedAt ? t("attending") : t("notConfirmed")}
              </Badge>
              <Badge variant={p.submitted ? "success" : "outline"}>
                {p.submitted ? t("submitted") : t("pending")}
              </Badge>
              {d.can.manage ? (
                <ConfirmAction
                  title={t("removeTitle")}
                  okText={t("remove")}
                  okType="danger"
                  onConfirm={() => remove.mutate({ userId: p.userId })}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={t("removeNamed", { name: p.name })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </ConfirmAction>
              ) : null}
            </li>
          ))}
        </ul>
        {d.can.manage ? (
          <div className="mt-4">
            <PersonPicker
              id="add-panelist"
              value={null}
              permission="hiring.view"
              entityId={entity.data?.entityId ?? null}
              placeholder={t("addPanelist")}
              onChange={(p) => p && add.mutate({ userId: p.id })}
            />
          </div>
        ) : null}
        {d.can.score && !d.myConfirmedAt ? (
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => confirm.mutate({ confirmed: true })}
          >
            <Check className="h-4 w-4" />
            {t("confirmAttendance")}
          </Button>
        ) : null}
      </SectionCard>
    </div>
  );
}
