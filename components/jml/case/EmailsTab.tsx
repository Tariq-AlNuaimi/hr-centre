"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { Field } from "../Field";
import { LoadFailed, LoadingBlock } from "../States";
import { useJmlAction } from "../use-jml";
import type { CaseDetail } from "./types";

type EmailRow = {
  id: string;
  type: string;
  recipient: string;
  cc: string | null;
  subject: string;
  status: "QUEUED" | "SENT" | "FAILED" | "CANCELLED";
  scheduledFor: string;
  sentAt: string | null;
  failureReason: string | null;
  createdAt: string;
};

const VARIANT = {
  QUEUED: "info",
  SENT: "success",
  FAILED: "danger",
  CANCELLED: "default",
} as const;

/**
 * Emails & notifications (§10.1's fourth tab, 8.4.6): every message of the
 * case with its state, a retry for a failed one, and the hand-sent welcome
 * review (§11.2 row 10). Bodies are never stored, so none is shown.
 */
export function EmailsTab({ detail }: { detail: CaseDetail }) {
  const t = useTranslations("jml.case.emails");
  const { run, busy } = useJmlAction(t("failed"));
  const [recipient, setRecipient] = useState(detail.hrOwner?.email ?? "");
  const list = useQuery({
    queryKey: ["jml", "case", detail.id, "emails"],
    queryFn: () => apiClient.get<EmailRow[]>(`/api/jml/cases/${detail.id}/emails`),
  });
  const canSend =
    detail.caseType === "JOIN" &&
    detail.can.manage &&
    !["DRAFT", "CANCELLED", "ARCHIVED"].includes(detail.status);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        {canSend ? (
          <ActionDialog
            trigger={
              <Button size="sm" variant="outline">
                {t("sendReview")}
              </Button>
            }
            title={t("sendReviewTitle")}
            description={t("sendReviewBody")}
            confirmLabel={t("queue")}
            busy={busy}
            disabled={!recipient.includes("@")}
            onConfirm={async () =>
              Boolean(
                await run(
                  () => apiClient.post(`/api/jml/cases/${detail.id}/emails`, { recipient }),
                  t("queued"),
                ),
              )
            }
          >
            <Field id="wr-to" label={t("recipient")}>
              <Input
                id="wr-to"
                type="email"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </Field>
          </ActionDialog>
        ) : null}
      </div>
      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError || !list.data ? (
        <LoadFailed />
      ) : list.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col.type")}</TableHead>
              <TableHead>{t("col.to")}</TableHead>
              <TableHead>{t("col.subject")}</TableHead>
              <TableHead>{t("col.when")}</TableHead>
              <TableHead>{t("col.status")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-sm">{m.type}</TableCell>
                <TableCell className="text-sm">
                  {m.recipient}
                  {m.cc ? (
                    <div className="text-xs text-muted-foreground">{t("cc", { list: m.cc })}</div>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">{m.subject}</TableCell>
                <TableCell className="text-xs tabular-nums">
                  {(m.sentAt ?? m.scheduledFor).slice(0, 16).replace("T", " ")}
                </TableCell>
                <TableCell>
                  <Badge variant={VARIANT[m.status]}>{t(`status.${m.status}`)}</Badge>
                  {m.failureReason ? (
                    <div className="text-xs text-muted-foreground">{m.failureReason}</div>
                  ) : null}
                </TableCell>
                <TableCell>
                  {m.status === "FAILED" && detail.can.workTasks ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => apiClient.post(`/api/jml/emails/${m.id}/retry`),
                          t("retried"),
                        )
                      }
                    >
                      {t("retry")}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
