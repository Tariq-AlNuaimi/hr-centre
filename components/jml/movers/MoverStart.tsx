"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmployeePicker } from "@/components/pms/EmployeePicker";
import { apiClient } from "@/lib/api-client";
import { Field } from "../Field";
import { CaseStatusBadge } from "../CaseBits";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";
import { MoverForm } from "./MoverForm";

export type MoveProfile = {
  employee: {
    id: string;
    name: string;
    status: string;
    employeeCode: string | null;
    roleTrack: string;
  };
  details: Record<string, string | null>;
  labels: Record<string, string | null>;
  refusal: string | null;
  canStart: boolean;
  openMove: { id: string; caseRef: string } | null;
  history: Array<{
    id: string;
    caseRef: string;
    status: string;
    createdAt: string;
    moveDetail: { changeType: string; effectiveDate: string; appliedAt: string | null } | null;
  }>;
};

const FIELDS = [
  "entityId",
  "departmentId",
  "teamId",
  "jobTitle",
  "employmentType",
  "contractTypeId",
  "workLocation",
  "managerId",
];

/** Start an internal change — Onboarding `/employees/[id]` + `InternalChangeForm`. */
export function MoverStart() {
  const t = useTranslations("jml.movers");
  const { can, isLoading } = useJmlAccess();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const profile = useQuery({
    queryKey: ["jml", "move-profile", employeeId],
    queryFn: () => apiClient.get<MoveProfile>(`/api/jml/movers/profile?employeeId=${employeeId}`),
    enabled: Boolean(employeeId),
  });
  if (isLoading) return <LoadingBlock />;
  if (!can("jml.manageMovers")) return <NotPermitted title={t("startTitle")} />;
  const p = profile.data;
  return (
    <div className="space-y-6">
      <PageHeader title={t("startTitle")} subtitle={t("startSubtitle")} />
      <SectionCard title={t("whoTitle")}>
        {p ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium">{p.employee.name}</span>
            <Button size="sm" variant="ghost" onClick={() => setEmployeeId(null)}>
              {t("changeEmployee")}
            </Button>
          </div>
        ) : (
          <EmployeePicker
            id="mover-pick"
            label={t("employee")}
            onPick={(x) => setEmployeeId(x.id)}
          />
        )}
      </SectionCard>
      {employeeId && profile.isLoading ? <LoadingBlock /> : null}
      {profile.isError ? <LoadFailed /> : null}
      {p ? <Profile p={p} /> : null}
    </div>
  );
}

function Profile({ p }: { p: MoveProfile }) {
  const t = useTranslations("jml.movers");
  const tc = useTranslations("people.record.contract");
  const router = useRouter();
  const label = (f: string) => {
    const value = p.labels[f];
    if (!value) return t("none");
    return f === "employmentType" ? tc(value) : value;
  };
  return (
    <>
      <SectionCard title={t("currentTitle")}>
        <DescriptionList
          columns={2}
          items={[
            { key: "code", label: t("employeeCode"), value: <EmployeeCode p={p} /> },
            ...FIELDS.map((f) => ({ key: f, label: t(`field.${f}`), value: label(f) })),
          ]}
        />
      </SectionCard>
      {p.refusal ? (
        <p role="status" className="rounded-md bg-status-warn p-3 text-sm text-status-warn-fg">
          {p.refusal}
        </p>
      ) : p.openMove ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("openMove", { ref: p.openMove.caseRef })}{" "}
          <Link href={`/jml/cases/${p.openMove.id}`} className="text-primary hover:underline">
            {t("openCase")}
          </Link>
        </p>
      ) : p.canStart ? (
        <MoverForm profile={p} onCreated={(id) => router.push(`/jml/cases/${id}`)} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("cannotStart")}</p>
      )}
      <SectionCard title={t("historyTitle")}>
        {p.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {p.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/jml/cases/${h.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {h.caseRef}
                </Link>
                <span>{h.moveDetail ? t(`changeType.${h.moveDetail.changeType}`) : null}</span>
                <span className="text-muted-foreground">
                  {t("effective", { date: h.moveDetail?.effectiveDate.slice(0, 10) ?? "" })}
                </span>
                <CaseStatusBadge status={h.status} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}

/** Onboarding R2: record the EMP code of an existing employee (once; never changes). */
function EmployeeCode({ p }: { p: MoveProfile }) {
  const t = useTranslations("jml.movers");
  const { run, busy } = useJmlAction(t("codeFailed"));
  const [code, setCode] = useState("");
  if (p.employee.employeeCode) return <span>{p.employee.employeeCode}</span>;
  return (
    <span className="flex items-center gap-2">
      <Field id="emp-code" label={t("recordCode")}>
        <Input
          id="emp-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-40"
        />
      </Field>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !code.trim()}
        onClick={() =>
          void run(
            () =>
              apiClient.post(`/api/jml/people/${p.employee.id}/employee-code`, {
                employeeCode: code.trim(),
              }),
            t("codeRecorded"),
          )
        }
      >
        {t("save")}
      </Button>
    </span>
  );
}
