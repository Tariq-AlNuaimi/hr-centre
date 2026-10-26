"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/shared/SectionCard";
import { NativeSelect } from "@/components/org/NativeSelect";
import { EmployeePicker, type PickablePerson } from "@/components/pms/EmployeePicker";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";
import { ROLE_TRACKS } from "@/lib/validations/employee";
import { RecordFields, recordPayload, type RecordValues } from "./RecordFields";

type Company = { id: string; code: string; name: string };
type Department = { id: string; name: string; entityId: string };
type Team = { id: string; name: string };

/**
 * Add employee — blueprint §5 "typing" (F-b, AC-F5.2). The same writer and the
 * same rules as the import; the server's sentence is shown verbatim when it
 * refuses (it names the field — AC-F2.1).
 */
export function AddEmployeeForm({
  locale,
  canEditPersonal,
  canEditIdDocuments,
}: {
  locale: string;
  canEditPersonal: boolean;
  canEditIdDocuments: boolean;
}) {
  const t = useTranslations("people.add");
  const tPms = useTranslations("pms");
  const router = useRouter();
  const { success } = useNotify();

  const [core, setCore] = useState({
    odooId: "",
    name: "",
    email: "",
    roleTrack: "INDIVIDUAL",
    entityId: "",
    departmentId: "",
    teamId: "",
    dateOfJoining: "",
    basicSalary: "",
  });
  const [manager, setManager] = useState<PickablePerson | null>(null);
  const [record, setRecord] = useState<RecordValues>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const isCLevel = core.roleTrack === "C_LEVEL";
  const set = (key: keyof typeof core, value: string) => setCore((c) => ({ ...c, [key]: value }));

  const companies = useQuery({
    queryKey: ["org", "companies", "options"],
    queryFn: () => apiClient.get<Company[]>("/api/org/entities"),
  });
  const departments = useQuery({
    queryKey: ["org", "departments", "options", core.entityId],
    queryFn: () =>
      apiClient.get<{ data: Department[] }>(
        `/api/org/departments?pageSize=100&entityId=${encodeURIComponent(core.entityId)}`,
      ),
    enabled: core.entityId !== "" && !isCLevel,
  });
  const teams = useQuery({
    queryKey: ["org", "teams", "options", core.departmentId],
    queryFn: () =>
      apiClient.get<{ data: Team[] }>(
        `/api/org/teams?pageSize=100&departmentId=${encodeURIComponent(core.departmentId)}`,
      ),
    enabled: core.departmentId !== "" && !isCLevel,
  });

  async function submit() {
    setSubmitting(true);
    setFormError(null);
    try {
      const createdEmployee = await apiClient.post<{ id: string }>("/api/employees", {
        employee: {
          odooId: core.odooId,
          name: core.name,
          email: core.email,
          roleTrack: core.roleTrack,
          entityId: core.entityId,
          departmentId: isCLevel ? null : core.departmentId || null,
          teamId: isCLevel ? null : core.teamId || null,
          managerId: manager?.id ?? null,
          dateOfJoining: core.dateOfJoining || null,
          basicSalary: core.basicSalary.trim() || null,
        },
        record: recordPayload(record, {
          personal: canEditPersonal,
          idDocuments: canEditIdDocuments,
        }),
      });
      success(t("created", { name: core.name }));
      router.push(`/${locale}/people/${createdEmployee.id}`);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t("failed"));
      setSubmitting(false);
    }
  }

  const label = (htmlFor: string, text: string) => (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-foreground">
      {text}
    </label>
  );

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <SectionCard title={t("identity")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            {label("add-odooId", tPms("employeeId"))}
            <Input
              id="add-odooId"
              value={core.odooId}
              onChange={(e) => set("odooId", e.target.value)}
            />
          </div>
          <div>
            {label("add-name", tPms("name"))}
            <Input id="add-name" value={core.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            {label("add-email", tPms("email"))}
            <Input
              id="add-email"
              type="email"
              value={core.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
          <div>
            {label("add-track", tPms("roleTrack"))}
            <NativeSelect
              id="add-track"
              value={core.roleTrack}
              onChange={(e) => set("roleTrack", e.target.value)}
              className="w-full"
            >
              {ROLE_TRACKS.map((track) => (
                <option key={track} value={track}>
                  {tPms(`track.${track}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            {label("add-joined", tPms("dateOfJoining"))}
            <Input
              id="add-joined"
              type="date"
              value={core.dateOfJoining}
              onChange={(e) => set("dateOfJoining", e.target.value)}
            />
          </div>
          <div>
            {label("add-salary", tPms("basicSalary"))}
            <Input
              id="add-salary"
              inputMode="decimal"
              value={core.basicSalary}
              onChange={(e) => set("basicSalary", e.target.value)}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("placement")} subtitle={isCLevel ? t("cLevelNote") : undefined}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            {label("add-company", t("company"))}
            <NativeSelect
              id="add-company"
              value={core.entityId}
              onChange={(e) =>
                setCore((c) => ({ ...c, entityId: e.target.value, departmentId: "", teamId: "" }))
              }
              className="w-full"
            >
              <option value="">{t("choose")}</option>
              {(companies.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {!isCLevel ? (
            <>
              <div>
                {label("add-dept", tPms("department"))}
                <NativeSelect
                  id="add-dept"
                  value={core.departmentId}
                  disabled={!core.entityId}
                  onChange={(e) =>
                    setCore((c) => ({ ...c, departmentId: e.target.value, teamId: "" }))
                  }
                  className="w-full"
                >
                  <option value="">{t("choose")}</option>
                  {(departments.data?.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                {label("add-team", t("team"))}
                <NativeSelect
                  id="add-team"
                  value={core.teamId}
                  disabled={!core.departmentId}
                  onChange={(e) => set("teamId", e.target.value)}
                  className="w-full"
                >
                  <option value="">{t("noTeam")}</option>
                  {(teams.data?.data ?? []).map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </>
          ) : null}
          <div>
            {manager ? (
              <div>
                <p className="mb-1 text-sm font-medium text-foreground">{tPms("manager")}</p>
                <p className="flex items-center gap-2 text-sm text-foreground">
                  {manager.name}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setManager(null)}>
                    {t("changeManager")}
                  </Button>
                </p>
              </div>
            ) : (
              <EmployeePicker id="add-manager" label={tPms("manager")} onPick={setManager} />
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("details")}>
        <RecordFields
          values={record}
          onChange={(field, value) => setRecord((r) => ({ ...r, [field]: value }))}
          showPersonal={canEditPersonal}
          showIdDocuments={canEditIdDocuments}
          disabled={submitting}
        />
      </SectionCard>

      {formError ? (
        <p role="alert" className="text-sm text-destructive-emphasis">
          {formError}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={submitting || !core.odooId || !core.name || !core.email || !core.entityId}
      >
        {submitting ? t("saving") : t("submit")}
      </Button>
    </form>
  );
}
