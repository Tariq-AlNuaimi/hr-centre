import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { getHivePermissions } from "@/lib/hive/services/permissions";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
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

  const cards = [
    // §5.4's queue. Gated on See tickets (ADR-073): spec V2 §8.8 shows every
    // ticket to everyone who holds it, read-only for those who cannot act.
    permissions?.seeTickets && {
      href: `/${locale}/hive/escalations`,
      title: t("escalationsTitle"),
      description: t("escalationsDescription"),
    },
    // Spec V2 §8.8 Settings: the ticket prefix, status names and (linked from
    // there) the answer email. Gated on Edit content — since HIVE ADR-075 that is
    // the wording HIVE still holds.
    permissions?.editContent && {
      href: `/${locale}/hive/settings`,
      title: t("settingsTitle"),
      description: t("settingsDescription"),
    },
    // US-T7: counts only, gated on View reports.
    permissions?.viewReports && {
      href: `/${locale}/hive/reports`,
      title: t("reportsTitle"),
      description: t("reportsDescription"),
    },
    // HR Centre: ticket access is given on the role builder, which only
    // platform admins manage (operator decision, ADR-079) — HIVE's Permission
    // Editor (a Manage accounts grant) is gone.
    session?.user?.role === "ADMIN" && {
      href: `/${locale}/admin/roles`,
      title: t("accessTitle"),
      description: t("accessDescription"),
    },
  ].filter((c): c is { href: string; title: string; description: string } => Boolean(c));

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("intro")} actions={<HiveRoleBadge />} />

      {cards.length === 0 ? (
        <EmptyState description={t("noAccess")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="flex flex-col gap-1 rounded-md border border-border bg-card p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="font-medium">{card.title}</span>
              <span className="text-sm text-muted-foreground">{card.description}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
