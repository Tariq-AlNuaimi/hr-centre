"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { SectionCard } from "@/components/shared/SectionCard";
import { CANONICAL_ROUND_ORDER } from "@/lib/hiring/interview-rules";
import { INTERVIEW_STATUSES } from "@/lib/validations/hiring/interview";
import { qs, useHiringQuery } from "../ui/api";
import { Field, Textarea } from "../ui/fields";
import { PersonPicker, type Person } from "../ui/person-picker";

/**
 * Schedule / edit an interview (Interview Hub `InterviewForm`). The requisition
 * is the candidate's own; panelists are picked from people with hiring access
 * to that requisition's company.
 */
export type CandidateRef = {
  id: string;
  name: string;
  requisition: { id: string; title: string } | null;
};

export type InterviewFormValues = {
  candidate: CandidateRef | null;
  round: string;
  when: string;
  status: string;
  panel: Person[];
  location: string;
  meetingLink: string;
  notes: string;
};

/** "2026-10-27T10:00" (local) for an ISO instant, and back. */
export const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function CandidatePicker({
  value,
  onChange,
  requisitionId,
}: {
  value: CandidateRef | null;
  onChange: (c: CandidateRef | null) => void;
  requisitionId?: string;
}) {
  const t = useTranslations("hiring.interviewForm");
  const [search, setSearch] = useState("");
  const { data, isLoading } = useHiringQuery<{ data: CandidateRef[] }>(
    value ? null : `/api/hiring/candidates${qs({ search, pageSize: 10, requisitionId })}`,
  );
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-input px-3 py-1.5 text-sm">
        <span>
          {value.name}
          <span className="text-muted-foreground">
            {" "}
            · {value.requisition?.title ?? t("noRequisition")}
          </span>
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          {t("change")}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Input
        id="if-cand"
        placeholder={t("searchCandidates")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ul className="max-h-48 overflow-y-auto rounded-md border border-border">
        {isLoading ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">{t("loading")}</li>
        ) : null}
        {(data?.data ?? []).map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="w-full px-3 py-2 text-start text-sm hover:bg-muted"
              onClick={() => onChange(c)}
            >
              {c.name}
              <span className="text-muted-foreground">
                {" "}
                · {c.requisition?.title ?? t("noRequisition")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PanelPicker({
  entityId,
  value,
  onChange,
}: {
  entityId: string | null;
  value: Person[];
  onChange: (p: Person[]) => void;
}) {
  const t = useTranslations("hiring.interviewForm");
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-1.5">
        {value.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-1 rounded-full bg-muted py-0.5 ps-3 pe-1 text-sm"
          >
            {p.name}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label={t("removePanelist", { name: p.name })}
              onClick={() => onChange(value.filter((x) => x.id !== p.id))}
            >
              <X className="h-3 w-3" />
            </Button>
          </li>
        ))}
      </ul>
      <PersonPicker
        id="if-panel"
        value={null}
        permission="hiring.view"
        entityId={entityId}
        placeholder={t("addPanelist")}
        onChange={(p) => p && !value.some((x) => x.id === p.id) && onChange([...value, p])}
      />
    </div>
  );
}

export function InterviewForm({
  initial,
  lockCandidate,
  requisitionId,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: InterviewFormValues;
  lockCandidate?: boolean;
  requisitionId?: string;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (v: InterviewFormValues) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("hiring.interviewForm");
  const tr = useTranslations("hiring.round");
  const ts = useTranslations("hiring.interviewStatus");
  const [v, setV] = useState(initial);
  const reqId = v.candidate?.requisition?.id;
  const req = useHiringQuery<{ entityId: string }>(
    reqId ? `/api/hiring/requisitions/${reqId}` : null,
  );
  const valid = Boolean(v.candidate?.requisition && v.round && v.when && v.panel.length > 0);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(v);
      }}
    >
      <SectionCard title={t("sectionScheduling")} subtitle={t("sectionSchedulingHint")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={t("candidate")}
            htmlFor="if-cand"
            required
            className="md:col-span-2"
            error={v.candidate && !v.candidate.requisition ? t("needsRequisition") : undefined}
          >
            {lockCandidate && v.candidate ? (
              <p className="text-sm">
                {v.candidate.name} · {v.candidate.requisition?.title}
              </p>
            ) : (
              <CandidatePicker
                requisitionId={requisitionId}
                value={v.candidate}
                onChange={(c) => setV({ ...v, candidate: c, panel: [] })}
              />
            )}
          </Field>
          <Field label={t("round")} htmlFor="if-round" required>
            <NativeSelect
              id="if-round"
              value={v.round}
              onChange={(e) => setV({ ...v, round: e.target.value })}
            >
              {CANONICAL_ROUND_ORDER.map((r) => (
                <option key={r} value={r}>
                  {tr(r)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("when")} htmlFor="if-when" required>
            <Input
              id="if-when"
              type="datetime-local"
              value={v.when}
              onChange={(e) => setV({ ...v, when: e.target.value })}
            />
          </Field>
          <Field label={t("status")} htmlFor="if-status" required>
            <NativeSelect
              id="if-status"
              value={v.status}
              onChange={(e) => setV({ ...v, status: e.target.value })}
            >
              {INTERVIEW_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ts(s)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label={t("panel")}
            htmlFor="if-panel"
            hint={t("panelHint")}
            required
            className="md:col-span-2"
          >
            {reqId ? (
              <PanelPicker
                entityId={req.data?.entityId ?? null}
                value={v.panel}
                onChange={(panel) => setV({ ...v, panel })}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("pickCandidateFirst")}</p>
            )}
          </Field>
        </div>
      </SectionCard>
      <SectionCard title={t("sectionDetails")} subtitle={t("sectionDetailsHint")}>
        <div className="grid gap-4">
          <Field label={t("location")} htmlFor="if-loc">
            <Input
              id="if-loc"
              maxLength={255}
              value={v.location}
              onChange={(e) => setV({ ...v, location: e.target.value })}
            />
          </Field>
          <Field label={t("meetingLink")} htmlFor="if-link">
            <Input
              id="if-link"
              type="url"
              placeholder={t("meetingLinkPlaceholder")}
              value={v.meetingLink}
              onChange={(e) => setV({ ...v, meetingLink: e.target.value })}
            />
          </Field>
          <Field label={t("notes")} htmlFor="if-notes" hint={t("notesHint")}>
            <Textarea
              id="if-notes"
              maxLength={5000}
              value={v.notes}
              onChange={(e) => setV({ ...v, notes: e.target.value })}
            />
          </Field>
        </div>
      </SectionCard>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={submitting || !valid}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
