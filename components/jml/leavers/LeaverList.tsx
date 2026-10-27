"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { buttonVariants } from "@/components/ui/button-variants";
import { CaseList } from "../cases/CaseList";
import { useJmlAccess } from "../use-jml";

/** Leavers — exit cases (Offboarding `/exits`), with the way to open one. */
export function LeaverList() {
  const t = useTranslations("jml.leavers");
  const { can } = useJmlAccess();
  return (
    <CaseList
      fixedType="LEAVE"
      header={
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <div className="flex gap-2">
              <Link href="/jml/leavers/calendar" className={buttonVariants({ variant: "outline" })}>
                {t("calendar")}
              </Link>
              {can("jml.manageLeavers") ? (
                <Link href="/jml/leavers/new" className={buttonVariants({ variant: "default" })}>
                  {t("newTitle")}
                </Link>
              ) : null}
            </div>
          }
        />
      }
    />
  );
}
