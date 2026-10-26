"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionCard } from "@/components/shared/SectionCard";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";

type Summary = {
  state: "NONE" | "NO_PASSWORD" | "TEMPORARY" | "ACTIVE" | "REVOKED";
  eligible: boolean;
  lineManager: boolean;
  roleHolder: boolean;
};

/**
 * Login — blueprint §4 (F-d). Create / reset / disable for HR role holders and
 * line managers. The temporary password lives ONLY in this component's state
 * for as long as the dialog is open: it is not in the query cache, not in the
 * URL, and closing the dialog (or reloading) loses it for good (AC-F4.1).
 */
export function LoginPanel({ employeeId, name }: { employeeId: string; name: string }) {
  const t = useTranslations("people.login");
  const queryClient = useQueryClient();
  const { success, error: toastError } = useNotify();
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ temporaryPassword: string; email: string } | null>(null);

  const summary = useQuery({
    queryKey: ["logins", employeeId],
    queryFn: () => apiClient.get<Summary>(`/api/logins/${employeeId}`),
  });

  async function issue(action: "create" | "reset") {
    setBusy(true);
    try {
      setIssued(
        await apiClient.post<{ temporaryPassword: string; email: string }>(
          `/api/logins/${employeeId}`,
          {
            action,
          },
        ),
      );
      await queryClient.invalidateQueries({ queryKey: ["logins", employeeId] });
    } catch (e) {
      toastError(e instanceof ApiError ? e.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await apiClient.delete(`/api/logins/${employeeId}`);
      success(t("disabled"));
      await queryClient.invalidateQueries({ queryKey: ["logins", employeeId] });
    } catch (e) {
      toastError(e instanceof ApiError ? e.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  const data = summary.data;
  const hasPassword = data?.state === "ACTIVE" || data?.state === "TEMPORARY";
  return (
    <SectionCard title={t("title")} subtitle={t("subtitle")}>
      {summary.isLoading ? (
        <div className="h-10 animate-pulse rounded-md bg-muted" />
      ) : summary.isError || !data ? (
        <p role="alert" className="text-sm text-destructive-emphasis">
          {t("loadFailed")}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={hasPassword ? "success" : "default"}>{t(`state.${data.state}`)}</Badge>
          {!data.eligible && data.state !== "REVOKED" ? (
            <span className="text-sm text-muted-foreground">{t("notEligible")}</span>
          ) : null}
          <span className="ms-auto flex flex-wrap gap-2">
            {data.eligible && !hasPassword && data.state !== "REVOKED" ? (
              <Button disabled={busy} onClick={() => void issue("create")}>
                {t("create")}
              </Button>
            ) : null}
            {hasPassword ? (
              <ConfirmAction
                title={t("resetTitle", { name })}
                description={t("resetDescription")}
                okText={t("reset")}
                onConfirm={() => void issue("reset")}
              >
                <Button variant="outline" disabled={busy}>
                  {t("reset")}
                </Button>
              </ConfirmAction>
            ) : null}
            {hasPassword ? (
              <ConfirmAction
                title={t("disableTitle", { name })}
                description={t("disableDescription")}
                okText={t("disable")}
                okType="danger"
                onConfirm={() => void disable()}
              >
                <Button variant="ghost" disabled={busy}>
                  {t("disable")}
                </Button>
              </ConfirmAction>
            ) : null}
          </span>
        </div>
      )}
      <Dialog open={issued !== null} onOpenChange={(open) => !open && setIssued(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("issuedTitle")}</DialogTitle>
            <DialogDescription>{t("issuedHelp", { email: issued?.email ?? "" })}</DialogDescription>
          </DialogHeader>
          <p className="select-all rounded-md border border-border bg-muted p-3 text-center font-mono text-lg text-foreground">
            {issued?.temporaryPassword}
          </p>
          <p className="text-xs text-muted-foreground">{t("issuedOnce")}</p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void navigator.clipboard?.writeText(issued?.temporaryPassword ?? "")}
            >
              {t("copy")}
            </Button>
            <Button onClick={() => setIssued(null)}>{t("done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
