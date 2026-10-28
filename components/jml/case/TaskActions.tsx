"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { Field } from "../Field";
import { useJmlAction } from "../use-jml";
import type { TaskDto } from "./types";

/**
 * The task actions that need more than a status: complete (with the
 * confirmation trio when the task asks for it — F6, now possible from the
 * screen), not applicable / delayed with a reason, reopen, a due-date change.
 */

function usePatch(task: Pick<TaskDto, "id" | "version">) {
  const t = useTranslations("jml.case.task");
  const { run, busy } = useJmlAction(t("failed"));
  const patch = async (body: Record<string, unknown>, done: string) =>
    Boolean(
      await run(
        () =>
          apiClient.patch(`/api/jml/tasks/${task.id}`, { ...body, expectedVersion: task.version }),
        done,
      ),
    );
  return { patch, busy, t };
}

/** What completing needs — also used by My tasks, where routed workers complete in place. */
export type CompletableTask = Pick<
  TaskDto,
  | "id"
  | "version"
  | "confirmationRequired"
  | "confirmingParty"
  | "confirmationDate"
  | "externalReference"
>;

export function CompleteAction({ task }: { task: CompletableTask }) {
  const { patch, busy, t } = usePatch(task);
  const [party, setParty] = useState(task.confirmingParty ?? "");
  const [date, setDate] = useState(
    task.confirmationDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [ref, setRef] = useState(task.externalReference ?? "");
  if (!task.confirmationRequired) {
    return (
      <Button
        size="sm"
        disabled={busy}
        onClick={() => void patch({ status: "COMPLETED" }, t("completed"))}
      >
        {t("complete")}
      </Button>
    );
  }
  return (
    <ActionDialog
      trigger={<Button size="sm">{t("complete")}</Button>}
      title={t("confirmTitle")}
      description={t("confirmBody")}
      confirmLabel={t("complete")}
      busy={busy}
      disabled={!party.trim() || !date || !ref.trim()}
      onConfirm={() =>
        patch(
          {
            status: "COMPLETED",
            confirmingParty: party.trim(),
            confirmationDate: date,
            externalReference: ref.trim(),
          },
          t("completed"),
        )
      }
    >
      <Field id={`cp-${task.id}`} label={t("confirmingParty")}>
        <Input id={`cp-${task.id}`} value={party} onChange={(e) => setParty(e.target.value)} />
      </Field>
      <Field id={`cd-${task.id}`} label={t("confirmationDate")}>
        <Input
          id={`cd-${task.id}`}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <Field id={`cr-${task.id}`} label={t("externalReference")}>
        <Input id={`cr-${task.id}`} value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}

export function ReasonAction({
  task,
  label,
  title,
  status,
  field,
  minLength,
  variant = "outline",
}: {
  task: TaskDto;
  label: string;
  title: string;
  status: string;
  field: "delayReason" | "notApplicableReason" | "reason";
  minLength: number;
  variant?: "outline" | "ghost";
}) {
  const { patch, busy, t } = usePatch(task);
  const [reason, setReason] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant={variant}>
          {label}
        </Button>
      }
      title={title}
      confirmLabel={label}
      busy={busy}
      disabled={reason.trim().length < minLength}
      onConfirm={() => patch({ status, [field]: reason.trim() || null }, t("saved"))}
    >
      <Field id={`r-${field}-${task.id}`} label={t("reason")}>
        <Input
          id={`r-${field}-${task.id}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </ActionDialog>
  );
}

export function DueDateAction({
  task,
  reasonRequired,
}: {
  task: TaskDto;
  reasonRequired: boolean;
}) {
  const { patch, busy, t } = usePatch(task);
  const [date, setDate] = useState(task.dueDate?.slice(0, 10) ?? "");
  const [reason, setReason] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost">
          {t("changeDue")}
        </Button>
      }
      title={t("changeDueTitle")}
      confirmLabel={t("save")}
      busy={busy}
      disabled={!date || (reasonRequired && !reason.trim())}
      onConfirm={() =>
        patch({ dueDate: date, dueDateOverrideReason: reason.trim() || null }, t("saved"))
      }
    >
      <Field id={`dd-${task.id}`} label={t("dueDate")}>
        <Input
          id={`dd-${task.id}`}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <Field id={`ddr-${task.id}`} label={t("overrideReason")}>
        <Input id={`ddr-${task.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}
