"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check } from "@/components/shared/FormControls";
import { CasesHalf, TicketsHalf, UnitFields } from "./HrCoverageFields";
import { apiClient, ApiError } from "@/lib/api-client";

/** One HR coverage row: the unit, the ticket half and the case half (ADR-102). */

export type Unit = { id: string; name: string; entityId: string };
type Person = { id: string; name: string | null; email: string; supervises: boolean };
export type CoverageOptions = {
  companies: { id: string; name: string }[];
  directorates: Unit[];
  departments: Unit[];
  teams: Unit[];
  pairs: { id: string; name: string }[];
  people: Person[];
};
export type CoverageRow = {
  id: string;
  level: "COMPANY" | "DIRECTORATE" | "DEPARTMENT" | "TEAM" | null;
  entityId: string | null;
  directorateId: string | null;
  departmentId: string | null;
  teamId: string | null;
  companyWide: boolean;
  pairId: string | null;
  label: string;
  aliases: string[];
  ownerUserId: string | null;
  supervisorUserId: string | null;
  caseTypes: string[];
  priority: number;
  active: boolean;
  pair: { id: string; name: string } | null;
  owner: { id: string; name: string | null; email: string } | null;
  supervisor: { id: string; name: string | null; email: string } | null;
};

export type UnitKind = "COMPANY" | "DIRECTORATE" | "DEPARTMENT" | "TEAM";

export type Form = {
  entityId: string;
  kind: UnitKind;
  unitId: string;
  companyWide: boolean;
  pairId: string;
  label: string;
  aliases: string;
  owner: string;
  supervisor: string;
  caseTypes: string[];
  priority: string;
  active: boolean;
};
export type SetField = <K extends keyof Form>(key: K, value: Form[K]) => void;

function unitKindOf(r: CoverageRow | null): UnitKind {
  if (r?.teamId) return "TEAM";
  if (r?.departmentId) return "DEPARTMENT";
  if (r?.directorateId) return "DIRECTORATE";
  return "COMPANY";
}

const EMPTY_FORM: Form = {
  entityId: "",
  kind: "COMPANY",
  unitId: "",
  companyWide: false,
  pairId: "",
  label: "",
  aliases: "",
  owner: "",
  supervisor: "",
  caseTypes: [],
  priority: "0",
  active: true,
};

function initialForm(r: CoverageRow | null): Form {
  if (!r) return EMPTY_FORM;
  return {
    entityId: r.entityId ?? "",
    kind: unitKindOf(r),
    unitId: r.teamId ?? r.departmentId ?? r.directorateId ?? "",
    companyWide: r.companyWide,
    pairId: r.pairId ?? "",
    label: r.label,
    aliases: r.aliases.join(", "),
    owner: r.ownerUserId ?? "",
    supervisor: r.supervisorUserId ?? "",
    caseTypes: r.caseTypes,
    priority: String(r.priority),
    active: r.active,
  };
}

const unitFor = (f: Form, kind: UnitKind) => (f.kind === kind ? f.unitId || null : null);

function toBody(f: Form) {
  return {
    entityId: f.entityId || null,
    directorateId: unitFor(f, "DIRECTORATE"),
    departmentId: unitFor(f, "DEPARTMENT"),
    teamId: unitFor(f, "TEAM"),
    companyWide: f.kind === "COMPANY" && f.companyWide,
    pairId: f.pairId || null,
    label: f.label,
    aliases: f.aliases
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter(Boolean),
    ownerUserId: f.owner || null,
    supervisorUserId: f.supervisor || null,
    caseTypes: f.caseTypes,
    priority: Number(f.priority || 0),
    active: f.active,
  };
}

function unitsFor(options: CoverageOptions, f: Form): Unit[] {
  const list: Record<UnitKind, Unit[]> = {
    COMPANY: [],
    DIRECTORATE: options.directorates,
    DEPARTMENT: options.departments,
    TEAM: options.teams,
  };
  return list[f.kind].filter((u) => !f.entityId || u.entityId === f.entityId);
}

export function HrCoverageDialog({
  row,
  options,
  can,
  onClose,
  onSaved,
}: {
  row: CoverageRow | null;
  options: CoverageOptions;
  can: { tickets: boolean; jml: boolean };
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("hrCoverage");
  const [f, setForm] = useState<Form>(() => initialForm(row));
  const set: SetField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const units = unitsFor(options, f);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (row) await apiClient.patch(`/api/hr-coverage/${row.id}`, toBody(f));
      else await apiClient.post("/api/hr-coverage", toBody(f));
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row ? t("editTitle") : t("addTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <UnitFields f={f} setForm={setForm} set={set} options={options} units={units} />
          <TicketsHalf f={f} set={set} options={options} enabled={can.tickets} />
          <CasesHalf f={f} set={set} options={options} enabled={can.jml} />
          <Check id="cov-active" checked={f.active} onChange={(v) => set("active", v)}>
            {t("activeLabel")}
          </Check>
          {error ? (
            <p role="alert" className="col-span-full text-sm text-destructive-emphasis">
              {error}
            </p>
          ) : null}
          <DialogFooter className="col-span-full">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
