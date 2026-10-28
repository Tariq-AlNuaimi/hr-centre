"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { Field } from "../Field";
import { LoadFailed, LoadingBlock } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";
import { FilterChips } from "@/components/shared/FilterBar";
import { daysUntil } from "@/lib/format";
import { RoutingWarnings } from "./RoutingWarnings";
import { TaskRow } from "./TaskRow";
import { LIVE, type CaseDetail, type TaskDto } from "./types";

const STAGES: Record<CaseDetail["caseType"], string[]> = {
  JOIN: ["PREBOARDING", "FIRST_DAY", "FIRST_WEEK"],
  MOVE: ["PREBOARDING", "FIRST_DAY", "FIRST_WEEK"],
  LEAVE: [
    "STAGE_1_RESIGNATION",
    "STAGE_2_IMMEDIATE",
    "STAGE_3_NOTICE_HANDOVER",
    "STAGE_4_SETTLEMENT",
  ],
};

const SETTLED = new Set(["COMPLETED", "NOT_APPLICABLE", "CANCELLED"]);
type View = "all" | "mine" | "overdue" | "blocking";

/** Which open tasks a filter keeps (UX P1 perf-jml P1-3d). Pure. */
function matches(view: View, task: TaskDto, userId: string | null): boolean {
  if (view === "mine") return task.owner?.id === userId;
  if (view === "overdue") return task.dueDate !== null && daysUntil(task.dueDate) < 0;
  if (view === "blocking") return task.blocking;
  return true;
}

/**
 * The checklist, grouped by stage (Onboarding §10.3, Offboarding §9.6). UX P1:
 * open work first — each stage's settled tasks fold into "N done" — with
 * Mine / Overdue / Blocking filters over the open tasks.
 */
export function ChecklistTab({ detail }: { detail: CaseDetail }) {
  const t = useTranslations("jml.case.checklist");
  const tv = useTranslations("jml.vocab");
  const { userId } = useJmlAccess();
  const [view, setView] = useState<View>("all");
  const tasks = useQuery({
    queryKey: ["jml", "case", detail.id, "tasks"],
    queryFn: () => apiClient.get<TaskDto[]>(`/api/jml/cases/${detail.id}/tasks`),
  });
  if (tasks.isLoading) return <LoadingBlock />;
  if (tasks.isError || !tasks.data) return <LoadFailed />;
  const editable = LIVE.has(detail.status) && detail.can.workTasks;
  const all = tasks.data;
  const applicable = all.filter(
    (x) => x.mandatory && x.status !== "NOT_APPLICABLE" && x.status !== "CANCELLED",
  );
  const done = applicable.filter((x) => x.status === "COMPLETED").length;
  const open = all.filter((x) => !SETTLED.has(x.status));
  const count = (v: View) => open.filter((x) => matches(v, x, userId)).length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("summary", { done, total: applicable.length, pct: detail.completionPct })}
        </p>
        {editable ? <ManualTask detail={detail} /> : null}
      </div>
      <RoutingWarnings detail={detail} />
      {!LIVE.has(detail.status) ? (
        <p className="text-sm text-muted-foreground">{t("readOnly")}</p>
      ) : null}
      {all.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      {open.length > 0 ? (
        <FilterChips
          label={t("filterLabel")}
          value={view}
          onChange={(v) => setView(v as View)}
          chips={(["all", "mine", "overdue", "blocking"] as const).map((v) => ({
            value: v,
            label: t(`filter.${v}`),
            count: count(v),
          }))}
        />
      ) : null}
      {STAGES[detail.caseType].map((stage) => {
        const rows = all.filter((x) => x.stage === stage);
        if (rows.length === 0) return null;
        const openRows = rows.filter((x) => !SETTLED.has(x.status) && matches(view, x, userId));
        const settledRows = rows.filter((x) => SETTLED.has(x.status));
        const row = (task: TaskDto) => (
          <TaskRow
            key={`${task.id}:${task.version}`}
            task={task}
            detail={detail}
            editable={editable}
          />
        );
        return (
          <section key={stage} className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">
              {tv(`stage.${stage}`)}{" "}
              <span className="font-normal text-muted-foreground">
                {t("stageCount", {
                  open: rows.length - settledRows.length,
                  done: settledRows.length,
                })}
              </span>
            </h3>
            {openRows.length > 0 ? (
              <ul className="divide-y divide-border rounded-md border border-border">
                {openRows.map(row)}
              </ul>
            ) : null}
            {settledRows.length > 0 && view === "all" ? (
              <details className="rounded-md border border-border">
                <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground">
                  {t("doneCount", { count: settledRows.length })}
                </summary>
                <ul className="divide-y divide-border border-t border-border">
                  {settledRows.map(row)}
                </ul>
              </details>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function ManualTask({ detail }: { detail: CaseDetail }) {
  const tm = useTranslations("jml.case.checklist.manual");
  const tv = useTranslations("jml.vocab");
  const { run, busy } = useJmlAction(tm("failed"));
  const [name, setName] = useState("");
  const [stage, setStage] = useState(STAGES[detail.caseType][0]!);
  const [dueDate, setDueDate] = useState("");
  const [mandatory, setMandatory] = useState(true);
  const [comment, setComment] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="outline">
          {tm("add")}
        </Button>
      }
      title={tm("title")}
      description={tm("body")}
      confirmLabel={tm("add")}
      busy={busy}
      disabled={!name.trim() || !dueDate || comment.trim().length < 3}
      onConfirm={async () =>
        Boolean(
          await run(
            () =>
              apiClient.post(`/api/jml/cases/${detail.id}/tasks`, {
                name: name.trim(),
                stage,
                dueDate,
                mandatory,
                comment: comment.trim(),
              }),
            tm("added"),
          ),
        )
      }
    >
      <Field id="mt-name" label={tm("name")}>
        <Input id="mt-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="mt-stage" label={tm("stage")}>
        <NativeSelect
          id="mt-stage"
          className="w-full"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
        >
          {STAGES[detail.caseType].map((s) => (
            <option key={s} value={s}>
              {tv(`stage.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="mt-due" label={tm("dueDate")}>
        <Input
          id="mt-due"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </Field>
      <Field id="mt-comment" label={tm("comment")} hint={tm("commentHint")}>
        <Input id="mt-comment" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={mandatory}
          onChange={(e) => setMandatory(e.target.checked)}
        />
        {tm("mandatory")}
      </label>
    </ActionDialog>
  );
}
