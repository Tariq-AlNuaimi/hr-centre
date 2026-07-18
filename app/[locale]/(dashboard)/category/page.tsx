"use client";

import { useTranslations } from "next-intl";
import { EntityListPage } from "@/components/shared/EntityListPage";
import { getCategoryColumns, type CategoryRecord } from "@/components/category/CategoryColumns";

export default function CategorysPage() {
  const t = useTranslations("categorys");
  return (
    <EntityListPage<CategoryRecord>
      apiPath="/api/category"
      basePath="category"
      t={t}
      buildColumns={getCategoryColumns}
    />
  );
}
