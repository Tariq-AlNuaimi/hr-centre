"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { Field } from "../Field";
import { useJmlAction } from "../use-jml";

type Result = { cancelledTasks: number; reversalTasks: number; departureReversed: boolean };

/** Withdraw an exit (AC-2.1/2.3, T10 — API-only in the source, F6). */
export function WithdrawExit({ caseId, version }: { caseId: string; version: number }) {
  const t = useTranslations("jml.leavers.withdraw");
  const { run, busy } = useJmlAction(t("failed"));
  const [reason, setReason] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button variant="outline" size="sm">
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("body")}
      confirmLabel={t("confirm")}
      destructive
      busy={busy}
      disabled={reason.trim().length < 3}
      onConfirm={async () =>
        Boolean(
          await run(
            () =>
              apiClient.post<Result>(`/api/jml/leavers/${caseId}/cancel`, {
                reason: reason.trim(),
                expectedVersion: version,
              }),
            t("done"),
          ),
        )
      }
    >
      <Field id="withdraw-reason" label={t("reason")}>
        <Input id="withdraw-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}
