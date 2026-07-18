"use client";

import { useRouter, useParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { ManufacturerForm } from "@/components/manufacturer/ManufacturerForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { useEntityItem, useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import type { ManufacturerRecord } from "@/components/manufacturer/ManufacturerColumns";

export default function EditManufacturerPage() {
  const t = useTranslations("manufacturers");
  const router = useRouter();
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const { success, error: showError } = useNotify();
  // Read failure toasts via the QueryProvider cache-level onError (message here).
  const { data: record, isLoading } = useEntityItem<ManufacturerRecord>(
    "/api/manufacturer",
    params?.id,
    t("loadFailed"),
  );
  const { update } = useEntityMutations<ManufacturerRecord>("/api/manufacturer");

  const handleSubmit = async (values: Partial<ManufacturerRecord>) => {
    if (!params?.id) return;
    try {
      await update.mutateAsync({ id: params.id, data: values });
      success(t("updated"));
      router.push(`/${locale}/manufacturer`);
    } catch {
      showError(t("updateFailed"));
    }
  };

  if (isLoading) return <FormSkeleton />;
  if (!record) return null;

  return (
    <>
      <PageHeader title={t("editTitle")} />
      <ManufacturerForm
        initialValues={record}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/manufacturer`)}
        loading={update.isPending}
      />
    </>
  );
}
