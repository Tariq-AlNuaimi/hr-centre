"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api-client";

/**
 * §13.2 — the publish gate.
 *
 * "Guard against accidental triggering: confirmation step + clear warning +
 * ideally a readiness check flagging anything incomplete. Must be impossible to
 * publish by a stray click."
 *
 * Four guards on screen, mirroring the four the route enforces:
 *
 *   1. the readiness check is shown BEFORE the button, and the button is
 *      disabled while it is red — an operator should learn what is incomplete by
 *      reading, not by being refused;
 *   2. the warning states what publishing does, in the words that matter: every
 *      employee, at once, immediately;
 *   3. the confirmation is a TYPED literal, not a checkbox — a checkbox is one
 *      stray click, which is exactly what the clause forbids;
 *   4. un-publishing demands a reason, because §13.2 audits the reversal "(who,
 *      when, why)" and the why has to come from somewhere.
 *
 * Nothing here is the control. The route re-checks all four, and only HR Super
 * Admin passes.
 */

const CONFIRM_WORD = "CONFIRM";

interface PublishState {
  published: boolean;
  publishedAt?: string | null;
  readiness?: {
    ready: boolean;
    reason: string | null;
    participantCount: number;
    scoredCount: number;
    skippedCount: number;
    hasTarget: boolean;
  };
}

export function PublishGate({ cycleId }: { cycleId: string }) {
  const t = useTranslations("pms.publish");
  const queryClient = useQueryClient();
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");

  const state = useQuery({
    queryKey: ["pms", "publish", cycleId],
    queryFn: () => apiClient.get<PublishState>(`/api/publish?cycleId=${cycleId}`),
  });

  const mutation = useMutation({
    mutationFn: (action: "PUBLISH" | "UNPUBLISH") =>
      apiClient.post<PublishState>("/api/publish", {
        cycleId,
        action,
        confirm: CONFIRM_WORD,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: (_data, action) => {
      toast.success(action === "PUBLISH" ? t("publishedToast") : t("unpublishedToast"));
      setConfirmText("");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["pms", "publish", cycleId] });
      void queryClient.invalidateQueries({ queryKey: ["pms", "scorecard"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = state.data;
  const readiness = data?.readiness;
  const confirmed = confirmText.trim().toUpperCase() === CONFIRM_WORD;

  return (
    <SectionCard
      title={t("title")}
      subtitle={t("help")}
      actions={
        data ? (
          <Badge variant={data.published ? "success" : "outline"}>
            {data.published ? t("statusPublished") : t("statusHidden")}
          </Badge>
        ) : null
      }
    >
      {state.isError && <EmptyState description={t("loadFailed")} />}

      {readiness && (
        <div className="space-y-4">
          {/* Guard 1 — what is incomplete, said before the button. */}
          <div className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{t("readiness")}</span>
              <Badge variant={readiness.ready ? "success" : "warning"}>
                {readiness.ready ? t("ready") : t("notReady")}
              </Badge>
            </div>
            <p className="mt-1 text-muted-foreground">
              {t("scoredOf", {
                scored: readiness.scoredCount,
                total: readiness.participantCount,
              })}
              {readiness.skippedCount > 0 &&
                ` · ${t("skipped", { count: readiness.skippedCount })}`}
              {!readiness.hasTarget && ` · ${t("noTarget")}`}
            </p>
            {readiness.reason && (
              <p className="mt-1 text-destructive-emphasis">{readiness.reason}</p>
            )}
          </div>

          {/* Guard 2 — the warning, in plain words. */}
          <p className="text-sm text-muted-foreground">
            {data?.published ? t("unpublishWarning") : t("publishWarning")}
          </p>

          <div className="space-y-2">
            {/* Guard 4 — a reason, mandatory on the way back. */}
            <Label htmlFor="publish-reason">
              {data?.published ? t("reasonRequired") : t("reasonOptional")}
            </Label>
            <Input
              id="publish-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("reasonPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            {/* Guard 3 — a typed literal. */}
            <Label htmlFor="publish-confirm">{t("typeToConfirm", { word: CONFIRM_WORD })}</Label>
            <Input
              id="publish-confirm"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              autoComplete="off"
              aria-describedby="publish-confirm-help"
            />
            <p id="publish-confirm-help" className="text-xs text-muted-foreground">
              {t("confirmHelp")}
            </p>
          </div>

          {data?.published ? (
            <Button
              variant="destructive"
              disabled={!confirmed || reason.trim() === "" || mutation.isPending}
              onClick={() => mutation.mutate("UNPUBLISH")}
            >
              {mutation.isPending ? t("working") : t("unpublishAction")}
            </Button>
          ) : (
            <Button
              disabled={!confirmed || !readiness.ready || mutation.isPending}
              onClick={() => mutation.mutate("PUBLISH")}
            >
              {mutation.isPending ? t("working") : t("publishAction")}
            </Button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
