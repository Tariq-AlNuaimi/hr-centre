import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { employeeSelect } from "@/lib/pms/employee-select";
import { canActOnEmployee, canViewEmployee } from "@/lib/pms/permissions";
import { descendantEmployeeIds } from "@/lib/pms/org-tree";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";

/**
 * One employee's record — spec §4.2 / §4.5. Detail archetype.
 *
 * A server component: the visibility check and the compensation `select` happen
 * before any markup exists, so an unauthorised viewer's browser never receives
 * the row at all. Doing this in a client component would mean shipping the data
 * and then choosing not to draw it.
 */
export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const session = await auth();
  if (!session) redirect(`/${locale}/login`);

  const t = await getTranslations("pms");
  const actor = await resolveActor(session);

  const descendants = actor.capabilities.orgWide
    ? new Set<string>()
    : actor.employeeId
      ? await descendantEmployeeIds(actor.employeeId)
      : new Set<string>();

  // 404 rather than 403, matching the API: a manager probing ids must not be
  // able to learn that someone exists outside their chain from the difference.
  if (!canViewEmployee(actor, id, descendants)) notFound();

  const employee = await prisma.employee.findUnique({
    where: { id },
    select: employeeSelect(actor),
  });
  if (!employee) notFound();

  const canAct = canActOnEmployee(actor, { id: employee.id, managerId: employee.managerId });

  const identity = [
    { key: "odooId", label: t("employeeId"), value: employee.odooId },
    { key: "name", label: t("name"), value: employee.name },
    { key: "email", label: t("email"), value: employee.email },
    {
      key: "roleTrack",
      label: t("roleTrack"),
      value: <Badge variant="brand">{t(`track.${employee.roleTrack}`)}</Badge>,
    },
    {
      key: "status",
      label: t("status"),
      value: (
        <Badge variant={employee.status === "ACTIVE" ? "success" : "warning"}>
          {t(`statusValue.${employee.status}`)}
        </Badge>
      ),
    },
  ];

  const placement = [
    {
      key: "entity",
      label: t("entity"),
      value: `${employee.entity.code} — ${employee.entity.name}`,
    },
    {
      key: "department",
      label: t("department"),
      // §1.2 — C-Level have no department by design; say so rather than showing
      // a blank that reads as missing data.
      value: employee.department?.name ?? t("detail.noDepartmentCLevel"),
    },
    {
      key: "manager",
      label: t("manager"),
      value: employee.manager ? (
        <Link
          href={`/${locale}/people/${employee.manager.id}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          {employee.manager.name}
        </Link>
      ) : (
        t("detail.noManager")
      ),
    },
  ];

  const employment = [
    {
      key: "lastWorkingDay",
      label: t("lastWorkingDay"),
      value: employee.lastWorkingDay ? formatDate(employee.lastWorkingDay) : "—",
    },
    {
      key: "unpaidLeaveDays",
      label: t("unpaidLeaveDays"),
      value: String(employee.unpaidLeaveDays),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={employee.name}
        subtitle={t("detail.subtitle", { odooId: employee.odooId })}
      />

      <SectionCard title={t("detail.identity")}>
        <DescriptionList items={identity} columns={2} />
      </SectionCard>

      <SectionCard title={t("detail.placement")}>
        <DescriptionList items={placement} columns={2} />
      </SectionCard>

      <SectionCard title={t("detail.employment")}>
        <DescriptionList items={employment} columns={2} />
      </SectionCard>

      {/*
        §4.5 / §11.6 — the compensation block exists only when the viewer is
        entitled to it. Note the condition: `"basicSalary" in employee`. The
        server decided this when it built the SELECT; the page is reading that
        decision, not re-making it. There is no branch here that could show the
        figure to someone the query already excluded it for.
      */}
      {"basicSalary" in employee ? (
        <SectionCard title={t("detail.compensation")} subtitle={t("detail.compensationNote")}>
          <DescriptionList
            items={[
              {
                key: "basicSalary",
                label: t("basicSalary"),
                value:
                  employee.basicSalary == null ? (
                    <span className="text-muted-foreground">{t("noSalaryOnFile")}</span>
                  ) : (
                    <span className="font-mono tabular-nums">
                      {employee.basicSalary.toString()}
                    </span>
                  ),
              },
            ]}
            columns={2}
          />
        </SectionCard>
      ) : null}

      {/*
        §4.2 — tell a viewer which side of the view/act line they are on, rather
        than leaving them to discover it from a missing button in Phase 2.
      */}
      <p className="text-sm text-muted-foreground">
        {canAct ? t("detail.youCanAct") : t("detail.viewOnly")}
      </p>
    </div>
  );
}
