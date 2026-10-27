"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

/**
 * §5.1's LOCK, as an affordance — the caller `POST /api/cycles/[id]/participants/
 * [participantId]/approve` never had.
 *
 * The route was complete, idempotent and tested from the day it was written, and
 * nothing in the product called it (`docs/verification/SPEC-REDTEAM.md`, F11).
 * The only other writer of `goalsApprovedAt` is the demo fixture, writing
 * straight to the database — the same trap as F1–F6, and a worse one, because
 * `app/api/year-end-signoffs/route.ts` refuses without that column ("no
 * HR-approved baseline… §5.1"). With no button, §7 → §8 → §10 → §11 → §13 were
 * shut for the whole company behind a lock nobody could turn.
 *
 * Three things this panel deliberately does NOT do, each mirroring the route:
 *
 *   1. **No unapprove.** §5.1 makes approval the baseline and §6.2 makes the
 *      correction path an audited mid-year change request. A second button here
 *      would be an unaudited way to reopen a locked year, and the route has no
 *      DELETE to call anyway.
 *   2. **No force.** The one case where HR may approve over a missing employee
 *      signature is §5.4's own resolution, and the SERVER decides that by
 *      reading the stage state. So this screen never offers an override; it
 *      shows which of §5.1's two routes to a lock is currently available.
 *   3. **No client-side re-derivation of the gate.** `blockedReason` is the
 *      server's own sentence from `hrApprovalDecision`, computed in the page
 *      above and quoted verbatim. A disabled button that disagreed with the
 *      route about WHY would be worse than no button.
 *
 * The confirmation is not ceremony. §5.1's lock is what §6.2 then makes
 * expensive to undo, and the copy says what stops being possible — editing the
 * set — rather than asking "are you sure?" about an act whose consequence the
 * reader would otherwise have to know already.
 */

type ApprovalBasis = "BOTH_SIGNED" | "HR_REVIEW_EMPLOYEE_UNSIGNED";

export interface HrApprovalPanelProps {
  cycleId: string;
  participantId: string;
  /** §5.1's lock, as it stands. Non-null means there is nothing left to do. */
  goalsApprovedAt: string | null;
  /**
   * The server's verdict, verbatim. Null when approval is available right now;
   * otherwise the sentence naming which rule is holding it (no KPIs, §5.3's
   * 100%, the manager's missing signature, or §5.4's deadline not yet passed).
   */
  blockedReason: string | null;
  /**
   * Which of §5.1's two routes to a lock would be taken, when one is available.
   * `HR_REVIEW_EMPLOYEE_UNSIGNED` is §5.4's resolution and is a materially
   * different record from a mutual agreement — so the screen says so BEFORE the
   * click, not only in the response afterwards.
   */
  basis: ApprovalBasis | null;
}

export function HrApprovalPanel({
  cycleId,
  participantId,
  goalsApprovedAt,
  blockedReason,
  basis,
}: HrApprovalPanelProps) {
  const t = useTranslations("pms.kpi.hrApproval");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { success, error: showError } = useNotify();

  const [approvedAt, setApprovedAt] = useState<string | null>(goalsApprovedAt);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** A 409/403 the SERVER just returned — the page's gate, learned late. */
  const [serverBlocked, setServerBlocked] = useState<string | null>(null);

  async function handleApprove() {
    setSubmitting(true);
    try {
      const result = await apiClient.post<{
        goalsApprovedAt: string;
        alreadyApproved: boolean;
      }>(`/api/cycles/${cycleId}/participants/${participantId}/approve`, {});
      setApprovedAt(result.goalsApprovedAt);
      setConfirmOpen(false);
      success(result.alreadyApproved ? t("alreadyApprovedToast") : t("approvedToast"));
      router.refresh();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : t("failed");
      // 409 and 403 are STATE, not accidents — the manager withdrew a
      // signature's worth of weightage, the cycle closed, the role changed. Latch
      // it so the button stops offering what the server just refused.
      if (e instanceof ApiError && (e.status === 409 || e.status === 403)) {
        setServerBlocked(message);
      }
      showError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (approvedAt) {
    return (
      <SectionCard title={t("title")} subtitle={t("lockedSubtitle")}>
        <div className="flex items-start gap-3">
          <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{t("lockedTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {t("lockedBody", { datetime: formatDateTime(approvedAt) })}
            </p>
          </div>
        </div>
      </SectionCard>
    );
  }

  const reason = serverBlocked ?? blockedReason;
  const canApprove = reason === null;

  return (
    <SectionCard
      title={t("title")}
      subtitle={t("subtitle")}
      actions={
        <Button disabled={!canApprove || submitting} onClick={() => setConfirmOpen(true)}>
          {t("action")}
        </Button>
      }
    >
      <div className="space-y-3">
        {/* The server's sentence, quoted. It names WHICH rule is holding the
            lock, which is the only part worth reading. */}
        {reason ? (
          <p role="status" className="max-w-prose text-sm text-muted-foreground">
            {reason}
          </p>
        ) : (
          <p className="max-w-prose text-sm text-muted-foreground">
            {basis === "HR_REVIEW_EMPLOYEE_UNSIGNED" ? t("readyUnsigned") : t("readySigned")}
          </p>
        )}

        {/* What the lock costs, stated before the click rather than discovered
            after it (§6.2 is the only way back). */}
        <ul className="max-w-prose list-disc space-y-1 ps-5 text-xs text-muted-foreground">
          <li>{t("effectBaseline")}</li>
          <li>{t("effectEdits")}</li>
          <li>{t("effectYearEnd")}</li>
        </ul>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => !submitting && setConfirmOpen(open)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("confirmTitle")}</DialogTitle>
            <DialogDescription>
              {basis === "HR_REVIEW_EMPLOYEE_UNSIGNED" ? t("confirmUnsigned") : t("confirmSigned")}
            </DialogDescription>
          </DialogHeader>

          <p className="max-w-prose text-sm text-muted-foreground">{t("confirmBody")}</p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              {tCommon("cancel")}
            </Button>
            <Button onClick={handleApprove} disabled={submitting}>
              {submitting ? t("approving") : t("confirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
