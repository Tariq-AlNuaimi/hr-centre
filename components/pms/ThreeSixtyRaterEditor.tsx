"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Trash2, UserPen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { EmployeePicker, type PickablePerson } from "@/components/pms/EmployeePicker";
import { apiClient } from "@/lib/api-client";

/**
 * §9.4 — changing one rater on a LIVE 360 cycle.
 *
 * ## Why this exists
 *
 * Both existing assignment writers refuse anything but a DRAFT cycle, citing
 * §9.6's "HR reviews and edits assignments before launch" — which left §9.4's
 * "HR selects and **manages** all rater assignments" with nothing to manage
 * after launch. A rater who leaves, goes on long leave, or was simply the wrong
 * person could not be changed for the rest of the year.
 *
 * It had already escaped into a promise: `RecordDepartureDialog` tells HR, before
 * they record a §12.1 departure, how many of the leaver's 360 assignments "will
 * need a new rater" — and for a leaver mid-cycle those sit in an ACTIVE cycle,
 * where nothing would have accepted the change. This component is where that
 * promise gets kept.
 *
 * ## Submitted is locked, and the screen says so before the click
 *
 * A submitted assessment's rater cannot be swapped: the answers belong to the
 * person who gave them, and §9.3's scores are what §8.5 carries into pay. So
 * Replace is not offered on a submitted row at all — the row explains why, and
 * offers Discard instead, which destroys the answers and therefore demands a
 * reason. `raterChangeBlockedReason` and `discardBlockedReason` are the same
 * rules the routes apply, so nothing here can offer a control the API refuses.
 */

export type EditableAssignment = {
  id: string;
  /** §9.7's derived status — OVERDUE is the server's word, not ours. */
  status: "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "OVERDUE";
  rater: { id: string; name: string };
  template: { type: string };
};

export function ThreeSixtyRaterEditor({
  rateeId,
  rateeName,
  assignments,
  otherRaterIds,
}: {
  rateeId: string;
  rateeName: string;
  assignments: EditableAssignment[];
  /** Already assessing this person — never offered again (§9.4's unique pair). */
  otherRaterIds: string[];
}) {
  const t = useTranslations("pms.raterEditor");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const [replacing, setReplacing] = useState<EditableAssignment | null>(null);
  const [discarding, setDiscarding] = useState<EditableAssignment | null>(null);
  const [picked, setPicked] = useState<PickablePerson | null>(null);
  const [reason, setReason] = useState("");

  function reset() {
    setReplacing(null);
    setDiscarding(null);
    setPicked(null);
    setReason("");
  }

  // The whole 360 prefix: the cycle read and the assignments read are
  // SEPARATE queries (`["pms","360",cycleId]` and
  // `["pms","360","assignments",id]`), and a rater change moves both. Keying
  // the invalidation to one of them leaves the other stale — the same class of
  // "the write worked and the screen did not change" bug the evidence panel
  // had.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["pms", "360"] });
  };

  const replace = useMutation({
    mutationFn: (params: { assignmentId: string; raterId: string }) =>
      apiClient.patch(`/api/three-sixty/assignments/${params.assignmentId}`, {
        raterId: params.raterId,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success(t("replacedToast", { name: rateeName }));
      reset();
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const discard = useMutation({
    mutationFn: (assignmentId: string) =>
      apiClient.delete(`/api/three-sixty/assignments/${assignmentId}`, {
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success(t("discardedToast"));
      reset();
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // §9.4 wants exactly three. Stated rather than silently tolerated: after
  // launch a departure can take somebody to two, and HR should see that here
  // rather than at §9.8.
  const shortOfThree = assignments.length < 3;

  return (
    <>
      <ul className="space-y-2">
        {assignments.map((a) => {
          const submitted = a.status === "SUBMITTED";
          return (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.rater.name}</span>
                <Badge variant={submitted ? "success" : "outline"}>{t(`status.${a.status}`)}</Badge>
                <span className="text-xs text-muted-foreground">
                  {t(`template.${a.template.type}`)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {submitted ? (
                  // Not a disabled Replace button: a control that cannot ever
                  // work for this row is noise. The reason is the useful part.
                  <span className="text-xs text-muted-foreground">{t("submittedLocked")}</span>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setReplacing(a)}>
                    <UserPen className="me-2 h-4 w-4" />
                    {t("replace")}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDiscarding(a)}
                  aria-label={t("discardAria", { name: a.rater.name })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
      {shortOfThree && (
        <p className="mt-2 text-xs text-warning-emphasis">
          {t("shortOfThree", { count: assignments.length })}
        </p>
      )}

      {/* Replace — an unsubmitted form, so nothing is destroyed. */}
      <Dialog open={replacing !== null} onOpenChange={(open) => !open && reset()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("replaceTitle", { name: replacing?.rater.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("replaceSubtitle", { ratee: rateeName })}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <EmployeePicker
              id="replacement-rater"
              label={t("newRater")}
              // §7.1 — nobody assesses themselves; §9.4 — one rater once.
              exclude={[rateeId, ...otherRaterIds]}
              onPick={setPicked}
            />
            {picked && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <p className="mb-2 font-medium">{t("willHappen")}</p>
                <ul className="space-y-2">
                  <li>{t("effect.newRater", { name: picked.name, ratee: rateeName })}</li>
                  <li>{t("effect.templateFollows")}</li>
                  {replacing?.status === "IN_PROGRESS" && (
                    <li className="text-destructive-emphasis">{t("effect.partialLost")}</li>
                  )}
                  <li className="text-muted-foreground">{t("effect.audited")}</li>
                </ul>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="replace-reason">{t("reason")}</Label>
              <Input
                id="replace-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("reasonPlaceholder")}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={reset} disabled={replace.isPending}>
              {tCommon("cancel")}
            </Button>
            <Button
              disabled={!picked || replace.isPending}
              onClick={() =>
                replacing &&
                picked &&
                replace.mutate({ assignmentId: replacing.id, raterId: picked.id })
              }
            >
              {replace.isPending ? t("saving") : t("confirmReplace")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discard — destroys answers when the form was submitted, so the reason
          is mandatory there and the dialog says what is being lost. */}
      <Dialog open={discarding !== null} onOpenChange={(open) => !open && reset()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("discardTitle", { name: discarding?.rater.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("discardSubtitle", { ratee: rateeName })}</DialogDescription>
          </DialogHeader>

          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p className="mb-2 font-medium">{t("willHappen")}</p>
            <ul className="space-y-2">
              {discarding?.status === "SUBMITTED" ? (
                <>
                  <li className="text-destructive-emphasis">{t("effect.answersDeleted")}</li>
                  <li>{t("effect.averageDrops")}</li>
                  <li className="text-muted-foreground">{t("effect.keptInAudit")}</li>
                </>
              ) : (
                <li>{t("effect.removedNotSubmitted")}</li>
              )}
              <li>{t("effect.leavesCount", { count: Math.max(assignments.length - 1, 0) })}</li>
            </ul>
          </div>

          <div className="space-y-1">
            <Label htmlFor="discard-reason">
              {discarding?.status === "SUBMITTED" ? t("reasonRequired") : t("reason")}
            </Label>
            <Input
              id="discard-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
            />
            {discarding?.status === "SUBMITTED" && (
              <p className="text-xs text-muted-foreground">{t("reasonRequiredHelp")}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={reset} disabled={discard.isPending}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={
                discard.isPending ||
                // Mirrors `discardBlockedReason`: a submitted assessment cannot
                // be discarded without a reason, and the button says so by
                // being unavailable rather than by returning a 422.
                (discarding?.status === "SUBMITTED" && reason.trim() === "")
              }
              onClick={() => discarding && discard.mutate(discarding.id)}
            >
              {discard.isPending ? t("discarding") : t("confirmDiscard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
