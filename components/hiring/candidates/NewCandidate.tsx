"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { useHiringMe, useHiringMutation } from "../ui/api";
import { FlowRail } from "../ui/flow-rail";
import { CandidateForm, EMPTY_CANDIDATE, toBody } from "./CandidateForm";

/** `/hiring/candidates/new` — add a candidate by hand (Interview Hub `/candidates/new`). */
export function NewCandidate() {
  const t = useTranslations("hiring.candidateForm");
  const router = useRouter();
  const locale = useLocale();
  const search = useSearchParams();
  const { has } = useHiringMe();
  const requisitionId = search.get("requisitionId") ?? "";
  const show = {
    comp: has("hiring.viewComp"),
    dei: has("hiring.viewDei"),
    pii: has("hiring.viewPii"),
  };
  const create = useHiringMutation<object, { id: string }>("POST", "/api/hiring/candidates", {
    success: t("created"),
    onSuccess: (r) => router.push(`/${locale}/hiring/candidates/${r.id}`),
  });
  const back = () =>
    router.push(
      requisitionId
        ? `/${locale}/hiring/requisitions/${requisitionId}/pipeline`
        : `/${locale}/hiring/candidates`,
    );
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={t("createTitle")} subtitle={t("createSubtitle")} />
      <FlowRail current={1} />
      <CandidateForm
        initial={{ ...EMPTY_CANDIDATE, requisitionId }}
        show={show}
        submitting={create.isPending}
        submitLabel={t("create")}
        onSubmit={(v) => create.mutate(toBody(v, show))}
        onCancel={back}
      />
    </div>
  );
}
