"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/org/NativeSelect";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDateTime } from "@/lib/format";
import { STATUS_TRANSITIONS } from "@/lib/hiring/requisition-rules";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { StatusBadge } from "../ui/badges";
import { Field, Textarea } from "@/components/shared/FormControls";
import type { RequisitionDetail, StatusHistoryRow } from "./types";

/**
 * Current status + "Change status" with the mandatory note, and the history
 * timeline (Interview Hub `PositionStatusCard` + `PositionHistory`).
 * PENDING_APPROVAL → OPEN is a sign-off and lives on the approval screen.
 */
export function StatusCard({ req }: { req: RequisitionDetail }) {
  const t = useTranslations("hiring.requisition");
  const ts = useTranslations("hiring.status.requisition");
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const history = useHiringQuery<{ status: StatusHistoryRow[] }>(
    `/api/hiring/requisitions/${req.id}/history`,
  );
  const change = useHiringMutation<object>("PATCH", `/api/hiring/requisitions/${req.id}/status`, {
    success: t("statusChanged"),
    onSuccess: () => {
      setOpen(false);
      setReason("");
    },
  });
  const targets = (STATUS_TRANSITIONS[req.status as keyof typeof STATUS_TRANSITIONS] ?? []).filter(
    (s) => !(req.status === "PENDING_APPROVAL" && s === "OPEN"),
  );
  return (
    <SectionCard
      title={t("statusTitle")}
      actions={
        req.can.manage && targets.length ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            {t("changeStatus")}
          </Button>
        ) : null
      }
    >
      <div className="flex items-center gap-2">
        <StatusBadge kind="requisition" value={req.status} />
        <span className="text-sm text-muted-foreground">{req.fillLabel}</span>
      </div>
      <ol className="mt-4 space-y-3 border-s border-border ps-4">
        {(history.data?.status ?? []).map((h) => (
          <li key={h.id} className="text-sm">
            <p className="text-foreground">
              {h.fromStatus === h.toStatus
                ? ts(h.toStatus)
                : `${ts(h.fromStatus)} → ${ts(h.toStatus)}`}
            </p>
            <p className="whitespace-pre-wrap text-muted-foreground">{h.reason}</p>
            <p className="text-xs text-muted-foreground">
              {h.changedBy?.name ?? t("system")} · {formatDateTime(h.changedAt)}
            </p>
          </li>
        ))}
      </ol>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("changeStatus")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t("newStatus")} htmlFor="st-to">
              <NativeSelect id="st-to" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">{t("choose")}</option>
                {targets.map((s) => (
                  <option key={s} value={s}>
                    {ts(s)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("reason")} htmlFor="st-reason" hint={t("reasonHint")}>
              <Textarea id="st-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={!to || !reason.trim() || change.isPending}
              onClick={() => change.mutate({ status: to, reason })}
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
