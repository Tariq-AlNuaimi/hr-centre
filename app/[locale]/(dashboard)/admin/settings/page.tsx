import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { navContextFor } from "@/lib/nav/server-context";
import { visibleNav } from "@/lib/nav/resolve";
import { PageHeader } from "@/components/shared/PageHeader";
import { LinkCards } from "@/components/shared/LinkCards";

/**
 * Admin › Settings — one place to configure the suite (UX review R9,
 * docs/blueprints/ux-p1-nav.md US-8). Every area is a tab of the Settings
 * entry in lib/nav/config.ts; this General tab lists the areas THIS viewer may
 * open, from the same config the sidebar reads, so the two never disagree.
 * Each area keeps its own page and its own server gate.
 */
export default async function SettingsHubPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();
  const t = await getTranslations("adminSettings");
  const tNav = await getTranslations("nav");
  const ctx = await navContextFor(session);
  const areas = visibleNav(ctx)
    .find((e) => e.key === "settings")
    ?.tabs.filter((tab) => tab.key !== "settings-general");
  if (!areas || areas.length === 0) notFound();

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <LinkCards
        cards={areas.map((area) => ({
          href: `/${locale}${area.href}`,
          title: tNav(area.label),
          description: t(`areas.${area.key}`),
        }))}
      />
    </>
  );
}
