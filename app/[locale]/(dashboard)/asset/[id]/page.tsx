"use client";

import { useRouter, useParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { AssetForm } from "@/components/asset/AssetForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { useEntityItem, useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import type { AssetRecord } from "@/components/asset/AssetColumns";

export default function EditAssetPage() {
  const t = useTranslations("assets");
  const router = useRouter();
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const { success, error: showError } = useNotify();
  // Read failure toasts via the QueryProvider cache-level onError (message here).
  const { data: record, isLoading } = useEntityItem<AssetRecord>(
    "/api/asset",
    params?.id,
    t("loadFailed"),
  );
  const { update } = useEntityMutations<AssetRecord>("/api/asset");

  const handleSubmit = async (values: Partial<AssetRecord>) => {
    if (!params?.id) return;
    try {
      await update.mutateAsync({ id: params.id, data: values });
      success(t("updated"));
      router.push(`/${locale}/asset`);
    } catch {
      showError(t("updateFailed"));
    }
  };

  if (isLoading) return <FormSkeleton />;
  if (!record) return null;

  return (
    <>
      <PageHeader title={t("editTitle")} />
      <AssetForm
        initialValues={record}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/asset`)}
        loading={update.isPending}
      />
    </>
  );
}
