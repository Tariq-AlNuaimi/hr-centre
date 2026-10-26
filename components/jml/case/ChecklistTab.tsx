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
import { useJmlAction } from "../use-jml";
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

/** The checklist, grouped by stage (Onboarding §10.3, Offboarding §9.6). */
export function ChecklistTab({ detail }: { detail: CaseDetail }) {
  const t = useTranslations("jml.case.checklist");
  const tv = useTranslations("jml.vocab");
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
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("summary", { done, total: applicable.length, pct: detail.completionPct })}
        </p>
        {editable ? <ManualTask detail={detail} /> : null}
      </div>
      {!LIVE.has(detail.status) ? (
        <p className="text-sm text-muted-foreground">{t("readOnly")}</p>
      ) : null}
      {all.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      {STAGES[detail.caseType].map((stage) => {
        const rows = all.filter((x) => x.stage === stage);
        if (rows.length === 0) return null;
        return (
          <section key={stage} className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">{tv(`stage.${stage}`)}</h3>
            <ul className="space-y-2">
              {rows.map((task) => (
                <TaskRow
                  key={`${task.id}:${task.version}`}
                  task={task}
                  detail={detail}
                  editable={editable}
                />
              ))}
            </ul>
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
