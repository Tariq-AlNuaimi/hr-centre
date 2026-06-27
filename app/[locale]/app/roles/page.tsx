import { getTranslations, getFormatter } from "next-intl/server";
import { Plus, FileText } from "lucide-react";
import { requireSession } from "@/lib/authz";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { listRoleProfiles } from "@/lib/services/roleProfile";
import type { RoleProfileStatus } from "@/generated/prisma/client";
import { StatusBadge } from "./StatusBadge";

const PAGE_SIZE = 20;

// Role-profiles list (UI-SPEC D.2). RSC reads via the service (no fetch); managers
// view read-only, only HR_ADMIN sees the authoring CTA (server is the real gate).
export default async function RolesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  const { page: pageParam } = await searchParams;
  const session = await requireSession(locale);
  const orgId = session.user.orgId;
  const isAdmin = session.user.role === "HR_ADMIN";

  const t = await getTranslations("roleProfiles");
  const tStatus = await getTranslations("roleProfiles.status");
  const format = await getFormatter();

  const page = Math.max(1, Number(pageParam) || 1);
  const { data, total } = orgId
    ? await listRoleProfiles(orgId, {
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      })
    : { data: [], total: 0 };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")}>
        {isAdmin && (
          <Button asChild>
            <Link href="/app/roles/new">
              <Plus className="size-4" />
              {t("newProfile")}
            </Link>
          </Button>
        )}
      </PageHeader>

      {data.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <span className="rounded-xl bg-secondary p-3 text-accent">
            <FileText className="size-6" />
          </span>
          <div className="flex flex-col items-center gap-1.5">
            <h2 className="font-display text-lg font-semibold text-foreground">
              {t("emptyTitle")}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {isAdmin ? t("emptyBodyAdmin") : t("emptyBodyManager")}
            </p>
          </div>
          {isAdmin && (
            <Button asChild className="mt-1">
              <Link href="/app/roles/new">
                <Plus className="size-4" />
                {t("newProfile")}
              </Link>
            </Button>
          )}
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colFamily")}</TableHead>
                <TableHead>{t("colTitle")}</TableHead>
                <TableHead className="text-end">{t("colVersion")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead className="text-end">{t("colCompetencies")}</TableHead>
                <TableHead>{t("colUpdated")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.id} className="group">
                  <TableCell className="text-muted-foreground">
                    {row.roleFamily.name}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/app/roles/${row.id}`}
                      className="text-foreground underline-offset-4 hover:text-accent hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-end tabular-nums text-muted-foreground">
                    v{row.version}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={row.status as RoleProfileStatus}
                      label={tStatus(row.status)}
                    />
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {row._count.competencies}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format.dateTime(row.updatedAt, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {totalPages > 1 && (
        <nav
          className="mt-4 flex items-center justify-between text-sm text-muted-foreground"
          aria-label={t("pagination")}
        >
          <span className="tabular-nums">
            {t("pageOf", { page, totalPages })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              disabled={page <= 1}
              aria-disabled={page <= 1}
            >
              <Link href={`/app/roles?page=${page - 1}`}>{t("prev")}</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              aria-disabled={page >= totalPages}
            >
              <Link href={`/app/roles?page=${page + 1}`}>{t("next")}</Link>
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
