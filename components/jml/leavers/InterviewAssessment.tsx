"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { Field } from "../Field";
import { useJmlAction } from "../use-jml";
import type { Interview } from "./InterviewTab";

const FACTORS = [
  "COMPENSATION",
  "CAREER_PROGRESSION",
  "MANAGER_RELATIONSHIP",
  "WORKLOAD_OR_BURNOUT",
  "RECOGNITION",
  "ROLE_CONTENT",
  "LEARNING_AND_DEVELOPMENT",
  "WORK_LIFE_BALANCE",
  "ORGANISATIONAL_DIRECTION",
  "OTHER",
];

/** US9 / AC-9.1–9.2: regrettable and preventable, by Senior HR or the HR Manager. */
export function InterviewAssessment({
  caseId,
  interview,
  canAssess,
}: {
  caseId: string;
  interview: Interview;
  canAssess: boolean;
}) {
  const t = useTranslations("jml.leavers.assessment");
  const { run, busy } = useJmlAction(t("failed"));
  const [v, setV] = useState({
    regrettable: interview.regrettable ?? "",
    preventable: interview.preventable ?? "",
    preventionFactor: interview.preventionFactor ?? "",
  });
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  return (
    <SectionCard
      title={t("title")}
      subtitle={
        interview.assessedAt
          ? t("assessedBy", {
              who: interview.assessor?.name ?? "—",
              date: interview.assessedAt.slice(0, 10),
            })
          : t("notYet")
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="as-reg" label={t("regrettable")}>
          <NativeSelect
            id="as-reg"
            className="w-full"
            disabled={!canAssess}
            value={v.regrettable}
            onChange={(e) => set({ regrettable: e.target.value })}
          >
            <option value="">{t("choose")}</option>
            {["REGRETTABLE", "NON_REGRETTABLE", "NEUTRAL"].map((x) => (
              <option key={x} value={x}>
                {t(`values.${x}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="as-prev" label={t("preventable")}>
          <NativeSelect
            id="as-prev"
            className="w-full"
            disabled={!canAssess}
            value={v.preventable}
            onChange={(e) =>
              set({
                preventable: e.target.value,
                preventionFactor: e.target.value === "PREVENTABLE" ? v.preventionFactor : "",
              })
            }
          >
            <option value="">{t("choose")}</option>
            {["PREVENTABLE", "NOT_PREVENTABLE", "UNCLEAR"].map((x) => (
              <option key={x} value={x}>
                {t(`values.${x}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {v.preventable === "PREVENTABLE" ? (
          <Field id="as-factor" label={t("factor")}>
            <NativeSelect
              id="as-factor"
              className="w-full"
              disabled={!canAssess}
              value={v.preventionFactor}
              onChange={(e) => set({ preventionFactor: e.target.value })}
            >
              <option value="">{t("choose")}</option>
              {FACTORS.map((x) => (
                <option key={x} value={x}>
                  {t(`factors.${x}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
      </div>
      {canAssess ? (
        <div className="mt-4 flex justify-end">
          <Button
            disabled={busy || !v.regrettable || !v.preventable}
            onClick={() =>
              void run(
                () =>
                  apiClient.put(`/api/jml/leavers/${caseId}/interview/assessment`, {
                    regrettable: v.regrettable || null,
                    preventable: v.preventable || null,
                    preventionFactor: v.preventionFactor || null,
                  }),
                t("saved"),
              )
            }
          >
            {t("save")}
          </Button>
        </div>
      ) : null}
    </SectionCard>
  );
}
