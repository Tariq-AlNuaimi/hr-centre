"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { DateText } from "../CaseBits";
import { useJmlAction, useJmlLookups } from "../use-jml";
import { CompleteAction, DueDateAction, ReasonAction } from "./TaskActions";
import type { CaseDetail, TaskDto } from "./types";

/** Compliance categories with a readable label (never show the raw enum code). */
const COMPLIANCE_CATEGORIES = new Set(["ROP_CLEARANCE", "VISA", "MOL", "OTHER"]);

/** Statuses chosen from the select; the rest need a reason or a confirmation. */
const NEEDS_ACTION = new Set(["COMPLETED", "NOT_APPLICABLE", "DELAYED", "CANCELLED"]);

function Badges({ task }: { task: TaskDto }) {
  const t = useTranslations("jml.case.task");
  const tv = useTranslations("jml.vocab");
  const overdue =
    task.dueDate &&
    !["COMPLETED", "NOT_APPLICABLE", "CANCELLED"].includes(task.status) &&
    task.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
  return (
    <span className="flex flex-wrap gap-1">
      <Badge
        variant={
          task.status === "COMPLETED"
            ? "success"
            : task.status === "DELAYED"
              ? "warning"
              : "outline"
        }
      >
        {tv(`taskStatus.${task.status}`)}
      </Badge>
      {!task.mandatory ? <Badge variant="default">{t("optional")}</Badge> : null}
      {task.source === "MANUAL" ? <Badge variant="info">{t("added")}</Badge> : null}
      {task.source === "REVERSAL" ? <Badge variant="warning">{t("reversal")}</Badge> : null}
      {task.statutory ? (
        <Badge variant="brand">
          {t("statutory", {
            category:
              task.complianceCategory && COMPLIANCE_CATEGORIES.has(task.complianceCategory)
                ? tv(`complianceCategory.${task.complianceCategory}`)
                : "",
          }).trim()}
        </Badge>
      ) : null}
      {task.blocking ? <Badge variant="default">{t("blocking")}</Badge> : null}
      {overdue ? <Badge variant="danger">{t("overdue")}</Badge> : null}
    </span>
  );
}

function OwnerSelect({ task }: { task: TaskDto }) {
  const t = useTranslations("jml.case.task");
  const lookups = useJmlLookups();
  const { run, busy } = useJmlAction(t("failed"));
  return (
    <NativeSelect
      aria-label={t("owner")}
      value={task.owner?.id ?? ""}
      disabled={busy}
      onChange={(e) =>
        void run(
          () =>
            apiClient.patch(`/api/jml/tasks/${task.id}`, {
              ownerUserId: e.target.value || null,
              expectedVersion: task.version,
            }),
          t("saved"),
        )
      }
    >
      <option value="">{t("noOwner")}</option>
      {(lookups.data?.hrUsers ?? []).map((u) => (
        <option key={u.id} value={u.id}>
          {u.name ?? u.email}
        </option>
      ))}
    </NativeSelect>
  );
}

function Comments({ task, canPost }: { task: TaskDto; canPost: boolean }) {
  const t = useTranslations("jml.case.task");
  const [body, setBody] = useState("");
  const { run, busy } = useJmlAction(t("failed"));
  const list = useQuery({
    queryKey: ["jml", "comments", task.id],
    queryFn: () =>
      apiClient.get<
        Array<{
          id: string;
          body: string;
          createdAt: string;
          author: { name: string | null } | null;
        }>
      >(`/api/jml/tasks/${task.id}/comments`),
  });
  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2">
      {(list.data ?? []).map((c) => (
        <p key={c.id} className="text-sm">
          <span className="font-medium">{c.author?.name ?? t("someone")}</span>{" "}
          <span className="text-xs text-muted-foreground">
            {c.createdAt.slice(0, 16).replace("T", " ")}
          </span>
          <span className="block text-foreground">{c.body}</span>
        </p>
      ))}
      {list.data?.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("noComments")}</p>
      ) : null}
      {canPost ? (
        <div className="flex gap-2">
          <Input
            aria-label={t("comment")}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("commentPlaceholder")}
          />
          <Button
            size="sm"
            disabled={busy || !body.trim()}
            onClick={async () => {
              const ok = await run(
                () => apiClient.post(`/api/jml/tasks/${task.id}/comments`, { body: body.trim() }),
                t("posted"),
              );
              if (ok) setBody("");
            }}
          >
            {t("post")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function TaskRow({
  task,
  detail,
  editable,
}: {
  task: TaskDto;
  detail: CaseDetail;
  editable: boolean;
}) {
  const t = useTranslations("jml.case.task");
  const tv = useTranslations("jml.vocab");
  const { run, busy } = useJmlAction(t("failed"));
  const [open, setOpen] = useState(false);
  const settled = ["COMPLETED", "NOT_APPLICABLE", "CANCELLED"].includes(task.status);
  const isLeave = detail.caseType === "LEAVE";
  const selectable = detail.taskStatuses.filter((s) => !NEEDS_ACTION.has(s));
  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">
            <span className="text-muted-foreground">{task.code}</span> {task.name}
          </p>
          <Badges task={task} />
          <p className="text-xs text-muted-foreground">
            {t("due")} <DateText value={task.dueDate} />
            {task.completedAt
              ? ` · ${t("completedBy", { name: task.completedBy?.name ?? t("someone"), at: task.completedAt.slice(0, 10) })}`
              : ""}
          </p>
          {task.delayReason ? (
            <p className="text-xs text-muted-foreground">
              {t("delayReason", { reason: task.delayReason })}
            </p>
          ) : null}
          {task.notApplicableReason ? (
            <p className="text-xs text-muted-foreground">
              {t("naReason", { reason: task.notApplicableReason })}
            </p>
          ) : null}
          {task.externalReference ? (
            <p className="text-xs text-muted-foreground">
              {t("reference", { ref: task.externalReference })}
            </p>
          ) : null}
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            {!settled ? (
              <>
                <NativeSelect
                  aria-label={t("status")}
                  value={selectable.includes(task.status) ? task.status : ""}
                  disabled={busy}
                  onChange={(e) =>
                    void run(
                      () =>
                        apiClient.patch(`/api/jml/tasks/${task.id}`, {
                          status: e.target.value,
                          expectedVersion: task.version,
                        }),
                      t("saved"),
                    )
                  }
                >
                  {!selectable.includes(task.status) ? (
                    <option value="">{tv(`taskStatus.${task.status}`)}</option>
                  ) : null}
                  {selectable.map((s) => (
                    <option key={s} value={s}>
                      {tv(`taskStatus.${s}`)}
                    </option>
                  ))}
                </NativeSelect>
                <CompleteAction task={task} />
                <ReasonAction
                  task={task}
                  label={t("markDelayed")}
                  title={t("delayTitle")}
                  status="DELAYED"
                  field="delayReason"
                  minLength={3}
                />
                <ReasonAction
                  task={task}
                  label={t("markNa")}
                  title={t("naTitle")}
                  status="NOT_APPLICABLE"
                  field="notApplicableReason"
                  minLength={isLeave ? 3 : 0}
                  variant="ghost"
                />
                <DueDateAction task={task} reasonRequired={isLeave} />
                <OwnerSelect task={task} />
              </>
            ) : task.status === "COMPLETED" && (!isLeave || detail.can.reopenTasks) ? (
              <ReasonAction
                task={task}
                label={t("reopen")}
                title={t("reopenTitle")}
                status="IN_PROGRESS"
                field="reason"
                minLength={isLeave ? 3 : 0}
                variant="ghost"
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
        {t("comments", { count: task._count.comments })}
      </Button>
      {open ? <Comments task={task} canPost={detail.can.workTasks} /> : null}
    </li>
  );
}
