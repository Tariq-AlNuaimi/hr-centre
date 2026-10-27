import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { getHivePermissions } from "@/lib/hive/services/permissions";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { LinkCards } from "@/components/shared/LinkCards";
import { SectionCard } from "@/components/shared/SectionCard";
import { HiveRoleBadge } from "@/components/hive/HiveRoleBadge";

/**
 * The HIVE admin landing page.
 *
 * This was a redirect, and the redirect was wrong in a way only the running app
 * showed: it sent ADMINs to the Permission Editor, and the sidebar has one HIVE
 * entry pointing here — so for Alaa and Muna, the only two seeded accounts that
 * hold `canEditContent`, the Content Editor had no route into it from the UI at
 * all. Both are ADMIN, so both were redirected away from the screen they are the
 * users of. A screen reachable only by typing its URL is not shipped.
 *
 * A landing page rather than a smarter redirect, because §5.3 puts these screens
 * behind DIFFERENT gates — the Permission Editor is ADMIN-only, the Content
 * Editor needs `canEditContent`, and the spec's cast sits on both sides of that
 * line — and because Phase 2 adds escalations, documents and the chat surface
 * here. One entry that lists what you may open scales; a redirect that guesses
 * does not.
 *
 * Only cards the caller can actually open are rendered. That is a courtesy, not
 * a control: every route and screen below gates itself server-side.
 */
export default async function HiveIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("hive.home");
  const session = await auth();

  const permissions = session?.user?.id ? await getHivePermissions(session.user.id) : null;

  type Card = { href: string; title: string; description: string };
  const only = (cards: Array<Card | false | undefined>) =>
    cards.filter((c): c is Card => Boolean(c));
  // UX P1 (tickets P1-5): two jobs, two owners. Ticket settings decide how
  // tickets are routed and answered; Siraaj knowledge is the reference data the
  // assistant answers from. The working screens (queue, reports) are not here —
  // they are in the sidebar and in Insights.
  const ticketSettings = only([
    permissions?.editContent && {
      href: `/${locale}/tickets/setup/settings`,
      title: t("settingsTitle"),
      description: t("settingsDescription"),
    },
    permissions?.editContent && {
      href: `/${locale}/tickets/setup/saved-replies`,
      title: t("savedRepliesTitle"),
      description: t("savedRepliesDescription"),
    },
    permissions?.configure && {
      href: `/${locale}/tickets/setup/pairs`,
      title: t("pairsTitle"),
      description: t("pairsDescription"),
    },
    // Ticket access is given on the role builder, which only platform admins
    // manage (operator decision, ADR-079).
    session?.user?.role === "ADMIN" && {
      href: `/${locale}/admin/roles`,
      title: t("accessTitle"),
      description: t("accessDescription"),
    },
  ]);
  const knowledge = only(
    permissions?.configure
      ? [
          {
            href: `/${locale}/tickets/setup/rotation`,
            title: t("rotationTitle"),
            description: t("rotationDescription"),
          },
          {
            href: `/${locale}/tickets/setup/discounts`,
            title: t("discountsTitle"),
            description: t("discountsDescription"),
          },
          {
            href: `/${locale}/tickets/setup/providers`,
            title: t("providersTitle"),
            description: t("providersDescription"),
          },
          {
            href: `/${locale}/tickets/setup/org-details`,
            title: t("orgTitle"),
            description: t("orgDescription"),
          },
        ]
      : [],
  );

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("intro")} actions={<HiveRoleBadge />} />

      {ticketSettings.length + knowledge.length === 0 ? (
        <EmptyState description={t("noAccess")} />
      ) : (
        <div className="space-y-6">
          {ticketSettings.length > 0 ? (
            <SectionCard title={t("ticketSettingsSection")} subtitle={t("ticketSettingsNote")}>
              <LinkCards cards={ticketSettings} />
            </SectionCard>
          ) : null}
          {knowledge.length > 0 ? (
            <SectionCard title={t("knowledgeSection")} subtitle={t("knowledgeNote")}>
              <LinkCards cards={knowledge} />
            </SectionCard>
          ) : null}
        </div>
      )}
    </>
  );
}
