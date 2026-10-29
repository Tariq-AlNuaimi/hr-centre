import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/core/actor";
import { ORG_TREE_NODE_SELECT } from "@/lib/core/employee-select";
import { visibleEmployeeIds } from "@/lib/pms/org-tree";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { OrgChart } from "@/components/pms/OrgChart";
import { buildOrgChart, type OrgCardPerson, type OrgNode } from "@/lib/pms/org-chart";
import { OrgCards } from "@/components/org/OrgCards";
import { Link } from "@/i18n/navigation";

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

export default async function OrgPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string | string[];
    view?: string | string[];
    person?: string | string[];
  }>;
}) {
  const { locale } = await params;
  // "View in org chart" from a record (UX P1 R10) opens the chart searched for that person.
  const sp = await searchParams;
  const q = sp.q;
  const initialQuery = typeof q === "string" ? q.slice(0, 100) : "";
  // P2 (R19): card mode is the default; `?view=list` keeps the searchable tree.
  const view = sp.view === "list" || initialQuery ? "list" : "cards";
  const initialPersonId = typeof sp.person === "string" ? sp.person.slice(0, 40) : null;
  const session = await auth();
  if (!session) redirect(`/${locale}/login`);

  const t = await getTranslations("pms");
  const actor = await resolveActor(session);

  const visible = await visibleEmployeeIds({
    employeeId: actor.employeeId,
    orgWide: actor.capabilities.orgWide,
    scopeMembers: actor.scopeMembers,
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
  const people: OrgCardPerson[] = nodes.map((n) => ({
    id: n.id,
    name: n.name,
    managerId: n.managerId,
    departmentName: n.department?.name ?? null,
  }));
  // Open roles from requisitions — HR and executives only: a requisition can be
  // a confidential replacement, and a department's count would reveal it.
  const openRoles = actor.capabilities.orgWide ? await openRolesByDepartment() : null;

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
          <div className="space-y-4">
            <nav aria-label={t("org.viewLabel")} className="flex gap-3 text-sm">
              <Link
                href={{ pathname: "/org", query: { view: "cards" } }}
                aria-current={view === "cards" ? "page" : undefined}
                className={
                  view === "cards"
                    ? "font-semibold text-foreground"
                    : "text-primary hover:underline"
                }
              >
                {t("org.viewCards")}
              </Link>
              <Link
                href={{ pathname: "/org", query: { view: "list" } }}
                aria-current={view === "list" ? "page" : undefined}
                className={
                  view === "list" ? "font-semibold text-foreground" : "text-primary hover:underline"
                }
              >
                {t("org.viewList")}
              </Link>
            </nav>
            {view === "cards" ? (
              <OrgCards
                entities={entities}
                people={people}
                openRoles={openRoles}
                initialPersonId={initialPersonId}
              />
            ) : (
              <OrgChart
                entities={entities}
                locale={locale}
                totalCount={nodes.length}
                initialQuery={initialQuery}
              />
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/** Open roles per department: openings on OPEN or REOPENED requisitions. */
async function openRolesByDepartment(): Promise<Record<string, number>> {
  const rows = await prisma.hiringRequisition.groupBy({
    by: ["departmentId"],
    where: { status: { in: ["OPEN", "REOPENED"] }, departmentId: { not: null } },
    _sum: { openings: true },
  });
  return Object.fromEntries(
    rows.filter((r) => r.departmentId).map((r) => [r.departmentId!, r._sum.openings ?? 0]),
  );
}
