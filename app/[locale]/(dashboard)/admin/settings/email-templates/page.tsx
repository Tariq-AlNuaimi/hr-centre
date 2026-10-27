import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { navContextFor } from "@/lib/nav/server-context";
import { PageHeader } from "@/components/shared/PageHeader";
import { LinkCards, type LinkCard } from "@/components/shared/LinkCards";

/**
 * Admin › Settings › Email templates (UX review R9). The template sets still
 * live with their module (one store per module until the core email-template
 * service, R15); this tab is the one place that lists them all.
 */
export default async function EmailTemplatesHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();
  const t = await getTranslations("adminSettings.emailTemplates");
  const ctx = await navContextFor(session);
  const cards: LinkCard[] = [];
  if (ctx.jml("jml.configure"))
    cards.push({
      href: `/${locale}/jml/settings/email-templates`,
      title: t("jmlTitle"),
      description: t("jmlDescription"),
    });
  if (ctx.hive.editContent)
    cards.push({
      href: `/${locale}/tickets/setup/email-template`,
      title: t("ticketsTitle"),
      description: t("ticketsDescription"),
    });
  if (cards.length === 0) notFound();

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <LinkCards cards={cards} />
    </>
  );
}
