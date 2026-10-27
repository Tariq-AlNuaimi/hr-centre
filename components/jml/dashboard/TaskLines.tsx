"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export type WorkTask = {
  id: string;
  code: string;
  name: string;
  dueDate: string | null;
  status: string;
  bucket?: string;
  owner?: { name: string | null } | null;
  case: { id: string; caseRef: string; caseType: string; employee: { name: string } };
};

/** A compact list of tasks with their case, due date and (optionally) owner. */
export function TaskLines({
  tasks,
  empty,
  showOwner = false,
}: {
  tasks: WorkTask[];
  empty: string;
  showOwner?: boolean;
}) {
  const t = useTranslations("jml.dashboard");
  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-1 text-sm">
      {tasks.map((task) => (
        <li key={task.id} className="flex flex-wrap items-baseline gap-x-2">
          {task.bucket ? (
            <span className="text-xs font-medium text-muted-foreground">
              {t(`bucket.${task.bucket}`)}
            </span>
          ) : null}
          <Link
            href={`/jml/cases/${task.case.id}`}
            className="font-medium text-primary hover:underline"
          >
            {task.case.caseRef}
          </Link>
          <span>
            {t("taskLine", { code: task.code, name: task.name, who: task.case.employee.name })}
          </span>
          <span className="text-xs text-muted-foreground">
            {task.dueDate ? t("due", { date: task.dueDate.slice(0, 10) }) : t("noDate")}
            {showOwner ? ` · ${task.owner?.name ?? t("unowned")}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
