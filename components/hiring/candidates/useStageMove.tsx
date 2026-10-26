"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GATE_CODE } from "@/lib/hiring/stage-gates";
import { HiringApiError, hiringFetch } from "../ui/api";
import { Field, Textarea } from "../ui/fields";
import { Notice } from "../ui/states";

/**
 * One way to move a candidate from any screen (profile rail, board, list). The
 * server decides; when it answers GATE_CONFIRM_REQUIRED the "skip a required
 * step?" dialog asks the HR Manager for the reason and retries with the
 * override. Every other refusal is shown as it was given.
 */
type Pending = { id: string; stage: string; message: string; onDone?: () => void };

export function useStageMove() {
  const t = useTranslations("hiring.candidate");
  const ts = useTranslations("hiring.stage");
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");

  async function send(
    id: string,
    stage: string,
    body: { reason?: string; overrideGates?: boolean },
  ) {
    await hiringFetch(`/api/hiring/candidates/${id}/stage`, {
      method: "PATCH",
      body: { stage, ...body },
    });
    void qc.invalidateQueries({ queryKey: ["hiring"] });
    toast.success(t("moved", { stage: ts(stage) }));
  }

  /** Resolves true when the move happened (false = refused, or waiting on the gate dialog). */
  async function move(
    id: string,
    stage: string,
    opts: { reason?: string; onDone?: () => void } = {},
  ) {
    setBusy(true);
    try {
      await send(id, stage, { reason: opts.reason });
      opts.onDone?.();
      return true;
    } catch (e) {
      if (e instanceof HiringApiError && e.code === GATE_CODE.confirmRequired) {
        setReason("");
        setGate({ id, stage, message: e.message, onDone: opts.onDone });
      } else {
        toast.error((e as Error).message);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmGate() {
    if (!gate) return;
    setBusy(true);
    try {
      await send(gate.id, gate.stage, { reason: reason.trim(), overrideGates: true });
      gate.onDone?.();
      setGate(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const dialog: ReactNode = (
    <Dialog open={gate !== null} onOpenChange={(o) => !o && setGate(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("gateTitle")}</DialogTitle>
          <DialogDescription>{t("gateAudit")}</DialogDescription>
        </DialogHeader>
        <Notice tone="warning">{gate?.message}</Notice>
        <Field label={t("gateReason")} htmlFor="gate-reason" required>
          <Textarea
            id="gate-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("gateReasonPlaceholder")}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => setGate(null)}>
            {t("cancel")}
          </Button>
          <Button disabled={busy || reason.trim().length === 0} onClick={() => void confirmGate()}>
            {t("gateConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { move, busy, dialog };
}
