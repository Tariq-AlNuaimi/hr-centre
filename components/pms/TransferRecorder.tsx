"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmployeePicker, type PickablePerson } from "@/components/pms/EmployeePicker";
import { apiClient } from "@/lib/api-client";
import { BYPASS_REASON_MIN, BypassReasonField } from "./BypassReasonField";

/**
 * §12.3's mid-cycle transfer — the move that splits the performance year in two.
 *
 * `POST /api/transfers` had no caller, so the whole split-year mechanism, with
 * its day-weighted score, could only be created by writing to the database
 * (`docs/verification/SPEC-REDTEAM.md`, F4).
 *
 * The transfer DATE is an input to the score, not an administrative detail:
 * §12.3 weights each period by days-in-department ÷ 365. The field says so,
 * because a date typed carelessly here changes what someone is paid.
 */

export function TransferRecorder({ cycleId, onDone }: { cycleId: string; onDone: () => void }) {
  const t = useTranslations("pms.edgeCaseRecord.transfer");
  const queryClient = useQueryClient();
  const [person, setPerson] = useState<PickablePerson | null>(null);
  const [reason, setReason] = useState("");
  const [manager, setManager] = useState<PickablePerson | null>(null);
  const [transferDate, setTransferDate] = useState("");
  const [newDepartmentId, setNewDepartmentId] = useState("");

  const departments = useQuery({
    queryKey: ["pms", "org", "departments"],
    queryFn: () =>
      apiClient.get<{ data: Array<{ id: string; name: string }> }>(
        "/api/org/departments?pageSize=200",
      ),
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post("/api/transfers", {
        employeeId: person?.id,
        bypassReason: reason.trim(),
        cycleId,
        transferDate,
        newDepartmentId: newDepartmentId || null,
        ...(manager ? { newManagerEmployeeId: manager.id } : {}),
      }),
    onSuccess: () => {
      toast.success(t("savedToast", { name: person?.name ?? "" }));
      setPerson(null);
      setManager(null);
      setTransferDate("");
      setNewDepartmentId("");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["pms", "edgeCases"] });
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const ready =
    person !== null &&
    reason.trim().length >= BYPASS_REASON_MIN &&
    transferDate !== "" &&
    newDepartmentId !== "";

  return (
    <SectionCard
      title={t("title")}
      subtitle={t("help")}
      actions={
        <Button onClick={() => mutation.mutate()} disabled={!ready || mutation.isPending}>
          {mutation.isPending ? t("working") : t("action")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {person ? (
          <div className="space-y-1">
            <Label htmlFor="transfer-chosen">{t("who")}</Label>
            <div className="flex items-center gap-2">
              <Input id="transfer-chosen" value={person.name} readOnly />
              <Button variant="outline" size="sm" onClick={() => setPerson(null)}>
                {t("change")}
              </Button>
            </div>
          </div>
        ) : (
          <EmployeePicker id="transfer-search" label={t("who")} onPick={setPerson} />
        )}

        <div className="space-y-1">
          <Label htmlFor="transfer-date">{t("date")}</Label>
          <Input
            id="transfer-date"
            type="date"
            value={transferDate}
            onChange={(e) => setTransferDate(e.target.value)}
          />
          {/* §12.3 weights each period by days-in-department ÷ 365, so this date
              is not administrative — it is an input to the score. */}
          <p className="text-xs text-muted-foreground">{t("dateNote")}</p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="transfer-department">{t("newDepartment")}</Label>
          <select
            id="transfer-department"
            value={newDepartmentId}
            onChange={(e) => setNewDepartmentId(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="">{t("choose")}</option>
            {(departments.data?.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        {manager ? (
          <div className="space-y-1">
            <Label htmlFor="transfer-manager-chosen">{t("newManager")}</Label>
            <div className="flex items-center gap-2">
              <Input id="transfer-manager-chosen" value={manager.name} readOnly />
              <Button variant="outline" size="sm" onClick={() => setManager(null)}>
                {t("change")}
              </Button>
            </div>
          </div>
        ) : (
          <EmployeePicker
            id="transfer-manager"
            label={t("newManager")}
            exclude={person ? [person.id] : []}
            onPick={setManager}
          />
        )}
        <BypassReasonField id="transfer-bypass" value={reason} onChange={setReason} />
      </div>

      <p className="mt-4 max-w-prose text-sm text-muted-foreground">{t("consequences")}</p>
    </SectionCard>
  );
}
