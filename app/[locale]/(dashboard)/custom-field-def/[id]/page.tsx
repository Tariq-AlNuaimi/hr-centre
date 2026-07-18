"use client";

import { useRouter, useParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { CustomFieldDefForm } from "@/components/custom-field-def/CustomFieldDefForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { useEntityItem, useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import type { CustomFieldDefRecord } from "@/components/custom-field-def/CustomFieldDefColumns";

export default function EditCustomFieldDefPage() {
  const t = useTranslations("customFieldDefs");
  const router = useRouter();
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const { success, error: showError } = useNotify();
  const { data: record, isLoading } = useEntityItem<CustomFieldDefRecord>(
    "/api/custom-field-def",
    params?.id,
    t("loadFailed"),
  );
  const { update } = useEntityMutations<CustomFieldDefRecord>("/api/custom-field-def");

  const handleSubmit = async (values: Partial<CustomFieldDefRecord>) => {
    if (!params?.id) return;
    // `key` is immutable — the form disables it, and the update schema omits it.
    const { key: _key, ...rest } = values;
    try {
      await update.mutateAsync({ id: params.id, data: rest });
      success(t("updated"));
      router.push(`/${locale}/custom-field-def`);
    } catch {
      showError(t("updateFailed"));
    }
  };

  if (isLoading) return <FormSkeleton />;
  if (!record) return null;

  return (
    <>
      <PageHeader title={t("editTitle")} />
      <CustomFieldDefForm
        initialValues={record}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/custom-field-def`)}
        loading={update.isPending}
      />
    </>
  );
}
