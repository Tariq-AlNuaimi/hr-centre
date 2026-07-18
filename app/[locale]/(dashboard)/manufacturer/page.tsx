"use client";

import { useTranslations } from "next-intl";
import { EntityListPage } from "@/components/shared/EntityListPage";
import {
  getManufacturerColumns,
  type ManufacturerRecord,
} from "@/components/manufacturer/ManufacturerColumns";

export default function ManufacturersPage() {
  const t = useTranslations("manufacturers");
  return (
    <EntityListPage<ManufacturerRecord>
      apiPath="/api/manufacturer"
      basePath="manufacturer"
      t={t}
      buildColumns={getManufacturerColumns}
    />
  );
}
