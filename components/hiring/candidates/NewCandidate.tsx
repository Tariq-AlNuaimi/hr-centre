"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { ReadFileButton } from "../ai/ReadFileButton";
import { hiringUpload, useHiringMe, useHiringMutation } from "../ui/api";
import { FlowRail } from "../ui/flow-rail";
import { CandidateForm, EMPTY_CANDIDATE, toBody, type CandidateFormValues } from "./CandidateForm";

type CvRead = {
  name: string;
  email: string;
  phone: string;
  currentEmployer: string;
  linkedinUrl: string;
  profile: Record<string, unknown>;
};

/**
 * `/hiring/candidates/new` — add a candidate by hand, or fill the form from
 * their CV (Interview Hub `/candidates/new` + parse-cv). HR reviews what was
 * read before saving; a PDF CV is then stored on the new record.
 */
export function NewCandidate() {
  const t = useTranslations("hiring.candidateForm");
  const ta = useTranslations("hiring.ai");
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
  const [initial, setInitial] = useState<CandidateFormValues>({
    ...EMPTY_CANDIDATE,
    requisitionId,
  });
  const [formKey, setFormKey] = useState(0);
  const [cv, setCv] = useState<{ file: File | null; profile: Record<string, unknown> | null }>({
    file: null,
    profile: null,
  });
  const create = useHiringMutation<object, { id: string }>("POST", "/api/hiring/candidates", {
    success: t("created"),
    onSuccess: (r) => void afterCreate(r.id),
  });
  async function afterCreate(id: string) {
    if (cv.file && cv.file.type === "application/pdf") {
      const form = new FormData();
      form.append("file", cv.file);
      await hiringUpload(`/api/hiring/candidates/${id}/cv`, form).catch((e: Error) =>
        toast.warning(ta("cvNotStored", { reason: e.message })),
      );
    }
    router.push(`/${locale}/hiring/candidates/${id}`);
  }
  function fill(d: CvRead, current: CandidateFormValues) {
    setInitial({
      ...current,
      name: d.name || current.name,
      email: d.email || current.email,
      phone: d.phone || current.phone,
      currentEmployer: d.currentEmployer || current.currentEmployer,
      linkedinUrl: d.linkedinUrl || current.linkedinUrl,
    });
    setCv((c) => ({ ...c, profile: d.profile }));
    setFormKey((k) => k + 1);
  }
  const back = () =>
    router.push(
      requisitionId
        ? `/${locale}/hiring/requisitions/${requisitionId}/pipeline`
        : `/${locale}/hiring/candidates`,
    );
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={t("createTitle")}
        subtitle={t("createSubtitle")}
        actions={
          show.pii ? (
            <ReadFileButton<CvRead>
              mode="cv"
              label={ta("fillFromCv")}
              onFile={(file) => setCv((c) => ({ ...c, file }))}
              onResult={(d) => fill(d, initial)}
            />
          ) : null
        }
      />
      <FlowRail current={1} />
      {cv.profile ? <p className="text-sm text-muted-foreground">{ta("filledHint")}</p> : null}
      <CandidateForm
        key={formKey}
        initial={initial}
        show={show}
        submitting={create.isPending}
        submitLabel={t("create")}
        onSubmit={(v) => create.mutate({ ...toBody(v, show), profileData: cv.profile })}
        onCancel={back}
      />
    </div>
  );
}
