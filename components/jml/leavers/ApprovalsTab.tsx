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
import { LoadFailed, LoadingBlock } from "../States";
import { useJmlAction } from "../use-jml";
import { CLOSED_STATUSES, type ExitView } from "./types";
import { useExit } from "./use-exit";

const HOLDER_COUNT: Record<string, number> = {
  EXIT_CONFIRMATION: 1,
  TERMINATION_AUTHORISATION: 2,
  EARLY_RELEASE_VIA_LEAVE: 2,
  BACKFILL_DECISION: 1,
  FINAL_SETTLEMENT_APPROVAL: 2,
};

/** Whether a type can be requested on this exit (the server refuses the others). */
function requestable(type: string, exit: ExitView): boolean {
  if (type === "TERMINATION_AUTHORISATION")
    return exit.exitType === "TERMINATION" || exit.exitType === "SUMMARY_DISMISSAL";
  if (type === "FINAL_SETTLEMENT_APPROVAL") return exit.settlementApplicable;
  return true;
}

const TYPES = [
  "EXIT_CONFIRMATION",
  "TERMINATION_AUTHORISATION",
  "EARLY_RELEASE_VIA_LEAVE",
  "BACKFILL_DECISION",
  "FINAL_SETTLEMENT_APPROVAL",
] as const;

type Approval = {
  id: string;
  approvalType: string;
  holderRoleKey: string;
  status: string;
  requestedAt: string;
  decisionDate: string | null;
  reference: string | null;
  comments: string | null;
  delegateUsed: boolean;
  secondLevelUsed: boolean;
  decidedBy: { name: string | null } | null;
};
type Listing = { approvals: Approval[] };

/** §4.3 approvals — all five types (F5), each decision recorded by HR on the holder's behalf. */
export function ApprovalsTab({ caseId }: { caseId: string }) {
  const t = useTranslations("jml.leavers.approvals");
  const exit = useExit(caseId);
  const q = useQuery({
    queryKey: ["jml", "exit", caseId, "approvals"],
    queryFn: () => apiClient.get<Listing>(`/api/jml/leavers/${caseId}/approvals`),
  });
  if (q.isLoading || exit.isLoading) return <LoadingBlock />;
  if (q.isError || !q.data || !exit.data) return <LoadFailed />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {TYPES.map((type) => (
        <TypeCard
          key={type}
          type={type}
          rows={q.data.approvals.filter((a) => a.approvalType === type)}
          exit={exit.data}
        />
      ))}
    </div>
  );
}

function TypeCard({ type, rows, exit }: { type: string; rows: Approval[]; exit: ExitView }) {
  const t = useTranslations("jml.leavers.approvals");
  const tv = useTranslations("jml.leavers.vocab");
  const { run, busy } = useJmlAction(t("failed"));
  const open = !CLOSED_STATUSES.has(exit.status);
  return (
    <SectionCard
      title={tv(`approvalType.${type}`)}
      subtitle={t(`why.${type}`)}
      actions={
        exit.can.manage && open && requestable(type, exit) && rows.length < HOLDER_COUNT[type]! ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  apiClient.post(`/api/jml/leavers/${exit.caseId}/approvals`, {
                    approvalType: type,
                  }),
                t("requested"),
              )
            }
          >
            {rows.length ? t("requestMissing") : t("request")}
          </Button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
            >
              <span>
                <span className="font-medium">{a.holderRoleKey}</span>{" "}
                <span className="text-muted-foreground">
                  {a.status === "PENDING"
                    ? t("pendingSince", { date: a.requestedAt.slice(0, 10) })
                    : t("decided", {
                        status: tv(`approvalStatus.${a.status}`),
                        date: a.decisionDate?.slice(0, 10) ?? "",
                        by: a.decidedBy?.name ?? "—",
                        ref: a.reference ?? a.comments ?? "",
                      })}
                </span>
              </span>
              {a.status === "PENDING" && exit.can.decide ? (
                <DecideDialog caseId={exit.caseId} approval={a} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function DecideDialog({ caseId, approval }: { caseId: string; approval: Approval }) {
  const t = useTranslations("jml.leavers.approvals");
  const { run, busy } = useJmlAction(t("failed"));
  const [v, setV] = useState({
    status: "GRANTED",
    decisionDate: new Date().toISOString().slice(0, 10),
    reference: "",
    comments: "",
    delegateUsed: false,
    secondLevelUsed: false,
  });
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  const ok = v.status === "GRANTED" ? v.reference.trim().length > 0 : v.comments.trim().length > 0;
  return (
    <ActionDialog
      trigger={<Button size="sm">{t("decide")}</Button>}
      title={t("decideTitle", { holder: approval.holderRoleKey })}
      description={t("decideBody")}
      confirmLabel={t("record")}
      busy={busy}
      disabled={!ok || !v.decisionDate}
      onConfirm={async () =>
        Boolean(
          await run(
            () =>
              apiClient.patch(`/api/jml/leavers/${caseId}/approvals/${approval.id}`, {
                ...v,
                reference: v.reference.trim() || null,
                comments: v.comments.trim() || null,
              }),
            t("recorded"),
          ),
        )
      }
    >
      <Field id="ap-status" label={t("outcome")}>
        <NativeSelect
          id="ap-status"
          className="w-full"
          value={v.status}
          onChange={(e) => set({ status: e.target.value })}
        >
          <option value="GRANTED">{t("granted")}</option>
          <option value="REJECTED">{t("rejected")}</option>
        </NativeSelect>
      </Field>
      <Field id="ap-date" label={t("decisionDate")}>
        <Input
          id="ap-date"
          type="date"
          value={v.decisionDate}
          onChange={(e) => set({ decisionDate: e.target.value })}
        />
      </Field>
      <Field id="ap-ref" label={t("reference")} hint={t("referenceHint")}>
        <Input
          id="ap-ref"
          value={v.reference}
          onChange={(e) => set({ reference: e.target.value })}
        />
      </Field>
      <Field id="ap-comments" label={t("comments")} hint={t("commentsHint")}>
        <Input
          id="ap-comments"
          value={v.comments}
          onChange={(e) => set({ comments: e.target.value })}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.delegateUsed}
          onChange={(e) => set({ delegateUsed: e.target.checked })}
        />
        {t("delegateUsed")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.secondLevelUsed}
          onChange={(e) => set({ secondLevelUsed: e.target.checked })}
        />
        {t("secondLevelUsed")}
      </label>
    </ActionDialog>
  );
}
