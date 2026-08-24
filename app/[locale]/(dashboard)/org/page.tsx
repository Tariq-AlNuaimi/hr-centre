import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { ORG_TREE_NODE_SELECT } from "@/lib/pms/employee-select";
import { visibleEmployeeIds } from "@/lib/pms/org-tree";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";

/**
 * The reporting tree — spec §4.2.
 *
 * Scoped exactly like the directory: HR and executives see the whole group, a
 * manager sees their own subtree, everyone else sees themselves. The node
 * `select` carries no compensation column at all (§4.5), so there is no
 * capability branch here to get wrong.
 *
 * Server-rendered: the tree is read-only structure, and shipping it as markup
 * costs no client JavaScript.
 */

type Node = {
  id: string;
  name: string;
  roleTrack: string;
  status: string;
  managerId: string | null;
  department: { id: string; name: string } | null;
  entity: { id: string; code: string };
};

/**
 * Build parent → children from a flat list.
 *
 * Roots are nodes whose manager is absent from the visible set — which is the
 * right definition for BOTH cases: the group's actual top (no manager at all)
 * and a manager viewing their own subtree (their manager is outside what they
 * can see). One rule, no special-casing.
 */
function buildTree(nodes: Node[]): { roots: Node[]; childrenOf: Map<string, Node[]> } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, Node[]>();
  const roots: Node[] = [];

  for (const node of nodes) {
    if (node.managerId && byId.has(node.managerId)) {
      const siblings = childrenOf.get(node.managerId) ?? [];
      siblings.push(node);
      childrenOf.set(node.managerId, siblings);
    } else {
      roots.push(node);
    }
  }

  const byName = (a: Node, b: Node) => a.name.localeCompare(b.name);
  roots.sort(byName);
  for (const siblings of childrenOf.values()) siblings.sort(byName);

  return { roots, childrenOf };
}

function TreeNode({
  node,
  childrenOf,
  locale,
  depth,
  trackLabel,
}: {
  node: Node;
  childrenOf: Map<string, Node[]>;
  locale: string;
  depth: number;
  trackLabel: (track: string) => string;
}) {
  const children = childrenOf.get(node.id) ?? [];

  return (
    <li>
      <div className="flex flex-wrap items-center gap-2 py-1.5">
        <Link
          href={`/${locale}/people/${node.id}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {node.name}
        </Link>
        <Badge variant={node.roleTrack === "C_LEVEL" ? "brand" : "default"}>
          {trackLabel(node.roleTrack)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {node.entity.code}
          {node.department ? ` · ${node.department.name}` : ""}
        </span>
        {node.status === "LEAVER" ? <Badge variant="warning">{node.status}</Badge> : null}
      </div>

      {children.length > 0 ? (
        // `ms-*` + `border-s-*` are logical properties, so the indent and its
        // guide line mirror correctly under RTL without a second rule.
        <ul className="ms-3 list-none border-s border-border ps-4">
          {children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              childrenOf={childrenOf}
              locale={locale}
              depth={depth + 1}
              trackLabel={trackLabel}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

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

  const nodes: Node[] =
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

  const { roots, childrenOf } = buildTree(nodes);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("org.title")}
        subtitle={actor.capabilities.orgWide ? t("org.subtitleOrgWide") : t("org.subtitleChain")}
      />

      <SectionCard
        title={t("org.reportingLines")}
        subtitle={t("org.countLabel", { count: nodes.length })}
      >
        {roots.length === 0 ? (
          <EmptyState description={t("org.empty")} />
        ) : (
          <ul className="list-none">
            {roots.map((root) => (
              <TreeNode
                key={root.id}
                node={root}
                childrenOf={childrenOf}
                locale={locale}
                depth={0}
                trackLabel={(track) => t(`track.${track}`)}
              />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
