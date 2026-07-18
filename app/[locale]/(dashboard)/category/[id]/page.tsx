"use client";

import { useRouter, useParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { CategoryForm } from "@/components/category/CategoryForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { useEntityItem, useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import type { CategoryRecord } from "@/components/category/CategoryColumns";

export default function EditCategoryPage() {
  const t = useTranslations("categorys");
  const router = useRouter();
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const { success, error: showError } = useNotify();
  // Read failure toasts via the QueryProvider cache-level onError (message here).
  const { data: record, isLoading } = useEntityItem<CategoryRecord>(
    "/api/category",
    params?.id,
    t("loadFailed"),
  );
  const { update } = useEntityMutations<CategoryRecord>("/api/category");

  const handleSubmit = async (values: Partial<CategoryRecord>) => {
    if (!params?.id) return;
    try {
      await update.mutateAsync({ id: params.id, data: values });
      success(t("updated"));
      router.push(`/${locale}/category`);
    } catch {
      showError(t("updateFailed"));
    }
  };

  if (isLoading) return <FormSkeleton />;
  if (!record) return null;

  return (
    <>
      <PageHeader title={t("editTitle")} />
      <CategoryForm
        initialValues={record}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/category`)}
        loading={update.isPending}
      />
    </>
  );
}
