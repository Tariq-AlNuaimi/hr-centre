import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { isPendingEmployeeId } from "@/lib/people/pending-id";

type T = (key: string) => string;

/** The fields of the record the header and the Overview / Job tabs read. */
export type RecordViewEmployee = {
  odooId: string;
  email: string;
  status: string;
  roleTrack: string;
  dateOfJoining: Date | null;
  lastWorkingDay: Date | null;
  unpaidLeaveDays: number;
  entity: { code: string; name: string };
  department: { name: string } | null;
  team: { name: string } | null;
  manager: { id: string; name: string } | null;
};

type Item = { key: string; label: string; value: ReactNode };

const STATUS_TONE: Record<string, "success" | "info" | "warning"> = {
  ACTIVE: "success",
  PRE_JOINER: "info",
};

/**
 * The employee record's display pieces (UX review R10): status chip, reporting
 * line, and the Overview / Job & placement description lists. Pure layout over
 * the row the page's gated select returned.
 */
export function recordView(
  t: T,
  employee: RecordViewEmployee,
  directorate: { name: string } | null,
  locale: string,
) {
  const status = (
    <Badge variant={STATUS_TONE[employee.status] ?? "warning"}>
      {t(`statusValue.${employee.status}`)}
    </Badge>
  );
  const manager = employee.manager ? (
    <Link
      href={`/${locale}/people/${employee.manager.id}`}
      className="text-primary-emphasis underline-offset-4 hover:underline"
    >
      {employee.manager.name}
    </Link>
  ) : null;
  const managerItem: Item = {
    key: "manager",
    label: t("manager"),
    value: manager ?? t("detail.noManager"),
  };
  // §3.3's anchor for §11's eligibility gate and pro-ration: an absent date is
  // an outstanding action, so it is said out loud rather than shown as a dash.
  const joined = employee.dateOfJoining ? (
    formatDate(employee.dateOfJoining)
  ) : (
    <span className="text-amber-700 dark:text-amber-300">{t("noDateOfJoining")}</span>
  );

  const summary: Item[] = [
    {
      key: "odooId",
      label: t("employeeId"),
      value: isPendingEmployeeId(employee.odooId) ? (
        <Badge variant="outline">{t("pendingId")}</Badge>
      ) : (
        <span className="font-mono">{employee.odooId}</span>
      ),
    },
    { key: "email", label: t("email"), value: employee.email },
    { key: "status", label: t("status"), value: status },
    {
      key: "roleTrack",
      label: t("roleTrack"),
      value: <Badge variant="brand">{t(`track.${employee.roleTrack}`)}</Badge>,
    },
    managerItem,
    { key: "dateOfJoining", label: t("dateOfJoining"), value: joined },
  ];

  const placement: Item[] = [
    {
      key: "entity",
      label: t("entity"),
      value: `${employee.entity.code} — ${employee.entity.name}`,
    },
    {
      key: "department",
      label: t("department"),
      // §1.2 — C-Level have no department by design; say so rather than a blank.
      value: employee.department?.name ?? t("detail.noDepartmentCLevel"),
    },
    // HR Centre F-a — directorate and team rows only when the org uses them.
    ...(directorate
      ? [{ key: "directorate", label: t("detail.directorate"), value: directorate.name }]
      : []),
    ...(employee.team ? [{ key: "team", label: t("detail.team"), value: employee.team.name }] : []),
    managerItem,
  ];

  const employment: Item[] = [
    { key: "dateOfJoining", label: t("dateOfJoining"), value: joined },
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

  return { status, manager, summary, placement, employment };
}
