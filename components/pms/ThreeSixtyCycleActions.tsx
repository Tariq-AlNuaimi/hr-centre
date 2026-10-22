"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CircleSlash, RotateCcw, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";

/**
 * §9.7/§9.8 — ending a 360 cycle, taking one back to draft, or reopening one.
 *
 * ## Why there was nothing here
 *
 * `ThreeSixtyStatus` has carried `CLOSED` since the schema was written and the
 * rater-side gate has refused a closed cycle just as long — but nothing in the
 * product ever WROTE it. A cycle reached ACTIVE and stayed there permanently,
 * which is what blocked the operator: a 360 that cannot end cannot be got out
 * of the way of anything else.
 *
 * ## Three acts, named separately
 *
 * Close, deactivate and reopen are different decisions, so they are different
 * buttons with different confirmations rather than one toggle:
 *
 *  - **Close** — the cycle is over, §9.8's results stand, no more responses.
 *  - **Back to draft** — it was launched by mistake. Offered ONLY while nothing
 *    has been submitted, because a draft can be regenerated and that would
 *    destroy submitted assessments as a side effect. When something has been
 *    submitted the button says why it cannot be used, rather than vanishing:
 *    an HR user looking for it needs to know the reason.
 *  - **Reopen** — undoing a close. It exists because a close nobody can undo is
 *    a dead end, and an HR user who closes a cycle a day early should not need
 *    a developer.
 *
 * Each confirmation states the consequence in plain words before the press,
 * which is what the operator asked for on the departure dialog and the same
 * standard applies here.
 */

type Status = "DRAFT" | "ACTIVE" | "CLOSED";

export function ThreeSixtyCycleActions({
  threeSixtyCycleId,
  status,
  submittedCount,
  raterCount,
}: {
  threeSixtyCycleId: string;
  status: Status;
  /** Drives whether "back to draft" is offered, and what the warnings say. */
  submittedCount: number;
  /** Total assignments, so the confirmation can say what is being ended. */
  raterCount: number;
}) {
  const t = useTranslations("pms.threeSixtyActions");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const [pending, setPending] = useState<Status | null>(null);
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: (next: Status) =>
      apiClient.post("/api/three-sixty/status", {
        threeSixtyCycleId,
        status: next,
        reason: reason.trim() || undefined,
      }),
    onSuccess: (_data, next) => {
      toast.success(t(`done.${next}`));
      setPending(null);
      setReason("");
      // The whole 360 prefix — the cycle read and the assignments read are
      // separate queries and a status change moves both.
      void queryClient.invalidateQueries({ queryKey: ["pms", "360"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Nothing has been submitted, so a regenerate from draft would destroy
  // nothing. The same condition `statusChangeBlockedReason` applies.
  const canDeactivate = submittedCount === 0;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status === "ACTIVE" && (
          <>
            <Button variant="outline" size="sm" onClick={() => setPending("CLOSED")}>
              <CircleSlash className="me-2 h-4 w-4" />
              {t("close")}
            </Button>
            {/* Shown disabled rather than hidden when something is submitted:
                the reason is the useful part. */}
            <Button
              variant="outline"
              size="sm"
              disabled={!canDeactivate}
              title={canDeactivate ? undefined : t("deactivateBlocked", { count: submittedCount })}
              onClick={() => setPending("DRAFT")}
            >
              <Undo2 className="me-2 h-4 w-4" />
              {t("deactivate")}
            </Button>
          </>
        )}
        {status === "CLOSED" && (
          <Button variant="outline" size="sm" onClick={() => setPending("ACTIVE")}>
            <RotateCcw className="me-2 h-4 w-4" />
            {t("reopen")}
          </Button>
        )}
      </div>
      {status === "ACTIVE" && !canDeactivate && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("deactivateBlocked", { count: submittedCount })}
        </p>
      )}

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{pending ? t(`confirm.${pending}.title`) : ""}</DialogTitle>
            <DialogDescription>{pending ? t(`confirm.${pending}.subtitle`) : ""}</DialogDescription>
          </DialogHeader>

          {/* Every line is a consequence this press causes, so it reads as a
              list of effects rather than a warning to click past. */}
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p className="mb-2 font-medium">{t("willHappen")}</p>
            <ul className="space-y-2">
              {pending === "CLOSED" && (
                <>
                  <li>{t("effect.closeNoMore")}</li>
                  <li>{t("effect.closeResults", { submitted: submittedCount, raterCount })}</li>
                  <li className="text-muted-foreground">{t("effect.closeReversible")}</li>
                </>
              )}
              {pending === "DRAFT" && (
                <>
                  <li>{t("effect.draftHidden")}</li>
                  <li>{t("effect.draftEditable")}</li>
                  <li className="text-muted-foreground">{t("effect.draftNothingSubmitted")}</li>
                </>
              )}
              {pending === "ACTIVE" && (
                <>
                  <li>{t("effect.reopenAnswerable")}</li>
                  <li>{t("effect.reopenDeadline")}</li>
                </>
              )}
            </ul>
          </div>

          <div className="space-y-1">
            <Label htmlFor="status-reason">{t("reason")}</Label>
            <Input
              id="status-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{t("reasonHelp")}</p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPending(null)}
              disabled={mutation.isPending}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={() => pending && mutation.mutate(pending)}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? t("working") : pending ? t(`confirm.${pending}.action`) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
