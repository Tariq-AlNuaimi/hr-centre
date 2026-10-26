"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { useJmlAction } from "../use-jml";
import { ExitDateFields } from "./ExitDateFields";
import { datesPayload, type ExitValues } from "./exit-values";
import type { ExitView } from "./types";

const valuesOf = (x: ExitView): ExitValues => ({
  exitType: x.exitType,
  exitSubtype: x.exitSubtype ?? "",
  nationality: x.nationality,
  noticeStartDate: x.noticeStartDate ?? "",
  noticePeriodDays: String(x.noticePeriodDays),
  noticePeriodOverrideReason: x.noticePeriodOverrideReason ?? "",
  lastPhysicalWorkingDay: x.lastPhysicalWorkingDay ?? "",
  lastDayOfService: x.lastDayOfService ?? "",
  departureDate: x.departureDate ?? "",
});

type Result = { recalculated: number };

/**
 * Change the exit dates (Offboarding `PUT …/dates`, AC-3.3–3.6; API-only in the
 * source — F6). On an active case the open tasks keyed to a moved date are
 * recalculated and the owners are told; moving only the LPWD is an early
 * release and needs it approved.
 */
export function ExitDatesDialog({ exit }: { exit: ExitView }) {
  const t = useTranslations("jml.leavers.dates");
  const { run, busy } = useJmlAction(t("failed"));
  const [values, setValues] = useState<ExitValues>(() => valuesOf(exit));
  const [early, setEarly] = useState(exit.earlyReleaseApproved);
  const live = exit.status !== "DRAFT";
  return (
    <ActionDialog
      trigger={
        <Button variant="outline" size="sm">
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={live ? t("liveNote") : t("draftNote")}
      confirmLabel={t("save")}
      busy={busy}
      disabled={!values.noticeStartDate}
      onConfirm={async () => {
        const r = await run(
          () =>
            apiClient.put<Result>(`/api/jml/leavers/${exit.caseId}/dates`, {
              expectedVersion: exit.version,
              ...datesPayload(values),
              nationality: values.nationality,
              ...(live ? { earlyReleaseApproved: early } : {}),
            }),
          t("saved"),
        );
        return Boolean(r);
      }}
    >
      <ExitDateFields values={values} onChange={setValues} />
      {live ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={early} onChange={(e) => setEarly(e.target.checked)} />
          {t("earlyRelease")}
        </label>
      ) : null}
    </ActionDialog>
  );
}
