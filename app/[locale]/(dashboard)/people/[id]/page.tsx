import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { employeeSelect, serializeEmployee } from "@/lib/pms/employee-select";
import { canActOnEmployee, canViewEmployee } from "@/lib/pms/permissions";
import { visibilityDescendants } from "@/lib/pms/org-tree";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { EmployeeEditForm } from "@/components/pms/EmployeeEditForm";
import { ThreeSixtyResultCard } from "@/components/pms/ThreeSixtyResultCard";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import type { UpdateEmployeeInput } from "@/lib/validations/employee";

/**
 * The record in the UPDATE schema's own vocabulary, for the hand-edit form.
 *
 * `PUT /api/employees/[id]` replaces the whole row, so the form must hold every
 * field whether it offers to change it or not. Building that snapshot here — in
 * the server component that already has the row — rather than letting the form
 * fetch it keeps one read, and typing it `UpdateEmployeeInput` means a field
 * added to the schema later is a build error here rather than a column silently
 * wiped on the next save.
 *
 * `dateOfJoining` and `lastWorkingDay` are cut back to the ISO calendar DAY the
 * schema accepts: both columns are dates, §11.4 pro-rates over days, and the
 * instant's time component is not information the form should round-trip.
 */
function toUpdateInput(employee: {
  name: string;
  email: string;
  dateOfJoining: Date | null;
  departmentId: string | null;
  entityId: string;
  managerId: string | null;
  roleTrack: string;
  pmsRoles: string[];
  status: string;
  lastWorkingDay: Date | null;
  unpaidLeaveDays: number;
  basicSalary: string | null;
}): UpdateEmployeeInput {
  return {
    name: employee.name,
    email: employee.email,
    dateOfJoining: employee.dateOfJoining?.toISOString().slice(0, 10) ?? null,
    departmentId: employee.departmentId,
    entityId: employee.entityId,
    managerId: employee.managerId,
    roleTrack: employee.roleTrack as UpdateEmployeeInput["roleTrack"],
    pmsRoles: employee.pmsRoles as UpdateEmployeeInput["pmsRoles"],
    basicSalary: employee.basicSalary,
    status: employee.status as UpdateEmployeeInput["status"],
    lastWorkingDay: employee.lastWorkingDay?.toISOString().slice(0, 10) ?? null,
    unpaidLeaveDays: employee.unpaidLeaveDays,
  };
}

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

  const descendants = await visibilityDescendants(actor);

  // 404 rather than 403, matching the API: a manager probing ids must not be
  // able to learn that someone exists outside their chain from the difference.
  if (!canViewEmployee(actor, id, descendants)) notFound();

  const employee = await prisma.employee.findUnique({
    where: { id },
    select: employeeSelect(actor),
  });
  if (!employee) notFound();

  const canAct = canActOnEmployee(actor, { id: employee.id, managerId: employee.managerId });

  /*
    §4.5 / ADR-067 — compensation goes through the ONE serializer, as every
    other read path does. `serializeEmployee` opens the ciphertext only when the
    `select` above carried it, so the entitlement gate is still the query and
    this page is reading that decision rather than re-making it.

    `undefined` means "not entitled to see it"; `null` means "entitled, none on
    file". The two are different facts and the card below renders them
    differently.

    This page used to hand-roll the check as `"basicSalary" in employee` — a key
    `employeeSelect` has not returned since compensation moved to an encrypted
    envelope (it selects `basicSalaryEnc`). So the whole compensation block was
    dead: HR saw no salary on any individual record. It type-checked because
    `in` narrows on any key, and it was the only employee read in the app that
    skipped the serializer.
  */
  const basicSalary = serializeEmployee(employee).basicSalary;

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
          className="text-primary-emphasis underline-offset-4 hover:underline"
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
      key: "dateOfJoining",
      label: t("dateOfJoining"),
      // §3.3's anchor for §11's eligibility gate and pro-ration. "Not on file"
      // is said out loud rather than shown as a dash: §11.7 REFUSES to compute a
      // bonus without it, so an absent date is an outstanding action, not a
      // cosmetic gap — and this is the only screen that can now show it.
      value: employee.dateOfJoining ? (
        formatDate(employee.dateOfJoining)
      ) : (
        <span className="text-amber-700 dark:text-amber-300">{t("noDateOfJoining")}</span>
      ),
    },
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
        actions={
          /*
            §4.1's configure column — "HR Super Admin: Yes — full", everyone else
            "No", which is the same gate `PUT /api/employees/[id]` enforces. An
            HRBP or a line manager is not shown a control they would be refused.

            The `basicSalary !== undefined` guard is not a second permission
            check; it is the type system's proof that the snapshot below carries
            a real salary rather than a hole. `configure` implies
            `canViewCompensation` (HR Super Admin ⊂ HR), so the branch is never
            actually taken — but if that ever stopped being true, the form must
            not be the thing that discovers it by encrypting `null` over payroll.
          */
          actor.capabilities.configure && basicSalary !== undefined ? (
            <EmployeeEditForm
              employeeId={employee.id}
              initial={toUpdateInput({ ...employee, basicSalary })}
              managerName={employee.manager?.name ?? null}
            />
          ) : null
        }
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
        entitled to it. `basicSalary` is `undefined` exactly when the SELECT
        above omitted the ciphertext column; the page is reading the server's
        decision, not re-making it. There is no branch here that could show the
        figure to someone the query already excluded it for.
      */}
      {basicSalary !== undefined ? (
        <SectionCard title={t("detail.compensation")} subtitle={t("detail.compensationNote")}>
          <DescriptionList
            items={[
              {
                key: "basicSalary",
                label: t("basicSalary"),
                value:
                  basicSalary === null ? (
                    <span className="text-muted-foreground">{t("noSalaryOnFile")}</span>
                  ) : (
                    <span className="font-mono tabular-nums">{basicSalary}</span>
                  ),
              },
            ]}
            columns={2}
          />
        </SectionCard>
      ) : null}

      {/*
        §9.8's individual 360 report, on the record §13.6 already sends HR and
        the executive viewers to for "full drill-down on demand into any
        individual's complete record". Gated on the same org-wide capability the
        route itself enforces, so a manager never fires a request that will 403
        — and never sees a placeholder hinting the figure exists.

        It deliberately does NOT go on the 360 console: that screen shows who
        was assigned to rate whom (§9.4), and pairing that with what came back
        is the join §13.1's anonymity exists to prevent.
      */}
      {actor.capabilities.orgWide ? <ThreeSixtyResultCard employeeId={employee.id} /> : null}

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
