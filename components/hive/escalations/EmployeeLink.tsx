"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { Detail } from "./TicketActions";

/**
 * Who asked (ADR-079): the email the ticket was raised with, the core Employee
 * record it matched (if any), and whether Siraaj confirmed the identity. The
 * record page applies its own access rules; this is only a link.
 */
export function EmployeeLink({ detail }: { detail: Detail }) {
  const t = useTranslations("hive.escalations");
  const locale = useLocale();
  return (
    <p className="mb-0 mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>{detail.employeeEmail}</span>
      <Badge variant={detail.identityVerified ? "success" : "outline"}>
        {detail.identityVerified ? t("identityVerified") : t("identityUnverified")}
      </Badge>
      {detail.employee ? (
        <Link
          href={`/${locale}/people/${detail.employee.id}?tab=tickets`}
          className="underline underline-offset-4"
        >
          {t("employeeRecord")}
        </Link>
      ) : (
        <span>{t("noEmployeeRecord")}</span>
      )}
    </p>
  );
}
