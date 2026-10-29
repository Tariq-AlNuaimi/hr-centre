"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { Field } from "@/components/shared/FormControls";
import { useJmlAction, useJmlLookups } from "../use-jml";
import type { ExitView } from "./types";

const BACKFILL = ["PENDING", "BACKFILL", "RELEASE", "DEFERRED"] as const;
const REHIRE = ["YES", "CONDITIONAL", "NO"] as const;

/** Classification, flags, documentation, backfill and rehire — the writers F4 said were missing. */
export function ExitDetailsDialog({ exit }: { exit: ExitView }) {
  const t = useTranslations("jml.leavers.details");
  const tv = useTranslations("jml.leavers.vocab");
  const lookups = useJmlLookups();
  const { run, busy } = useJmlAction(t("failed"));
  const [v, setV] = useState({
    positionClassificationId: "",
    settlementApplicable: exit.settlementApplicable,
    visaSupportApplicable: exit.visaSupportApplicable,
    perf: exit.docRefPerformanceHistory ?? "",
    grounds: exit.docRefWrittenGrounds ?? "",
    legal: exit.docRefLegalReview ?? "",
    backfillDecision: exit.backfillDecision,
    backfillApprovalRef: exit.backfillApprovalRef ?? "",
    rehireEligible: exit.rehireEligible ?? "",
  });
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  const orNull = (s: string) => (s.trim() ? s.trim() : null);
  return (
    <ActionDialog
      trigger={
        <Button variant="outline" size="sm">
          {t("open")}
        </Button>
      }
      title={t("title")}
      confirmLabel={t("save")}
      busy={busy}
      onConfirm={async () =>
        Boolean(
          await run(
            () =>
              apiClient.patch(`/api/jml/leavers/${exit.caseId}`, {
                expectedVersion: exit.version,
                ...(v.positionClassificationId
                  ? { positionClassificationId: v.positionClassificationId }
                  : {}),
                settlementApplicable: v.settlementApplicable,
                visaSupportApplicable: v.visaSupportApplicable,
                docRefPerformanceHistory: orNull(v.perf),
                docRefWrittenGrounds: orNull(v.grounds),
                docRefLegalReview: orNull(v.legal),
                backfillDecision: v.backfillDecision,
                backfillApprovalRef: orNull(v.backfillApprovalRef),
                rehireEligible: v.rehireEligible || null,
              }),
            t("saved"),
          ),
        )
      }
    >
      <Field
        id="ed-class"
        label={t("classification")}
        hint={t("classificationHint", { current: exit.positionClassification ?? "—" })}
      >
        <NativeSelect
          id="ed-class"
          className="w-full"
          value={v.positionClassificationId}
          onChange={(e) => set({ positionClassificationId: e.target.value })}
        >
          <option value="">{t("keep")}</option>
          {(lookups.data?.classifications ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.settlementApplicable}
          onChange={(e) => set({ settlementApplicable: e.target.checked })}
        />
        {t("settlement")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.visaSupportApplicable}
          onChange={(e) => set({ visaSupportApplicable: e.target.checked })}
        />
        {t("visaSupport")}
      </label>
      <Field id="ed-perf" label={t("docPerf")}>
        <Input id="ed-perf" value={v.perf} onChange={(e) => set({ perf: e.target.value })} />
      </Field>
      <Field id="ed-grounds" label={t("docGrounds")}>
        <Input
          id="ed-grounds"
          value={v.grounds}
          onChange={(e) => set({ grounds: e.target.value })}
        />
      </Field>
      <Field id="ed-legal" label={t("docLegal")}>
        <Input id="ed-legal" value={v.legal} onChange={(e) => set({ legal: e.target.value })} />
      </Field>
      <Field id="ed-backfill" label={t("backfill")}>
        <NativeSelect
          id="ed-backfill"
          className="w-full"
          value={v.backfillDecision}
          onChange={(e) => set({ backfillDecision: e.target.value })}
        >
          {BACKFILL.map((b) => (
            <option key={b} value={b}>
              {tv(`backfill.${b}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="ed-bref" label={t("backfillRef")}>
        <Input
          id="ed-bref"
          value={v.backfillApprovalRef}
          onChange={(e) => set({ backfillApprovalRef: e.target.value })}
        />
      </Field>
      <Field id="ed-rehire" label={t("rehire")}>
        <NativeSelect
          id="ed-rehire"
          className="w-full"
          value={v.rehireEligible}
          onChange={(e) => set({ rehireEligible: e.target.value })}
        >
          <option value="">{t("notAssessed")}</option>
          {REHIRE.map((r) => (
            <option key={r} value={r}>
              {tv(`rehire.${r}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </ActionDialog>
  );
}
