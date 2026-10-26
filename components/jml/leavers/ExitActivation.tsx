"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { Field } from "../Field";
import { LoadingBlock } from "../States";
import { useJmlAction } from "../use-jml";
import type { ExitView } from "./types";

type Preview = { ready: boolean; blockers: string[] };
type Plan = {
  eligible: boolean;
  problems: string[];
  tasks: Array<{ code: string; name: string; dueDate: string }>;
};

/**
 * Activation (Offboarding `activateCase`): every blocker at once, then one
 * press generates the checklist, the revocation items and the assets to
 * return. A notice that started before the case was keyed is RE-KEYED instead:
 * each task already due gets its real outcome (§26.1).
 */
export function ExitActivation({ exit }: { exit: ExitView }) {
  const t = useTranslations("jml.leavers.activation");
  const { run, busy } = useJmlAction(t("failed"));
  const preview = useQuery({
    queryKey: ["jml", "exit", exit.caseId, "activation"],
    queryFn: () => apiClient.get<Preview>(`/api/jml/leavers/${exit.caseId}/activate`),
  });
  const backdated = Boolean(
    exit.noticeStartDate && exit.noticeStartDate < new Date().toISOString().slice(0, 10),
  );
  return (
    <SectionCard title={t("title")} subtitle={t("subtitle")}>
      {preview.isLoading ? <LoadingBlock /> : null}
      {preview.data && !preview.data.ready ? (
        <ul className="list-disc space-y-1 ps-5 text-sm text-status-warn-fg">
          {preview.data.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
      {preview.data?.ready ? <p className="text-sm text-muted-foreground">{t("ready")}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {exit.can.manage ? (
          <Button
            disabled={busy || !preview.data?.ready}
            onClick={() =>
              void run(
                () => apiClient.post(`/api/jml/leavers/${exit.caseId}/activate`),
                t("activated"),
              )
            }
          >
            {t("activate")}
          </Button>
        ) : null}
        {exit.can.manage && backdated && preview.data?.ready ? <RekeyDialog exit={exit} /> : null}
      </div>
    </SectionCard>
  );
}

type Answer = {
  outcome: "COMPLETED" | "NOT_APPLICABLE" | "STILL_OUTSTANDING";
  date: string;
  reason: string;
};

function RekeyDialog({ exit }: { exit: ExitView }) {
  const tr = useTranslations("jml.leavers.rekey");
  const { run, busy } = useJmlAction(tr("failed"));
  const plan = useQuery({
    queryKey: ["jml", "exit", exit.caseId, "rekey"],
    queryFn: () => apiClient.get<Plan>(`/api/jml/leavers/${exit.caseId}/rekey`),
  });
  const [reason, setReason] = useState("");
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const tasks = plan.data?.tasks ?? [];
  const answer = (code: string): Answer =>
    answers[code] ?? { outcome: "STILL_OUTSTANDING", date: "", reason: "" };
  const payload = () => ({
    reason: reason.trim(),
    dispositions: tasks.map((task) => {
      const a = answer(task.code);
      if (a.outcome === "COMPLETED")
        return { code: task.code, outcome: a.outcome, completedAt: a.date };
      if (a.outcome === "NOT_APPLICABLE")
        return { code: task.code, outcome: a.outcome, reason: a.reason };
      return { code: task.code, outcome: a.outcome };
    }),
  });
  return (
    <ActionDialog
      trigger={<Button variant="outline">{tr("open")}</Button>}
      title={tr("title")}
      description={
        plan.data?.problems.length
          ? plan.data.problems.join(" ")
          : tr("body", { count: tasks.length })
      }
      confirmLabel={tr("confirm")}
      busy={busy}
      disabled={reason.trim().length < 3 || !plan.data?.eligible}
      onConfirm={async () =>
        Boolean(
          await run(
            () => apiClient.post(`/api/jml/leavers/${exit.caseId}/rekey`, payload()),
            tr("done"),
          ),
        )
      }
    >
      <Field id="rekey-reason" label={tr("reason")}>
        <Input id="rekey-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ul className="max-h-80 space-y-3 overflow-y-auto">
        {tasks.map((task) => {
          const a = answer(task.code);
          const put = (patch: Partial<Answer>) =>
            setAnswers({ ...answers, [task.code]: { ...a, ...patch } });
          return (
            <li key={task.code} className="space-y-1 rounded-md border border-border p-2 text-sm">
              <p className="font-medium">
                {tr("taskLine", {
                  code: task.code,
                  name: task.name,
                  due: task.dueDate.slice(0, 10),
                })}
              </p>
              <NativeSelect
                aria-label={tr("outcome")}
                className="w-full"
                value={a.outcome}
                onChange={(e) => put({ outcome: e.target.value as Answer["outcome"] })}
              >
                <option value="STILL_OUTSTANDING">{tr("outstanding")}</option>
                <option value="COMPLETED">{tr("completed")}</option>
                <option value="NOT_APPLICABLE">{tr("notApplicable")}</option>
              </NativeSelect>
              {a.outcome === "COMPLETED" ? (
                <Input
                  aria-label={tr("completedOn")}
                  type="date"
                  value={a.date}
                  onChange={(e) => put({ date: e.target.value })}
                />
              ) : null}
              {a.outcome === "NOT_APPLICABLE" ? (
                <Input
                  aria-label={tr("why")}
                  value={a.reason}
                  onChange={(e) => put({ reason: e.target.value })}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </ActionDialog>
  );
}
