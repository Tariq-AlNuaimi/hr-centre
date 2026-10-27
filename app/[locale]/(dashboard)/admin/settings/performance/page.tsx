import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { navContextFor } from "@/lib/nav/server-context";
import { PageHeader } from "@/components/shared/PageHeader";
import { LinkCards, type LinkCard } from "@/components/shared/LinkCards";

/**
 * Admin › Settings › Performance (UX review R9): Performance is configured on
 * its working screens (stage windows and policy on the cycle console, the
 * corporate scores HR keys in, 360 rater setup), so this tab lists them.
 */
export default async function PerformanceSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();
  const t = await getTranslations("adminSettings.performance");
  const ctx = await navContextFor(session);
  if (!ctx.pms.hr) notFound();
  const cards: LinkCard[] = [
    {
      href: `/${locale}/admin/cycles`,
      title: t("cyclesTitle"),
      description: t("cyclesDescription"),
    },
    {
      href: `/${locale}/admin/strategy-scores`,
      title: t("scoresTitle"),
      description: t("scoresDescription"),
    },
    {
      href: `/${locale}/three-sixty`,
      title: t("threeSixtyTitle"),
      description: t("threeSixtyDescription"),
    },
  ];

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <LinkCards cards={cards} />
    </>
  );
}
