"use client";

import { useTranslations } from "next-intl";
import { EntityListPage } from "@/components/shared/EntityListPage";
import {
  getCustomFieldDefColumns,
  type CustomFieldDefRecord,
} from "@/components/custom-field-def/CustomFieldDefColumns";

export default function CustomFieldDefsPage() {
  const t = useTranslations("customFieldDefs");
  return (
    <EntityListPage<CustomFieldDefRecord>
      apiPath="/api/custom-field-def"
      basePath="custom-field-def"
      t={t}
      buildColumns={getCustomFieldDefColumns}
    />
  );
}
