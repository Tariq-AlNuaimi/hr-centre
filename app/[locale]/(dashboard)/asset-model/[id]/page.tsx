"use client";

import { useRouter, useParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { AssetModelForm } from "@/components/asset-model/AssetModelForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { useEntityItem, useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import type { AssetModelRecord } from "@/components/asset-model/AssetModelColumns";

export default function EditAssetModelPage() {
  const t = useTranslations("assetModels");
  const router = useRouter();
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const { success, error: showError } = useNotify();
  // Read failure toasts via the QueryProvider cache-level onError (message here).
  const { data: record, isLoading } = useEntityItem<AssetModelRecord>(
    "/api/asset-model",
    params?.id,
    t("loadFailed"),
  );
  const { update } = useEntityMutations<AssetModelRecord>("/api/asset-model");

  const handleSubmit = async (values: Partial<AssetModelRecord>) => {
    if (!params?.id) return;
    try {
      await update.mutateAsync({ id: params.id, data: values });
      success(t("updated"));
      router.push(`/${locale}/asset-model`);
    } catch {
      showError(t("updateFailed"));
    }
  };

  if (isLoading) return <FormSkeleton />;
  if (!record) return null;

  return (
    <>
      <PageHeader title={t("editTitle")} />
      <AssetModelForm
        initialValues={record}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/asset-model`)}
        loading={update.isPending}
      />
    </>
  );
}
