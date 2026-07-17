"use client";

import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { AssetForm } from "@/components/asset/AssetForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import type { AssetRecord } from "@/components/asset/AssetColumns";

export default function NewAssetPage() {
  const t = useTranslations("assets");
  const router = useRouter();
  const locale = useLocale();
  const { success, error: showError } = useNotify();
  const { create } = useEntityMutations<AssetRecord>("/api/asset");

  const handleSubmit = async (values: Partial<AssetRecord>) => {
    try {
      await create.mutateAsync(values);
      success(t("created"));
      router.push(`/${locale}/asset`);
    } catch {
      showError(t("createFailed"));
    }
  };

  return (
    <>
      <PageHeader title={t("createNew")} />
      <AssetForm
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/asset`)}
        loading={create.isPending}
      />
    </>
  );
}
