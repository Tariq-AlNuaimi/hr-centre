"use client";

import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { ManufacturerForm } from "@/components/manufacturer/ManufacturerForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import type { ManufacturerRecord } from "@/components/manufacturer/ManufacturerColumns";

export default function NewManufacturerPage() {
  const t = useTranslations("manufacturers");
  const router = useRouter();
  const locale = useLocale();
  const { success, error: showError } = useNotify();
  const { create } = useEntityMutations<ManufacturerRecord>("/api/manufacturer");

  const handleSubmit = async (values: Partial<ManufacturerRecord>) => {
    try {
      await create.mutateAsync(values);
      success(t("created"));
      router.push(`/${locale}/manufacturer`);
    } catch {
      showError(t("createFailed"));
    }
  };

  return (
    <>
      <PageHeader title={t("createNew")} />
      <ManufacturerForm
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/manufacturer`)}
        loading={create.isPending}
      />
    </>
  );
}
