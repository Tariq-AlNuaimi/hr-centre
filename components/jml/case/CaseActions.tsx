"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { useNotify } from "@/hooks/use-notify";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { Field } from "../Field";
import { useJmlAction, useJmlLookups } from "../use-jml";
import { LIVE, type CaseDetail } from "./types";
import { WithdrawExit } from "../leavers/WithdrawExit";
import { CloseExit } from "../leavers/CloseExit";

/**
 * Every case-level action the sources had — including those that were API-only
 * (reassign owner, legal hold, archive of a cancelled case, IT readiness, Odoo
 * id). Visibility follows the actor's affordances; the routes re-check.
 */

const today = () => new Date().toISOString().slice(0, 10);

function useAct() {
  const t = useTranslations("jml.case.actions");
  const { run, busy } = useJmlAction(t("failed"));
  const act = async (fn: () => Promise<unknown>, done: string) => Boolean(await run(fn, done));
  return { act, busy, t };
}

function DateAction({
  caseId,
  label,
  title,
  description,
  path,
  field,
  done,
  initial,
}: {
  caseId: string;
  label: string;
  title: string;
  description: string;
  path: string;
  field: string;
  done: string;
  initial: string;
}) {
  const { act, busy } = useAct();
  const [value, setValue] = useState(initial);
  return (
    <ActionDialog
      trigger={
        <Button variant="outline" size="sm">
          {label}
        </Button>
      }
      title={title}
      description={description}
      confirmLabel={label}
      busy={busy}
      disabled={!value}
      onConfirm={() =>
        act(() => apiClient.post(`/api/jml/cases/${caseId}/${path}`, { [field]: value }), done)
      }
    >
      <Field id={`${path}-date`} label={title}>
        <Input
          id={`${path}-date`}
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
    </ActionDialog>
  );
}

function TextAction({
  caseId,
  label,
  title,
  description,
  path,
  method = "post",
  build,
  minLength,
  done,
  destructive,
  fieldLabel,
}: {
  caseId: string;
  label: string;
  title: string;
  description: string;
  path: string;
  method?: "post" | "put";
  build: (text: string) => unknown;
  minLength: number;
  done: string;
  destructive?: boolean;
  fieldLabel: string;
}) {
  const { act, busy } = useAct();
  const [text, setText] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button variant="outline" size="sm">
          {label}
        </Button>
      }
      title={title}
      description={description}
      confirmLabel={label}
      destructive={destructive}
      busy={busy}
      disabled={text.trim().length < minLength}
      onConfirm={() =>
        act(() => apiClient[method](`/api/jml/cases/${caseId}/${path}`, build(text.trim())), done)
      }
    >
      {minLength > 0 ? (
        <Field id={`${path}-text`} label={fieldLabel}>
          <Input id={`${path}-text`} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      ) : null}
    </ActionDialog>
  );
}

function ReassignAction({ detail }: { detail: CaseDetail }) {
  const { act, busy, t } = useAct();
  const lookups = useJmlLookups();
  const [owner, setOwner] = useState("");
  const [moveTasks, setMoveTasks] = useState(true);
  return (
    <ActionDialog
      trigger={
        <Button variant="outline" size="sm">
          {t("reassign")}
        </Button>
      }
      title={t("reassignTitle")}
      description={t("reassignBody", { name: detail.hrOwner?.name ?? t("nobody") })}
      confirmLabel={t("reassign")}
      busy={busy}
      disabled={!owner}
      onConfirm={() =>
        act(
          () =>
            apiClient.put(`/api/jml/cases/${detail.id}/owner`, {
              hrOwnerUserId: owner,
              moveOpenTasks: moveTasks,
            }),
          t("reassigned"),
        )
      }
    >
      <Field id="owner-pick" label={t("newOwner")}>
        <NativeSelect
          id="owner-pick"
          className="w-full"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">{t("choose")}</option>
          {(lookups.data?.hrUsers ?? [])
            .filter((u) => u.id !== detail.hrOwner?.id)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={moveTasks}
          onChange={(e) => setMoveTasks(e.target.checked)}
        />
        {t("moveTasks")}
      </label>
    </ActionDialog>
  );
}

type ItOutcome = { status: "skipped" | "submitted" | "failed"; reason?: string };

/** Honest about the outcome: off, failed and submitted read differently (never a green toast over a skip). */
function SubmitToIt({ caseId }: { caseId: string }) {
  const t = useTranslations("jml.case.actions");
  const { run, busy } = useJmlAction(t("failed"));
  const { success, error } = useNotify();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        const r = await run(() => apiClient.post<ItOutcome>(`/api/jml/cases/${caseId}/it-intake`));
        if (!r) return;
        if (r.status === "submitted") success(t("itSubmitted"));
        else error(r.reason ?? t("failed"));
      }}
    >
      {t("submitIt")}
    </Button>
  );
}

function JoinActions({ detail }: { detail: CaseDetail }) {
  const { act, busy, t } = useAct();
  const j = detail.joinDetail;
  if (!j || detail.status !== "ACTIVE" || !detail.can.manage) return null;
  return (
    <>
      {!j.actualStartDate ? (
        <>
          <DateAction
            caseId={detail.id}
            label={t("confirmStart")}
            title={t("confirmStartTitle")}
            description={t("confirmStartBody")}
            path="actual-start"
            field="actualStartDate"
            done={t("started")}
            initial={today()}
          />
          <DateAction
            caseId={detail.id}
            label={t("changeStart")}
            title={t("changeStartTitle")}
            description={t("changeStartBody")}
            path="start-date"
            field="plannedStartDate"
            done={t("startMoved")}
            initial={j.plannedStartDate?.slice(0, 10) ?? ""}
          />
        </>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() =>
          void act(
            () =>
              apiClient.post(`/api/jml/cases/${detail.id}/it-readiness`, {
                confirmed: !j.itReadinessConfirmed,
              }),
            j.itReadinessConfirmed ? t("itWithdrawn") : t("itConfirmed"),
          )
        }
      >
        {j.itReadinessConfirmed ? t("withdrawIt") : t("confirmIt")}
      </Button>
      <SubmitToIt caseId={detail.id} />
    </>
  );
}

function LeaveActions({ detail, live }: { detail: CaseDetail; live: boolean }) {
  if (detail.caseType !== "LEAVE") return null;
  return (
    <>
      {detail.can.manage && (live || detail.status === "DRAFT") ? (
        <WithdrawExit caseId={detail.id} version={detail.version} />
      ) : null}
      {detail.can.close && live ? <CloseExit caseId={detail.id} version={detail.version} /> : null}
    </>
  );
}

export function CaseActions({ detail }: { detail: CaseDetail }) {
  const t = useTranslations("jml.case.actions");
  const live = LIVE.has(detail.status);
  const closed =
    detail.status === "CANCELLED" || detail.status === "ARCHIVED" || detail.status === "CLOSED";
  const s = detail.can.supervise;
  return (
    <div className="flex flex-wrap gap-2">
      <JoinActions detail={detail} />
      {detail.can.manage && !detail.employee.odooId && detail.status !== "DRAFT" ? (
        <TextAction
          caseId={detail.id}
          label={t("recordOdoo")}
          title={t("recordOdooTitle")}
          description={t("recordOdooBody")}
          fieldLabel={t("odooId")}
          path="odoo-id"
          build={(odooId) => ({ odooId })}
          minLength={1}
          done={t("odooRecorded")}
        />
      ) : null}
      {detail.can.manage && live && detail.caseType !== "LEAVE" ? (
        <TextAction
          caseId={detail.id}
          label={t("cancel")}
          title={t("cancelTitle")}
          description={t("cancelBody")}
          fieldLabel={t("reason")}
          path="cancel"
          build={(reason) => ({ reason })}
          minLength={10}
          done={t("cancelled")}
          destructive
        />
      ) : null}
      <LeaveActions detail={detail} live={live} />
      {s && !live && detail.status !== "ARCHIVED" && detail.status !== "DRAFT" ? (
        <TextAction
          caseId={detail.id}
          label={t("archive")}
          title={t("archiveTitle")}
          description={t("archiveBody")}
          fieldLabel=""
          path="archive"
          build={() => ({})}
          minLength={0}
          done={t("archived")}
        />
      ) : null}
      {s && !closed ? <ReassignAction detail={detail} /> : null}
      {s && !detail.anonymisedAt ? (
        detail.legalHold ? (
          <TextAction
            caseId={detail.id}
            label={t("liftHold")}
            title={t("liftHoldTitle")}
            description={t("liftHoldBody")}
            fieldLabel=""
            path="legal-hold"
            build={() => ({ hold: false })}
            minLength={0}
            done={t("holdLifted")}
          />
        ) : (
          <TextAction
            caseId={detail.id}
            label={t("placeHold")}
            title={t("placeHoldTitle")}
            description={t("placeHoldBody")}
            fieldLabel={t("reason")}
            path="legal-hold"
            build={(reason) => ({ hold: true, reason })}
            minLength={3}
            done={t("holdPlaced")}
          />
        )
      ) : null}
    </div>
  );
}
