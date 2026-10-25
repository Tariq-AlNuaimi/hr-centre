import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { ORG_TREE_NODE_SELECT } from "@/lib/pms/employee-select";
import { visibleEmployeeIds } from "@/lib/pms/org-tree";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { OrgChart } from "@/components/pms/OrgChart";
import { buildOrgChart, type OrgNode } from "@/lib/pms/org-chart";

/**
 * The reporting tree — spec §4.2.
 *
 * Scoped exactly like the directory: HR and executives see the whole group, a
 * manager sees their own subtree, everyone else sees themselves. The node
 * `select` carries no compensation column at all (§4.5), so there is no
 * capability branch here to get wrong. Soft-deleted people never arrive:
 * `Employee` is in `SOFT_DELETE_MODELS`, so every read through `prisma`
 * already carries `deletedAt: null` — this page must not re-filter, or there
 * are two answers to one question and one of them goes stale.
 *
 * The READ stays on the server, where §4.2 belongs. Only the arranging,
 * collapsing and searching moved to the client (`OrgChart`): they are
 * per-reader state, and a round trip per toggle on a tree somebody is scanning
 * is not a trade worth making. `buildOrgChart` does the arrangement in a pure
 * function so the shape is testable without a browser.
 */

export default async function OrgPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();
  if (!session) redirect(`/${locale}/login`);

  const t = await getTranslations("pms");
  const actor = await resolveActor(session);

  const visible = await visibleEmployeeIds({
    employeeId: actor.employeeId,
    orgWide: actor.capabilities.orgWide,
  });

  const nodes: OrgNode[] =
    visible !== null && visible.size === 0
      ? []
      : await prisma.employee.findMany({
          where: visible !== null ? { id: { in: [...visible] } } : {},
          // Bounded: the import layer caps an org at 10,000 rows, and a tree is
          // only legible far below that. A larger org gets the directory, which
          // paginates.
          take: 2000,
          orderBy: { name: "asc" },
          select: ORG_TREE_NODE_SELECT,
        });

  const entities = buildOrgChart(nodes);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("org.title")}
        subtitle={actor.capabilities.orgWide ? t("org.subtitleOrgWide") : t("org.subtitleChain")}
      />

      <SectionCard title={t("org.reportingLines")} subtitle={t("org.structureHelp")}>
        {entities.length === 0 ? (
          <EmptyState description={t("org.empty")} />
        ) : (
          <OrgChart entities={entities} locale={locale} totalCount={nodes.length} />
        )}
      </SectionCard>
    </div>
  );
}
