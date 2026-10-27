"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { useHiringMe, useHiringMutation, useHiringQuery } from "../ui/api";
import { FlowRail } from "../ui/flow-rail";
import { OfferForm, toOfferBody, type CandidateRef, type OfferFormValues } from "./OfferForm";

export const EMPTY_OFFER: Omit<OfferFormValues, "candidate"> = {
  salary: "",
  allowances: [],
  startDate: "",
  probationMonths: "3",
  noticePeriod: "1 month",
  contractType: "Permanent",
  benefits: "",
};

/** `/hiring/offers/new` (`?candidateId=` preselects): drafting is the move to "Offer drafted". */
export function NewOffer() {
  const t = useTranslations("hiring.offerForm");
  const router = useRouter();
  const locale = useLocale();
  const params = useSearchParams();
  const candidateId = params.get("candidateId");
  const { has } = useHiringMe();
  const pre = useHiringQuery<CandidateRef>(
    candidateId ? `/api/hiring/candidates/${candidateId}` : null,
  );
  const create = useHiringMutation<object, { id: string }>("POST", "/api/hiring/offers", {
    success: t("created"),
    onSuccess: (r) => router.push(`/${locale}/hiring/offers/${r.id}`),
  });
  const showPay = has("hiring.viewComp");
  return (
    <div className="space-y-4">
      <PageHeader title={t("createTitle")} subtitle={t("createSubtitle")} />
      <FlowRail current={6} />
      {candidateId && pre.isLoading ? (
        <FormSkeleton fields={8} />
      ) : (
        <OfferForm
          initial={{
            candidate: pre.data
              ? {
                  id: pre.data.id,
                  name: pre.data.name,
                  stage: pre.data.stage,
                  requisition: pre.data.requisition,
                }
              : null,
            ...EMPTY_OFFER,
          }}
          showPay={showPay}
          submitting={create.isPending}
          submitLabel={t("create")}
          onCancel={() => router.back()}
          onSubmit={(v) =>
            create.mutate({ candidateId: v.candidate!.id, ...toOfferBody(v, showPay) })
          }
        />
      )}
    </div>
  );
}
