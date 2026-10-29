"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { Field } from "@/components/shared/FormControls";
import { LoadFailed, LoadingBlock } from "../States";
import { useJmlAction } from "../use-jml";
import { InterviewAssessment } from "./InterviewAssessment";

type Code = { code: string; label: string; level1: string; active: boolean };
export type Interview = {
  conducted: string;
  primaryL1: string;
  primaryL2Code: string;
  secondaryL2Code: string | null;
  narrative: string | null;
  destinationType: string | null;
  retentionAttempted: boolean | null;
  counterOfferMade: boolean | null;
  recommendScore: number;
  returnScore: number;
  interviewedAt: string | null;
  regrettable: string | null;
  preventable: string | null;
  preventionFactor: string | null;
  assessedAt: string | null;
  interviewer: { name: string | null } | null;
  assessor: { name: string | null } | null;
};
type Payload = {
  interview: Interview | null;
  taxonomy: Code[];
  can: { capture: boolean; assess: boolean };
};

const LEVEL1 = [
  "VOLUNTARY_ATTRACTED_AWAY",
  "VOLUNTARY_DISSATISFACTION",
  "VOLUNTARY_PERSONAL",
  "INVOLUNTARY_PERFORMANCE",
  "INVOLUNTARY_CONDUCT",
  "INVOLUNTARY_BUSINESS",
  "CONTRACT",
];
const DESTINATIONS = [
  "COMPETITOR",
  "SAME_SECTOR",
  "OTHER_SECTOR",
  "PUBLIC_SECTOR",
  "OVERSEAS",
  "STUDY",
  "NOT_DISCLOSED",
];
const tri = (v: boolean | null) => (v === null ? "" : v ? "yes" : "no");
const fromTri = (v: string) => (v === "" ? null : v === "yes");

/** The exit interview (§12.3–12.4) on the configured taxonomy (F9), then the assessment. */
export function InterviewTab({
  caseId,
  exitType,
  status,
}: {
  caseId: string;
  exitType: string;
  status: string;
}) {
  const t = useTranslations("jml.leavers.interview");
  const q = useQuery({
    queryKey: ["jml", "exit", caseId, "interview"],
    queryFn: () => apiClient.get<Payload>(`/api/jml/leavers/${caseId}/interview`),
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !q.data) return <LoadFailed />;
  const p = q.data;
  if (status === "DRAFT") return <p className="text-sm text-muted-foreground">{t("draft")}</p>;
  return (
    <div className="space-y-6">
      <InterviewForm
        key={p.interview?.primaryL2Code ?? "new"}
        caseId={caseId}
        exitType={exitType}
        p={p}
      />
      {p.interview ? (
        <InterviewAssessment caseId={caseId} interview={p.interview} canAssess={p.can.assess} />
      ) : null}
    </div>
  );
}

type FormValues = ReturnType<typeof initialValues>;

function initialValues(i: Interview | null) {
  return {
    conducted: i?.conducted ?? "CONDUCTED",
    primaryL1: i?.primaryL1 ?? LEVEL1[0]!,
    primaryL2Code: i?.primaryL2Code ?? "",
    secondaryL2Code: i?.secondaryL2Code ?? "",
    narrative: i?.narrative ?? "",
    destinationType: i?.destinationType ?? "",
    retentionAttempted: tri(i?.retentionAttempted ?? null),
    counterOfferMade: tri(i?.counterOfferMade ?? null),
    recommendScore: String(i?.recommendScore ?? ""),
    returnScore: String(i?.returnScore ?? ""),
    interviewedAt: i?.interviewedAt?.slice(0, 10) ?? "",
  };
}

function payloadOf(v: FormValues) {
  return {
    conducted: v.conducted,
    primaryL1: v.primaryL1,
    primaryL2Code: v.primaryL2Code,
    secondaryL2Code: v.secondaryL2Code || null,
    narrative: v.narrative.trim() || null,
    destinationType: v.destinationType || null,
    retentionAttempted: fromTri(v.retentionAttempted),
    counterOfferMade: fromTri(v.counterOfferMade),
    recommendScore: Number(v.recommendScore),
    returnScore: Number(v.returnScore),
    interviewedAt: v.interviewedAt || null,
  };
}

function ResignationFields({
  v,
  set,
  disabled,
}: {
  v: FormValues;
  set: (patch: Partial<FormValues>) => void;
  disabled: boolean;
}) {
  const t = useTranslations("jml.leavers.interview");
  return (
    <>
      <Field id="iv-retention" label={t("retention")}>
        <NativeSelect
          id="iv-retention"
          className="w-full"
          disabled={disabled}
          value={v.retentionAttempted}
          onChange={(e) => set({ retentionAttempted: e.target.value })}
        >
          <option value="">{t("choose")}</option>
          <option value="yes">{t("yes")}</option>
          <option value="no">{t("no")}</option>
        </NativeSelect>
      </Field>
      <Field id="iv-counter" label={t("counterOffer")}>
        <NativeSelect
          id="iv-counter"
          className="w-full"
          disabled={disabled}
          value={v.counterOfferMade}
          onChange={(e) => set({ counterOfferMade: e.target.value })}
        >
          <option value="">{t("choose")}</option>
          <option value="yes">{t("yes")}</option>
          <option value="no">{t("no")}</option>
        </NativeSelect>
      </Field>
    </>
  );
}

function InterviewForm({ caseId, exitType, p }: { caseId: string; exitType: string; p: Payload }) {
  const t = useTranslations("jml.leavers.interview");
  const tv = useTranslations("jml.leavers.reasons");
  const { run, busy } = useJmlAction(t("failed"));
  const i = p.interview;
  const [v, setV] = useState(() => initialValues(i));
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  const codes = p.taxonomy.filter(
    (c) =>
      c.level1 === v.primaryL1 &&
      (c.active || c.code === v.primaryL2Code || c.code === v.secondaryL2Code),
  );
  const resignation = exitType === "RESIGNATION";
  const save = () =>
    run(() => apiClient.put(`/api/jml/leavers/${caseId}/interview`, payloadOf(v)), t("saved"));
  const disabled = !p.can.capture;
  return (
    <SectionCard
      title={t("title")}
      subtitle={i ? t("recordedBy", { who: i.interviewer?.name ?? "—" }) : t("subtitle")}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="iv-conducted" label={t("conducted")}>
          <NativeSelect
            id="iv-conducted"
            className="w-full"
            disabled={disabled}
            value={v.conducted}
            onChange={(e) => set({ conducted: e.target.value })}
          >
            <option value="CONDUCTED">{t("conductedYes")}</option>
            <option value="DECLINED">{t("declined")}</option>
          </NativeSelect>
        </Field>
        <Field id="iv-date" label={t("date")}>
          <Input
            id="iv-date"
            type="date"
            disabled={disabled}
            value={v.interviewedAt}
            onChange={(e) => set({ interviewedAt: e.target.value })}
          />
        </Field>
        <Field id="iv-l1" label={t("category")}>
          <NativeSelect
            id="iv-l1"
            className="w-full"
            disabled={disabled}
            value={v.primaryL1}
            onChange={(e) =>
              set({ primaryL1: e.target.value, primaryL2Code: "", secondaryL2Code: "" })
            }
          >
            {LEVEL1.map((l) => (
              <option key={l} value={l}>
                {tv(l)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="iv-l2" label={t("primary")}>
          <NativeSelect
            id="iv-l2"
            className="w-full"
            disabled={disabled}
            value={v.primaryL2Code}
            onChange={(e) => set({ primaryL2Code: e.target.value })}
          >
            <option value="">{t("choose")}</option>
            {codes.map((c) => (
              <option key={c.code} value={c.code}>
                {`${c.code} ${c.label}`}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="iv-sec" label={t("secondary")}>
          <NativeSelect
            id="iv-sec"
            className="w-full"
            disabled={disabled}
            value={v.secondaryL2Code}
            onChange={(e) => set({ secondaryL2Code: e.target.value })}
          >
            <option value="">{t("none")}</option>
            {codes
              .filter((c) => c.code !== v.primaryL2Code)
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {`${c.code} ${c.label}`}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field id="iv-dest" label={t("destination")}>
          <NativeSelect
            id="iv-dest"
            className="w-full"
            disabled={disabled}
            value={v.destinationType}
            onChange={(e) => set({ destinationType: e.target.value })}
          >
            <option value="">{t("notSaid")}</option>
            {DESTINATIONS.map((d) => (
              <option key={d} value={d}>
                {t(`destinations.${d}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="iv-rec" label={t("recommend")}>
          <Input
            id="iv-rec"
            type="number"
            min={1}
            max={5}
            disabled={disabled}
            value={v.recommendScore}
            onChange={(e) => set({ recommendScore: e.target.value })}
          />
        </Field>
        <Field id="iv-ret" label={t("return")}>
          <Input
            id="iv-ret"
            type="number"
            min={1}
            max={5}
            disabled={disabled}
            value={v.returnScore}
            onChange={(e) => set({ returnScore: e.target.value })}
          />
        </Field>
        {resignation ? <ResignationFields v={v} set={set} disabled={disabled} /> : null}
      </div>
      <div className="mt-4">
        <Field id="iv-narr" label={t("narrative")} hint={t("narrativeHint")}>
          <textarea
            id="iv-narr"
            disabled={disabled}
            className="min-h-24 w-full rounded-md border border-input bg-background p-2 text-sm"
            value={v.narrative}
            onChange={(e) => set({ narrative: e.target.value })}
          />
        </Field>
      </div>
      {p.can.capture ? (
        <div className="mt-4 flex justify-end">
          <Button
            disabled={busy || !v.primaryL2Code || !v.recommendScore || !v.returnScore}
            onClick={() => void save()}
          >
            {t("save")}
          </Button>
        </div>
      ) : null}
    </SectionCard>
  );
}
