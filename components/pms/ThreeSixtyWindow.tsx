"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api-client";
import { endOfDay, startOfDay, toDateInput } from "@/lib/date-input";

/**
 * §9.1/§9.7 — correcting the 360 window, and extending it after launch.
 *
 * ## Why this exists
 *
 * `POST /api/three-sixty` was the only writer of `opensAt` and `deadline`, and
 * there was no PATCH and no DELETE. A 360 created with the wrong dates was
 * wrong for the rest of the performance year: HR could not amend it, could not
 * remove it, and could not create a second one (§9.1 ties one 360 to one year).
 * Found while verifying §9.8's report — the fixture's own 360 opened three
 * months in the future, and nothing in the product could bring it forward.
 *
 * ## Not draft-only any more — DIRECTIONAL once the cycle is live
 *
 * It was draft-only, and disappeared at activation: "the window is fixed once
 * the cycle is activated". That is right for pulling a deadline FORWARD and
 * wrong for pushing it back, and the build treated both as one act, so a cycle
 * that needed another week was simply over.
 *
 * On a live cycle the deadline may now be EXTENDED and not brought forward —
 * extending cannot invalidate an answer anybody has already given, while §5.4
 * makes a passed deadline a hard lock, so pulling one in locks raters out of
 * forms they are part-way through. `opensAt` freezes once it has passed, for
 * the same reason. The rules are `windowChangeBlockedReason`'s, and this editor
 * disables exactly what that function would refuse rather than inventing its
 * own copy — a control the route then rejects is the failure mode being
 * designed out.
 */

export function ThreeSixtyWindow({
  threeSixtyCycleId,
  cycleId,
  opensAt,
  deadline,
  cycleStatus,
}: {
  threeSixtyCycleId: string;
  cycleId: string;
  opensAt: string;
  deadline: string;
  /** DRAFT moves freely; ACTIVE may only be extended. */
  cycleStatus: "DRAFT" | "ACTIVE" | "CLOSED";
}) {
  const t = useTranslations("pms.threeSixtyWindow");
  const queryClient = useQueryClient();
  const [opens, setOpens] = useState(toDateInput(opensAt));
  const [closes, setCloses] = useState(toDateInput(deadline));

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch("/api/three-sixty", {
        threeSixtyCycleId,
        opensAt: opensInstant,
        // END of the chosen day. §5.4 makes a deadline a hard lock, so midnight
        // UTC of the deadline date would quietly delete the last day of the
        // window — the whole day, in every timezone west of Greenwich.
        deadline: closesInstant,
      }),
    onSuccess: () => {
      toast.success(t("savedToast"));
      void queryClient.invalidateQueries({ queryKey: ["pms", "360", cycleId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // The instants that will actually be sent — `""` if the box holds something
  // that is not a usable date, which `<input type="date">` does allow.
  const opensInstant = opens ? startOfDay(opens) : "";
  const closesInstant = closes ? endOfDay(closes) : "";

  // Two different problems, kept apart: a field left empty (or unusable) is not
  // the same as two dates in the wrong order, and only the second has a message
  // to show. Conflating them pointed the ordering error at an untouched field.
  const incomplete = !opensInstant || !closesInstant;
  // Compared as instants, not as day strings: a one-day window runs 00:00:00 →
  // 23:59:59 and is perfectly valid, but two equal `YYYY-MM-DD` strings look
  // like a mis-ordering.
  const misordered = !incomplete && closesInstant <= opensInstant;
  // Also compared as instants. Comparing days would make the F10 case
  // unrepairable: every 360 created before the end-of-day fix stored midnight
  // UTC, which is the same DAY and the wrong INSTANT — Save would sit
  // permanently disabled on exactly the rows that need it.
  const unchanged = opensInstant === opensAt && closesInstant === deadline;

  // The live-cycle rules, mirroring `windowChangeBlockedReason` so the button
  // and the route agree. Compared as INSTANTS for the same reason `unchanged`
  // is: a day-string comparison would call a legitimate extension a no-op.
  const live = cycleStatus === "ACTIVE";
  const pullsDeadlineIn = live && !incomplete && closesInstant < deadline;
  const hasOpened = live && new Date(opensAt) <= new Date();
  const movesOpenedStart = hasOpened && !incomplete && opensInstant !== opensAt;

  return (
    <SectionCard
      title={t("title")}
      subtitle={t("help")}
      actions={
        <Button
          onClick={() => mutation.mutate()}
          disabled={
            mutation.isPending ||
            incomplete ||
            misordered ||
            unchanged ||
            pullsDeadlineIn ||
            movesOpenedStart
          }
        >
          {mutation.isPending ? t("saving") : t("save")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="window-opens">{t("opensAt")}</Label>
          <Input
            id="window-opens"
            type="date"
            value={opens}
            onChange={(e) => setOpens(e.target.value)}
            disabled={hasOpened}
          />
          {hasOpened && <p className="text-xs text-muted-foreground">{t("openedLocked")}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="window-closes">{t("deadline")}</Label>
          <Input
            id="window-closes"
            type="date"
            value={closes}
            onChange={(e) => setCloses(e.target.value)}
          />
          {misordered && (
            <p className="text-xs text-destructive-emphasis">{t("deadlineAfterOpens")}</p>
          )}
          {/* Said BEFORE the click, not as a 409 afterwards. */}
          {pullsDeadlineIn && (
            <p className="text-xs text-destructive-emphasis">{t("extendOnly")}</p>
          )}
          {live && !pullsDeadlineIn && (
            <p className="text-xs text-muted-foreground">{t("liveExtendHelp")}</p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
