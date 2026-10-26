"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { useHiveAccess } from "./use-hive-access";

/**
 * The HIVE role beside the signed-in person's name (blueprint AC-T3.7).
 *
 * DERIVED from grants (ADR-073) and shown for orientation only — "am I the one
 * who approves here?" — never used to decide anything. Rendered only for
 * someone who holds at least one HIVE grant, so a template-only account does
 * not wear a HIVE label it has no meaning for. Keys are written out literally
 * for the static i18n-key gate.
 */
export function HiveRoleBadge() {
  const t = useTranslations("hive.roleLabel");
  const access = useHiveAccess();
  const any =
    access.seeTickets ||
    access.draftEscalation ||
    access.approve ||
    access.editContent ||
    access.configure ||
    access.viewReports;
  if (!any) return null;
  const label = {
    Admin: t("Admin"),
    Approver: t("Approver"),
    Drafter: t("Drafter"),
    Viewer: t("Viewer"),
  }[access.roleLabel];
  return (
    <Badge variant="outline" className="hidden sm:inline-flex">
      {label}
    </Badge>
  );
}
