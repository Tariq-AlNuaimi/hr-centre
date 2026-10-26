"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { buttonVariants } from "@/components/ui/button-variants";
import { CaseList } from "../cases/CaseList";
import { useJmlAccess } from "../use-jml";

/** Movers — internal changes (Onboarding INTERNAL_CHANGE), with the way to start one. */
export function MoverList() {
  const t = useTranslations("jml.movers");
  const { can } = useJmlAccess();
  return (
    <CaseList
      fixedType="MOVE"
      header={
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            can("jml.manageMovers") ? (
              <Link href="/jml/movers/new" className={buttonVariants({ variant: "default" })}>
                {t("startTitle")}
              </Link>
            ) : null
          }
        />
      }
    />
  );
}
