"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UserMinus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/api-client";
import { useNotify } from "@/hooks/use-notify";
import type { DeparturePreview } from "@/lib/pms/departure";

/**
 * §12.1 — record a departure, from the record it belongs to.
 *
 * HR looked for this on the employee page and did not find it: it existed only
 * on "Leavers & transfers", which is also where §12.2's roll-up prompt lives.
 * This is the same act in the place it is noticed.
 *
 * It posts to `POST /api/leavers`, deliberately, rather than setting the two
 * columns through the employee edit form. A departure is not a field edit —
 * §12.1 also moves the direct reports up one level and §12.2 wants a prompt per
 * report — and a second writer that did only the columns would produce a
 * revoked login beside a team still reporting to someone who has gone. The edit
 * route now refuses the transition outright and names this action.
 *
 * THE CONFIRMATION IS THE POINT. HR asked to see what will happen before
 * saving, and the consequences here are not guessable from the form: a line
 * moves for every direct report, a login stops working, and a 360 assignment
 * becomes HR's to reassign. The counts come from `departurePreview`, built from
 * the same predicates the write uses, so the sentence cannot drift from the act.
 */

export function RecordDepartureDialog({
  employeeId,
  employeeName,
  preview,
}: {
  employeeId: string;
  employeeName: string;
  /** Computed server-side; null when the record could not be read. */
  preview: DeparturePreview | null;
}) {
  const t = useTranslations("pms.departure");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { success } = useNotify();

  const [open, setOpen] = useState(false);
  const [lastWorkingDay, setLastWorkingDay] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Already departed: §12.1 preserves the record, so there is nothing to do and
  // no button to offer. Stated rather than hidden, because an HR user looking
  // for the action needs to know it has already happened.
  if (!preview || preview.alreadyLeaver) return null;

  async function submit() {
    setFormError(null);
    if (lastWorkingDay === "") {
      // §11.4 pro-rates from cycle start to this date, so it is not optional.
      setFormError(t("lastWorkingDayRequired"));
      return;
    }
    if (reason.trim().length < 10) {
      setFormError(t("bypassReasonRequired"));
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post("/api/leavers", {
        employeeId,
        lastWorkingDay,
        note: note || undefined,
        bypassReason: reason.trim(),
      });
      success(t("recorded", { name: employeeName }));
      setOpen(false);
      router.refresh();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <UserMinus className="me-2 h-4 w-4" />
          {t("action")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title", { name: employeeName })}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* UX review P0 (US-2): the normal path is a leaver case in Joiners &
              leavers. This is the HR Super Admin correction, and it says so. */}
          <p className="rounded-md border border-status-warn bg-status-warn px-3 py-2 text-sm text-status-warn-fg">
            {t("bypassWarning")}
          </p>
          <div className="space-y-1">
            <Label htmlFor="departure-reason">{t("bypassReason")}</Label>
            <textarea
              id="departure-reason"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-16 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">{t("bypassReasonHelp")}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="departure-lwd">{t("lastWorkingDay")}</Label>
            <input
              id="departure-lwd"
              type="date"
              required
              value={lastWorkingDay}
              onChange={(e) => setLastWorkingDay(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
            <p className="text-xs text-muted-foreground">{t("lastWorkingDayHelp")}</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="departure-note">{t("note")}</Label>
            <input
              id="departure-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>

          {/* The confirmation. Every line is a consequence this press causes, so
              it reads as a list of effects rather than a warning to click past. */}
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p className="mb-2 font-medium">{t("willHappen")}</p>
            <ul className="space-y-2">
              <li>{t("effectStatus")}</li>

              <li>
                {preview.reports.length === 0
                  ? t("effectNoReports")
                  : preview.rollUpToName
                    ? t("effectReports", {
                        count: preview.reports.length,
                        manager: preview.rollUpToName,
                      })
                    : // §12.1's target may be null — the departing manager was at
                      // the top. That is the case HR most needs the prompt for,
                      // so it is called out rather than rendered as "to ".
                      t("effectReportsNoTarget", { count: preview.reports.length })}
                {preview.reports.length > 0 ? (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {preview.reports.map((r) => r.name).join(", ")}
                  </span>
                ) : null}
              </li>

              <li>
                {preview.threeSixty.length === 0
                  ? t("effectNoThreeSixty")
                  : t("effectThreeSixty", { count: preview.threeSixty.length })}
                {preview.threeSixty.length > 0 ? (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t("effectThreeSixtyWho", {
                      names: preview.threeSixty.map((a) => a.rateeName).join(", "),
                    })}
                  </span>
                ) : null}
              </li>

              <li>{preview.hasLogin ? t("effectLogin") : t("effectNoLogin")}</li>
              <li className="text-muted-foreground">{t("effectRecordKept")}</li>
            </ul>
          </div>

          {formError ? (
            <p role="alert" className="text-sm text-destructive-emphasis">
              {formError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? t("recording") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
