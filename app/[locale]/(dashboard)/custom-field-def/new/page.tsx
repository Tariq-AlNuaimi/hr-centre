"use client";

import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { CustomFieldDefForm } from "@/components/custom-field-def/CustomFieldDefForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import type { CustomFieldDefRecord } from "@/components/custom-field-def/CustomFieldDefColumns";

export default function NewCustomFieldDefPage() {
  const t = useTranslations("customFieldDefs");
  const router = useRouter();
  const locale = useLocale();
  const { success, error: showError } = useNotify();
  const { create } = useEntityMutations<CustomFieldDefRecord>("/api/custom-field-def");

  const handleSubmit = async (values: Partial<CustomFieldDefRecord>) => {
    try {
      await create.mutateAsync(values);
      success(t("created"));
      router.push(`/${locale}/custom-field-def`);
    } catch {
      showError(t("createFailed"));
    }
  };

  return (
    <>
      <PageHeader title={t("createNew")} />
      <CustomFieldDefForm
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/custom-field-def`)}
        loading={create.isPending}
      />
    </>
  );
}
