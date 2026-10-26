"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { resolveBriefForRound, type RoundPlanEntry } from "@/lib/hiring/interview-rules";
import { qs, useHiringMutation, useHiringQuery } from "../ui/api";
import { Field } from "../ui/fields";
import { Notice, QueryState } from "../ui/states";
import { useRoundLabel } from "../interviews/bits";
import { whenLabel } from "../interviews/time";
import type { InterviewRow } from "../interviews/types";
import { EvaluationForm } from "./EvaluationForm";

type Detail = {
  id: string;
  round: string;
  roundOrdinal: number;
  scheduledDate: string;
  candidate: { id: string; name: string };
  requisition: { id: string; title: string };
  panelists: { userId: string; name: string; submitted: boolean }[];
};

/** `/hiring/evaluations/new` — HR records a scorecard on a panelist's behalf (e.g. from a paper form). */
export function EvaluationNew() {
  const t = useTranslations("hiring.evaluations");
  const router = useRouter();
  const locale = useLocale();
  const roundLabel = useRoundLabel();
  const params = useSearchParams();
  const [interviewId, setInterviewId] = useState(params.get("interviewId") ?? "");
  const [panelistId, setPanelistId] = useState("");
  const iv = useHiringQuery<Detail>(interviewId ? `/api/hiring/interviews/${interviewId}` : null);
  const req = useHiringQuery<{ competencies: string[] }>(
    iv.data ? `/api/hiring/requisitions/${iv.data.requisition.id}` : null,
  );
  const plan = useHiringQuery<{ plan: RoundPlanEntry[] }>(
    iv.data ? `/api/hiring/requisitions/${iv.data.requisition.id}/interviews` : null,
  );
  // The round's own competencies, as the panelist's brief showed them; else the requisition's.
  const own = iv.data
    ? resolveBriefForRound(plan.data?.plan ?? [], iv.data.round).competencies
    : [];
  const competencies = own.length ? own : (req.data?.competencies ?? []);
  const create = useHiringMutation<object, { id: string }>("POST", "/api/hiring/evaluations", {
    success: t("created"),
    onSuccess: (r) => router.push(`/${locale}/hiring/evaluations/${r.id}`),
  });
  const open = iv.data?.panelists.filter((p) => !p.submitted) ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title={t("newTitle")} subtitle={t("newSubtitle")} />
      <SectionCard title={t("whichInterview")}>
        {interviewId && iv.data ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <span className="font-semibold">{iv.data.candidate.name}</span>
              {` · ${roundLabel(iv.data.round, iv.data.roundOrdinal)} · ${iv.data.requisition.title} · ${whenLabel(iv.data.scheduledDate)}`}
            </span>
            <button
              type="button"
              className="text-primary underline"
              onClick={() => {
                setInterviewId("");
                setPanelistId("");
              }}
            >
              {t("change")}
            </button>
          </div>
        ) : (
          <InterviewChooser loading={iv.isLoading} error={iv.error} onPick={setInterviewId} />
        )}
        {iv.data ? (
          <Field
            label={t("panelist")}
            htmlFor="ev-panelist"
            required
            hint={t("panelistHint")}
            className="mt-4"
          >
            {open.length ? (
              <NativeSelect
                id="ev-panelist"
                value={panelistId}
                onChange={(e) => setPanelistId(e.target.value)}
              >
                <option value="">{t("choosePanelist")}</option>
                {open.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Notice tone="info">{t("allSubmitted")}</Notice>
            )}
          </Field>
        ) : null}
      </SectionCard>
      {iv.data && panelistId && req.data && plan.data ? (
        <EvaluationForm
          key={panelistId}
          competencies={competencies}
          initial={{
            scores: {},
            vote: null,
            strengths: "",
            concerns: "",
            notes: "",
            submitted: true,
          }}
          submitting={create.isPending}
          submitLabel={t("record")}
          onCancel={() => router.push(`/${locale}/hiring/evaluations`)}
          onSubmit={(v) => create.mutate({ ...v, interviewId, panelistId })}
        />
      ) : null}
    </div>
  );
}

function InterviewChooser({
  loading,
  error,
  onPick,
}: {
  loading: boolean;
  error: Error | null;
  onPick: (id: string) => void;
}) {
  const t = useTranslations("hiring.evaluations");
  const roundLabel = useRoundLabel();
  const [search, setSearch] = useState("");
  const list = useHiringQuery<{ data: InterviewRow[] }>(
    `/api/hiring/interviews${qs({ search, pageSize: 20 })}`,
  );
  const rows = list.data?.data ?? [];
  return (
    <QueryState
      isLoading={list.isLoading || loading}
      error={list.error ?? error}
      onRetry={() => void list.refetch()}
    >
      <div className="space-y-2">
        <Input
          aria-label={t("searchInterviews")}
          placeholder={t("searchInterviews")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-start text-sm hover:bg-muted"
                onClick={() => onPick(r.id)}
              >
                <span className="font-semibold">{r.candidate.name}</span>
                <span className="text-muted-foreground">{` · ${roundLabel(r.round, r.roundOrdinal)} · ${r.requisition.title} · ${whenLabel(r.scheduledDate)}`}</span>
              </button>
            </li>
          ))}
          {list.data && rows.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t("noInterviews")}</li>
          ) : null}
        </ul>
      </div>
    </QueryState>
  );
}
