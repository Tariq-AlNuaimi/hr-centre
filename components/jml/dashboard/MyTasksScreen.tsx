"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { FilterChips } from "@/components/shared/FilterBar";
import { apiClient } from "@/lib/api-client";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess } from "../use-jml";
import { CompleteAction, type CompletableTask } from "../case/TaskActions";
import { TaskLines, type WorkTask } from "./TaskLines";

type MyTask = WorkTask & CompletableTask;

const BUCKETS = ["OVERDUE", "DUE_TODAY", "DUE_TOMORROW", "FUTURE", "NO_DATE"] as const;

/** My tasks — every open JML task I own, overdue first (the digest links here). */
export function MyTasksScreen() {
  const t = useTranslations("jml.dashboard");
  const tv = useTranslations("jml.vocab");
  const { can, isLoading, taskWorker } = useJmlAccess();
  const allowed = can("jml.workTasks") || taskWorker;
  const [type, setType] = useState("");
  const q = useQuery({
    queryKey: ["jml", "my-tasks", type],
    queryFn: () => apiClient.get<MyTask[]>(`/api/jml/my-tasks${type ? `?caseType=${type}` : ""}`),
    enabled: allowed,
  });
  if (isLoading) return <LoadingBlock />;
  if (!allowed) return <NotPermitted title={t("myTasksTitle")} />;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("myTasksTitle")}
        subtitle={t("myTasksSubtitle")}
        actions={
          <FilterChips
            label={t("caseType")}
            value={type}
            onChange={setType}
            chips={[
              { value: "", label: t("allTypes") },
              ...["JOIN", "MOVE", "LEAVE"].map((x) => ({ value: x, label: tv(`caseType.${x}`) })),
            ]}
          />
        }
      />
      {q.isLoading ? <LoadingBlock /> : null}
      {q.isError ? <LoadFailed /> : null}
      {q.data && q.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noWork")}</p>
      ) : null}
      {BUCKETS.map((b) => {
        const tasks = (q.data ?? [])
          .filter((x) => x.bucket === b)
          .map((x) => ({ ...x, bucket: undefined }));
        return tasks.length ? (
          <SectionCard
            key={b}
            title={t("bucketTitle", { bucket: t(`bucket.${b}`), count: tasks.length })}
          >
            <TaskLines
              tasks={tasks}
              empty=""
              action={(task) => <CompleteAction task={task as MyTask} />}
            />
          </SectionCard>
        ) : null;
      })}
    </div>
  );
}
