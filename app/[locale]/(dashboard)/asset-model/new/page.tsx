"use client";

import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { AssetModelForm } from "@/components/asset-model/AssetModelForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import type { AssetModelRecord } from "@/components/asset-model/AssetModelColumns";

export default function NewAssetModelPage() {
  const t = useTranslations("assetModels");
  const router = useRouter();
  const locale = useLocale();
  const { success, error: showError } = useNotify();
  const { create } = useEntityMutations<AssetModelRecord>("/api/asset-model");

  const handleSubmit = async (values: Partial<AssetModelRecord>) => {
    try {
      await create.mutateAsync(values);
      success(t("created"));
      router.push(`/${locale}/asset-model`);
    } catch {
      showError(t("createFailed"));
    }
  };

  return (
    <>
      <PageHeader title={t("createNew")} />
      <AssetModelForm
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/asset-model`)}
        loading={create.isPending}
      />
    </>
  );
}
