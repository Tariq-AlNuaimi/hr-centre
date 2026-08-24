"use client";

import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { RoleEditor } from "@/components/pms/RoleEditor";
import { usePmsActor } from "@/hooks/use-pms-actor";

/**
 * HR roles — spec §4.1 (the role table) and §4.3 (roles are additive).
 *
 * HR Super Admin only, and deliberately narrower than the cycles console:
 * §4.1 gives HRBP "runs the cycle org-wide" but marks Configures? as "No", and
 * deciding who else may see every salary in the company is configuration. That
 * is also the route's own gate (`isHrSuperAdmin`), so the affordance and the
 * enforcement answer the same question.
 *
 * `usePmsActor` fails closed while loading, so the editor is never rendered on
 * an unresolved actor.
 */
export default function RolesPage() {
  const t = useTranslations("pms");
  const { actor, isLoading } = usePmsActor();

  const isHrSuperAdmin = (actor?.pmsRoles ?? []).includes("HR_SUPER_ADMIN");

  if (isLoading) {
    // Silhouette of the whole page: until the actor resolves, whether this user
    // gets the editor or the notice is unknown, and a real header would prejudge it.
    return <PageSkeleton rows={6} />;
  }

  if (!isHrSuperAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("roles.title")} />
        <SectionCard title={t("roles.title")}>
          <EmptyState description={t("roles.notPermitted")} />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("roles.title")} subtitle={t("roles.subtitle")} />
      <RoleEditor actorEmployeeId={actor?.employeeId ?? null} />
    </div>
  );
}
