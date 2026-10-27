"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { Field } from "../Field";
import { useJmlAction, useJmlLookups } from "../use-jml";

export const DEDUCTION_TYPES = [
  "VISA_COST_RECOVERY",
  "MEDICAL_INSURANCE",
  "NEGATIVE_LEAVE_BALANCE",
  "NOTICE_SHORTFALL",
  "UNRETURNED_OR_DAMAGED_ASSET",
  "OUTSTANDING_ADVANCE_OR_LOAN",
] as const;

/** C4: a line with its type, amount, reason code, documentary reference and authoriser. */
export function SettlementLineDialog({ caseId }: { caseId: string }) {
  const t = useTranslations("jml.leavers.settlement");
  const lookups = useJmlLookups();
  const { run, busy } = useJmlAction(t("failed"));
  const [v, setV] = useState({
    lineType: "DEDUCTION",
    deductionType: "NEGATIVE_LEAVE_BALANCE",
    description: "",
    lineAmount: "",
    reasonCode: "",
    documentaryReference: "",
    authorisedById: "",
  });
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  const ready =
    v.description.trim().length > 1 &&
    v.lineAmount &&
    v.reasonCode.trim() &&
    v.documentaryReference.trim() &&
    v.authorisedById;
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="outline">
          {t("addLine")}
        </Button>
      }
      title={t("addLineTitle")}
      description={t("addLineBody")}
      confirmLabel={t("addLine")}
      busy={busy}
      disabled={!ready}
      onConfirm={async () =>
        Boolean(
          await run(
            () =>
              apiClient.post(`/api/jml/leavers/${caseId}/settlement/lines`, {
                ...v,
                deductionType: v.lineType === "DEDUCTION" ? v.deductionType : null,
                description: v.description.trim(),
                reasonCode: v.reasonCode.trim(),
                documentaryReference: v.documentaryReference.trim(),
              }),
            t("lineAdded"),
          ),
        )
      }
    >
      <Field id="ln-type" label={t("lineKind")}>
        <NativeSelect
          id="ln-type"
          className="w-full"
          value={v.lineType}
          onChange={(e) => set({ lineType: e.target.value })}
        >
          <option value="DEDUCTION">{t("lineType.DEDUCTION")}</option>
          <option value="ADDITION">{t("lineType.ADDITION")}</option>
        </NativeSelect>
      </Field>
      {v.lineType === "DEDUCTION" ? (
        <Field id="ln-dtype" label={t("deductionType")}>
          <NativeSelect
            id="ln-dtype"
            className="w-full"
            value={v.deductionType}
            onChange={(e) => set({ deductionType: e.target.value })}
          >
            {DEDUCTION_TYPES.map((d) => (
              <option key={d} value={d}>
                {t(`deductionTypes.${d}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      <Field id="ln-desc" label={t("description")}>
        <Input
          id="ln-desc"
          value={v.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>
      <Field id="ln-amount" label={t("amount")}>
        <Input
          id="ln-amount"
          inputMode="decimal"
          value={v.lineAmount}
          onChange={(e) => set({ lineAmount: e.target.value })}
        />
      </Field>
      <Field id="ln-reason" label={t("reasonCode")}>
        <Input
          id="ln-reason"
          value={v.reasonCode}
          onChange={(e) => set({ reasonCode: e.target.value })}
        />
      </Field>
      <Field id="ln-ref" label={t("documentaryRef")}>
        <Input
          id="ln-ref"
          value={v.documentaryReference}
          onChange={(e) => set({ documentaryReference: e.target.value })}
        />
      </Field>
      <Field id="ln-by" label={t("authorisedBy")}>
        <NativeSelect
          id="ln-by"
          className="w-full"
          value={v.authorisedById}
          onChange={(e) => set({ authorisedById: e.target.value })}
        >
          <option value="">{t("choose")}</option>
          {(lookups.data?.hrUsers ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.email}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </ActionDialog>
  );
}
