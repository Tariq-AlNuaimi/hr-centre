"use client";

import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { RoleEditor } from "@/components/pms/RoleEditor";
import { AccountsTable } from "@/components/users/AccountsTable";
import { PlatformAdminRoster } from "@/components/users/PlatformAdminRoster";
import { usePmsActor } from "@/hooks/use-pms-actor";

/**
 * Access — the one screen that answers "what can this person do?" (ADR-070).
 *
 * It replaces two screens that never mentioned each other:
 *
 *   /users        platform logins and the platform role   (platform ADMIN)
 *   /admin/roles  §4.1 HR authority                        (HR Super Admin)
 *
 * Both still redirect here, so existing links and muscle memory survive.
 *
 * WHY IT IS TWO SECTIONS AND NOT ONE TABLE. The populations are genuinely
 * different sets, not two views of one set (ADR-065): the bootstrap admin on
 * every deployment is a `User` with no `Employee`, and most employees have no
 * platform authority at all. A single table would have to invent a row for one
 * or hide the other, and hiding the most privileged account in the system is the
 * opposite of what an access screen is for. What the merge buys is that BOTH
 * facts are now reachable without leaving the page — and on the accounts table,
 * both are on the same ROW.
 *
 * WHY THE HALF YOU DO NOT GOVERN IS SHOWN RATHER THAN HIDDEN. An HR Super Admin
 * cannot grant platform administration, and a platform admin cannot grant HR
 * authority — that boundary is deliberate and this screen does not move it. But
 * a hidden section teaches nothing: an HR admin who cannot see that platform
 * administration exists will keep asking for it in the wrong place. So the
 * section renders with the reason in it.
 *
 * Both gates fail closed: `usePmsActor` reports no roles while loading, and the
 * session's role is read only after the session resolves. Every route behind
 * this screen enforces the same rules server-side — this is the affordance.
 */
export default function AccessPage() {
  const t = useTranslations("access");
  const tUsers = useTranslations("users");
  const router = useRouter();
  const locale = useLocale();
  const { data: session, status } = useSession();
  const { actor, isLoading } = usePmsActor();

  const isHrSuperAdmin = (actor?.pmsRoles ?? []).includes("HR_SUPER_ADMIN");
  // types/index.ts augments next-auth's Session.user with role: Role.
  // ADR-070 kept the enum and narrowed what can be SET; `=== "ADMIN"` is still
  // what the column means, and `lib/validations/user.ts` is the one place that
  // maps it in both directions.
  const isPlatformAdmin = session?.user?.role === "ADMIN";

  if (isLoading || status === "loading") {
    // Silhouette of the whole page: until both identities resolve, which
    // sections this viewer gets is unknown, and a real header would prejudge it.
    return <PageSkeleton rows={8} />;
  }

  if (!isHrSuperAdmin && !isPlatformAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} />
        <SectionCard title={t("title")}>
          <EmptyState description={t("noAccess")} />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <SectionCard
        title={t("accountsSection")}
        subtitle={t("accountsSectionHint")}
        actions={
          isPlatformAdmin ? (
            <Button onClick={() => router.push(`/${locale}/admin/access/new`)}>
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              {tUsers("createLogin")}
            </Button>
          ) : null
        }
      >
        {isPlatformAdmin ? (
          <AccountsTable />
        ) : (
          <div className="flex flex-col gap-4">
            <EmptyState description={t("accountsNotYours")} />
            {/*
              ADR-070 amendment — the half-answer this fixes.
              "Only a platform administrator can do this" told an HR Super Admin
              to go and ask, without saying whom. The roster is shown to exactly
              the audience that CANNOT act on it, because knowing who to ask is
              the action available to them.
            */}
            <PlatformAdminRoster />
          </div>
        )}
      </SectionCard>

      <SectionCard title={t("hrSection")} subtitle={t("hrSectionHint")}>
        {isHrSuperAdmin ? (
          <RoleEditor actorEmployeeId={actor?.employeeId ?? null} />
        ) : (
          <EmptyState description={t("hrSectionNotYours")} />
        )}
      </SectionCard>

      {/*
        The sentence that stops the next "why can't I just make them an admin?".
        Kept on the page rather than in a tooltip: it is the reason the screen has
        two sections, and a reason nobody can find explains nothing.
      */}
      <p className="text-xs text-muted-foreground">{t("whyTwo")}</p>
    </div>
  );
}
