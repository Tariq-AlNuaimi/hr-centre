"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmployeeEditForm } from "@/components/pms/EmployeeEditForm";
import { EmployeeRecordForm } from "@/components/people/EmployeeRecordForm";
import { RecordDepartureDialog } from "@/components/pms/RecordDepartureDialog";
import type { RecordValues } from "./RecordFields";
import type { UpdateEmployeeInput } from "@/lib/validations/employee";
import type { DeparturePreview } from "@/lib/pms/departure";

type Dialog = "core" | "record" | "departure" | null;

export type RecordActionsProps = {
  employeeId: string;
  employeeName: string;
  /** Employment & placement (PUT) — only where the viewer may edit and see salary. */
  core: { initial: UpdateEmployeeInput; managerName: string | null } | null;
  /** Job, personal and ID details (PATCH) — only where the viewer may edit. */
  record: { initial: RecordValues; canEditPersonal: boolean; canEditIdDocuments: boolean } | null;
  links: { label: "startMover" | "startLeaver" | "orgChart" | "manageLogin"; href: string }[];
  /** The HR Super Admin correction (record a departure without the exit process). */
  departure: { preview: DeparturePreview | null } | null;
};

/**
 * The employee record's header actions (UX review R10): ONE Edit control and
 * one Actions menu, instead of two edit buttons and loose links. Each item is
 * offered only when the server said the viewer may do it; every write
 * re-checks on its route. Dialogs remount on each opening (`key`) so an
 * abandoned edit never reappears.
 */
export function RecordActions({
  employeeId,
  employeeName,
  core,
  record,
  links,
  departure,
}: RecordActionsProps) {
  const t = useTranslations("people.actions");
  const [open, setOpen] = useState<Dialog>(null);
  const [opening, setOpening] = useState(0);
  const show = (d: Exclude<Dialog, null>) => {
    setOpening((n) => n + 1);
    setOpen(d);
  };
  const onOpenChange = (o: boolean) => !o && setOpen(null);
  const editTargets = [core && "core", record && "record"].filter(Boolean) as Array<
    "core" | "record"
  >;
  const hasActions = links.length > 0 || departure !== null;

  return (
    <>
      {editTargets.length === 1 ? (
        <Button variant="outline" onClick={() => show(editTargets[0]!)}>
          <Pencil className="h-4 w-4" />
          {t("edit")}
        </Button>
      ) : editTargets.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Pencil className="h-4 w-4" />
              {t("edit")}
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => show("core")}>{t("editCore")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => show("record")}>{t("editRecord")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {hasActions ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              {t("actions")}
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {links.map((l) => (
              <DropdownMenuItem key={l.label} asChild>
                <Link href={l.href}>{t(l.label)}</Link>
              </DropdownMenuItem>
            ))}
            {departure ? (
              <>
                {links.length > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                  className="text-destructive-emphasis"
                  onSelect={() => show("departure")}
                >
                  {t("recordDeparture")}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {core ? (
        <EmployeeEditForm
          key={`core-${opening}`}
          employeeId={employeeId}
          initial={core.initial}
          managerName={core.managerName}
          open={open === "core"}
          onOpenChange={onOpenChange}
        />
      ) : null}
      {record ? (
        <EmployeeRecordForm
          key={`record-${opening}`}
          employeeId={employeeId}
          initial={record.initial}
          canEditPersonal={record.canEditPersonal}
          canEditIdDocuments={record.canEditIdDocuments}
          open={open === "record"}
          onOpenChange={onOpenChange}
        />
      ) : null}
      {departure ? (
        <RecordDepartureDialog
          key={`departure-${opening}`}
          employeeId={employeeId}
          employeeName={employeeName}
          preview={departure.preview}
          open={open === "departure"}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </>
  );
}
