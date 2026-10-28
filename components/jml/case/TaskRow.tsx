"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { DueLabel } from "../CaseBits";
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
    </span>
  );
}

/** Who a routed task is for, and who holds it (task routing). */
function useOwnerLabel() {
  const t = useTranslations("jml.case.task");
  const tv = useTranslations("jml.vocab");
  return (task: Pick<TaskDto, "assigneeRole" | "owner">) => {
    if (task.owner) return task.owner.name;
    if (task.assigneeRole === "IT" || task.assigneeRole === "FINANCE") {
      return t("deskOwner", { desk: tv(`assigneeRole.${task.assigneeRole}`) });
    }
    return null;
  };
}

function OwnerSelect({ task }: { task: TaskDto }) {
  const t = useTranslations("jml.case.task");
  const tv = useTranslations("jml.vocab");
  const lookups = useJmlLookups();
  const desk = task.assigneeRole === "IT" || task.assigneeRole === "FINANCE";
  const users = lookups.data?.hrUsers ?? [];
  const current =
    task.owner && !users.some((u) => u.id === task.owner!.id)
      ? [{ id: task.owner.id, name: task.owner.name, email: "" }]
      : [];
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
      <option value="">
        {desk ? t("deskOwner", { desk: tv(`assigneeRole.${task.assigneeRole}`) }) : t("noOwner")}
      </option>
      {[...current, ...users].map((u) => (
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

/**
 * One checklist task, compact (UX P1 perf-jml P1-3c): name, flags and a
 * relative due date on one line; ONE "Complete" button; everything else
 * (set a waiting status, delay, not applicable, due date, owner) behind
 * "More". The status chip is the only place the status is shown.
 */
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
  const ownerLabel = useOwnerLabel();
  const owner = ownerLabel(task);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const settled = ["COMPLETED", "NOT_APPLICABLE", "CANCELLED"].includes(task.status);
  const isLeave = detail.caseType === "LEAVE";
  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm text-foreground">
            <span className="text-muted-foreground">{task.code}</span> {task.name}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <Badges task={task} />
            <DueLabel value={task.dueDate} settled={settled} />
            {task.assigneeRole !== "HR" ? (
              <span className="text-muted-foreground">
                · {t("routedTo", { who: tv(`assigneeRole.${task.assigneeRole}`) })}
              </span>
            ) : null}
            {owner ? <span className="text-muted-foreground">· {owner}</span> : null}
            <TaskNotes task={task} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {editable && !settled ? <CompleteAction task={task} /> : null}
          {editable && task.status === "COMPLETED" && (!isLeave || detail.can.reopenTasks) ? (
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
          {editable && !settled ? (
            <Button size="sm" variant="ghost" aria-expanded={more} onClick={() => setMore(!more)}>
              {t("more")}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
            {t("comments", { count: task._count.comments })}
          </Button>
        </div>
      </div>
      {more && editable && !settled ? <MoreActions task={task} detail={detail} /> : null}
      {open ? <Comments task={task} canPost={detail.can.workTasks} /> : null}
    </li>
  );
}

function TaskNotes({ task }: { task: TaskDto }) {
  const t = useTranslations("jml.case.task");
  const notes = [
    task.completedAt
      ? t("completedBy", {
          name: task.completedBy?.name ?? t("someone"),
          at: task.completedAt.slice(0, 10),
        })
      : null,
    task.delayReason ? t("delayReason", { reason: task.delayReason }) : null,
    task.notApplicableReason ? t("naReason", { reason: task.notApplicableReason }) : null,
    task.externalReference ? t("reference", { ref: task.externalReference }) : null,
  ].filter(Boolean);
  if (notes.length === 0) return null;
  return <span className="text-muted-foreground">· {notes.join(" · ")}</span>;
}

/** The secondary task controls, revealed by "More". */
function MoreActions({ task, detail }: { task: TaskDto; detail: CaseDetail }) {
  const t = useTranslations("jml.case.task");
  const tv = useTranslations("jml.vocab");
  const { run, busy } = useJmlAction(t("failed"));
  const isLeave = detail.caseType === "LEAVE";
  const selectable = detail.taskStatuses.filter((s) => !NEEDS_ACTION.has(s));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2">
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
      <ReasonAction
        task={task}
        label={t("markDelayed")}
        title={t("delayTitle")}
        status="DELAYED"
        field="delayReason"
        minLength={3}
        variant="ghost"
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
    </div>
  );
}
