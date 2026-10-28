"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess } from "../use-jml";

/** Every JML configuration screen, grouped — the Onboarding hr-admin and Offboarding admin tabs, together. */
const SETTINGS_SECTIONS = [
  {
    group: "process",
    keys: [
      "templates",
      "task-routing",
      "rules",
      "contract-types",
      "employment-types",
      "email-templates",
    ],
  },
  { group: "calendar", keys: ["calendar", "statutory", "employee-code"] },
  { group: "lists", keys: ["classifications", "asset-types", "access-checklist"] },
  { group: "leavers", keys: ["approval-authority", "reason-codes", "documents", "import-exits"] },
  { group: "data", keys: ["retention"] },
] as const;

export function SettingsHub() {
  const t = useTranslations("jml.settings");
  const locale = useLocale();
  const { can, isLoading } = useJmlAccess();
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  if (isLoading)
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  if (!can("jml.configure") && !can("jml.verifyStatutory")) {
    return (
      <div className="space-y-6">
        {header}
        <NotPermitted title={t("title")} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {header}
      {SETTINGS_SECTIONS.map((section) => (
        <SectionCard key={section.group} title={t(`group.${section.group}`)}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {section.keys.map((key) => (
              <li key={key}>
                <Link
                  href={`/${locale}/jml/settings/${key}`}
                  className="block rounded-md border border-border p-4 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block text-sm font-medium text-foreground">
                    {t(`item.${key}.title`)}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t(`item.${key}.note`)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      ))}
    </div>
  );
}
