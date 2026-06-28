"use client";

import { Button } from "antd";
import { LockOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { BrandedStatus } from "@/components/shared/BrandedStatus";

// Branded 403. The template enforces RBAC server-side (auth wrappers / middleware
// redirect), so most unauthorized access never renders UI — this is the explicit
// "you're signed in but lack permission" screen to redirect to when a route wants
// to show a forbidden state instead of a hard redirect.
export default function ForbiddenPage() {
  const tStatus = useTranslations("status");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  return (
    <BrandedStatus
      minHeight="100vh"
      code="403"
      icon={<LockOutlined />}
      title={tStatus("forbiddenTitle")}
      subtitle={tStatus("forbiddenSubtitle")}
      actions={
        <Link href={`/${locale}`}>
          <Button type="primary">{tCommon("backHome")}</Button>
        </Link>
      }
    />
  );
}
