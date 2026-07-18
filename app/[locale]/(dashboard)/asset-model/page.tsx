"use client";

import { useTranslations } from "next-intl";
import { EntityListPage } from "@/components/shared/EntityListPage";
import {
  getAssetModelColumns,
  type AssetModelRecord,
} from "@/components/asset-model/AssetModelColumns";

export default function AssetModelsPage() {
  const t = useTranslations("assetModels");
  return (
    <EntityListPage<AssetModelRecord>
      apiPath="/api/asset-model"
      basePath="asset-model"
      t={t}
      buildColumns={getAssetModelColumns}
    />
  );
}
