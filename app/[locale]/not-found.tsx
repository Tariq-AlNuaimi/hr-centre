"use client";

import { Button } from "antd";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandedStatus } from "@/components/shared/BrandedStatus";

export default function NotFound() {
  const t = useTranslations("notFound");
  const tStatus = useTranslations("status");
  const tCommon = useTranslations("common");

  return (
    <BrandedStatus
      minHeight="100vh"
      code="404"
      title={tStatus("notFoundTitle")}
      subtitle={t("subtitle")}
      actions={
        <Link href="/">
          <Button type="primary">{tCommon("backHome")}</Button>
        </Link>
      }
    />
  );
}
