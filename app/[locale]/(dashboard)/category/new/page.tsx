"use client";

import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { CategoryForm } from "@/components/category/CategoryForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import type { CategoryRecord } from "@/components/category/CategoryColumns";

export default function NewCategoryPage() {
  const t = useTranslations("categorys");
  const router = useRouter();
  const locale = useLocale();
  const { success, error: showError } = useNotify();
  const { create } = useEntityMutations<CategoryRecord>("/api/category");

  const handleSubmit = async (values: Partial<CategoryRecord>) => {
    try {
      await create.mutateAsync(values);
      success(t("created"));
      router.push(`/${locale}/category`);
    } catch {
      showError(t("createFailed"));
    }
  };

  return (
    <>
      <PageHeader title={t("createNew")} />
      <CategoryForm
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/category`)}
        loading={create.isPending}
      />
    </>
  );
}
