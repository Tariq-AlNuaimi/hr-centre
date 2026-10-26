"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { FlowRail } from "../ui/flow-rail";
import { InterviewForm, type CandidateRef, type InterviewFormValues } from "./InterviewForm";

export function toInterviewBody(v: InterviewFormValues) {
  return {
    round: v.round,
    scheduledDate: new Date(v.when).toISOString(),
    status: v.status,
    location: v.location,
    meetingLink: v.meetingLink,
    notes: v.notes,
    panelistIds: v.panel.map((p) => p.id),
  };
}

/** `/hiring/interviews/new` — `?candidateId=` preselects the candidate (from their profile). */
export function NewInterview() {
  const t = useTranslations("hiring.interviewForm");
  const router = useRouter();
  const locale = useLocale();
  const search = useSearchParams();
  const candidateId = search.get("candidateId");
  const requisitionId = search.get("requisitionId") ?? undefined;
  const pre = useHiringQuery<CandidateRef>(
    candidateId ? `/api/hiring/candidates/${candidateId}` : null,
  );
  const create = useHiringMutation<object, { id: string }>("POST", "/api/hiring/interviews", {
    success: t("created"),
    onSuccess: (r) => router.push(`/${locale}/hiring/interviews/${r.id}`),
  });
  if (candidateId && pre.isLoading) return <FormSkeleton fields={8} />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={t("createTitle")} subtitle={t("createSubtitle")} />
      <FlowRail current={3} />
      <InterviewForm
        requisitionId={requisitionId}
        initial={{
          candidate: pre.data
            ? { id: pre.data.id, name: pre.data.name, requisition: pre.data.requisition }
            : null,
          round: "SCREENING",
          when: "",
          status: "SCHEDULED",
          panel: [],
          location: "",
          meetingLink: "",
          notes: "",
        }}
        submitting={create.isPending}
        submitLabel={t("create")}
        onSubmit={(v) => create.mutate({ candidateId: v.candidate!.id, ...toInterviewBody(v) })}
        onCancel={() => router.push(`/${locale}/hiring/interviews`)}
      />
    </div>
  );
}
