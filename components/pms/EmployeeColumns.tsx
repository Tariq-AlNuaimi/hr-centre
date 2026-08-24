"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";

export interface EmployeeRecord {
  id: string;
  odooId: string;
  name: string;
  email: string;
  roleTrack: string;
  status: string;
  managerId: string | null;
  department: { id: string; name: string } | null;
  entity: { id: string; code: string; name: string };
  manager: { id: string; name: string; email: string } | null;
  /**
   * Present ONLY for HR and executive viewers (§4.5). Optional in the type, not
   * nullable — so a column cannot be written on the assumption that the field is
   * always there and merely empty.
   */
  basicSalary?: string | null;
}

/** §1.3 — the five tracks. C-Level reads as the exception it is. */
const trackTone: Record<string, BadgeProps["variant"]> = {
  C_LEVEL: "brand",
  DIRECTOR: "default",
  MANAGER: "default",
  LEAD: "default",
  INDIVIDUAL: "default",
};

/**
 * §12.1 — a leaver keeps their record and history; the status is a state, not a
 * deletion. Toned as a warning rather than a danger for exactly that reason:
 * nothing has gone wrong, the person has left.
 */
const statusTone: Record<string, BadgeProps["variant"]> = {
  ACTIVE: "success",
  LEAVER: "warning",
};

export function getEmployeeColumns({
  showCompensation,
  locale,
  t,
  formatSalary,
}: {
  locale: string;
  /**
   * Whether to render the compensation column (§4.5). The API already omits the
   * field for an unentitled actor — this only avoids rendering a permanently
   * empty column for them. It is NOT the control.
   */
  showCompensation: boolean;
  t: (key: string) => string;
  formatSalary: (value: string) => string;
}) {
  return [
    {
      title: t("employeeId"),
      dataIndex: "odooId",
      key: "odooId",
      sorter: true,
      render: (value: string) => <span className="font-mono text-xs">{value}</span>,
    },
    {
      title: t("name"),
      dataIndex: "name",
      key: "name",
      sorter: true,
      // A real link rather than a row-level onClick: a clickable <tr> is
      // unreachable by keyboard and invisible to a screen reader, and it gives
      // the user no target to open in a new tab.
      render: (value: string, record: EmployeeRecord) => (
        <div className="min-w-0">
          <Link
            href={`/${locale}/people/${record.id}`}
            className="block truncate font-medium text-foreground underline-offset-4 hover:underline"
          >
            {value}
          </Link>
          <div className="truncate text-xs text-muted-foreground">{record.email}</div>
        </div>
      ),
    },
    {
      title: t("entity"),
      key: "entity",
      render: (_: unknown, record: EmployeeRecord) => record.entity.code,
    },
    {
      title: t("department"),
      key: "department",
      // §1.2 — a C-Level employee has no department, by design. An em-dash says
      // "not applicable"; an empty cell would read as missing data.
      render: (_: unknown, record: EmployeeRecord) => record.department?.name ?? "—",
    },
    {
      title: t("roleTrack"),
      dataIndex: "roleTrack",
      key: "roleTrack",
      sorter: true,
      render: (value: string) => (
        <Badge variant={trackTone[value] ?? "default"}>{t(`track.${value}`)}</Badge>
      ),
    },
    {
      title: t("manager"),
      key: "manager",
      render: (_: unknown, record: EmployeeRecord) => record.manager?.name ?? "—",
    },
    {
      title: t("status"),
      dataIndex: "status",
      key: "status",
      sorter: true,
      render: (value: string) => (
        <Badge variant={statusTone[value] ?? "default"}>{t(`statusValue.${value}`)}</Badge>
      ),
    },
    ...(showCompensation
      ? [
          {
            title: t("basicSalary"),
            key: "basicSalary",
            render: (_: unknown, record: EmployeeRecord) =>
              record.basicSalary == null ? (
                // "Not recorded" and "not permitted to see" are different facts.
                // An entitled viewer seeing this knows the figure is missing.
                <span className="text-muted-foreground">{t("noSalaryOnFile")}</span>
              ) : (
                <span className="font-mono text-xs tabular-nums">
                  {formatSalary(record.basicSalary)}
                </span>
              ),
          },
        ]
      : []),
  ];
}
