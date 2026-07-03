"use client";

import { Button } from "@/components/ui/button";
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
      icon={
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      }
      title={tStatus("forbiddenTitle")}
      subtitle={tStatus("forbiddenSubtitle")}
      actions={
        <Link href={`/${locale}`}>
          <Button>{tCommon("backHome")}</Button>
        </Link>
      }
    />
  );
}
