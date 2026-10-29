"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/org/NativeSelect";
import { useHiringMutation } from "../ui/api";
import { Field } from "@/components/shared/FormControls";
import { useOrgOptions } from "../ui/org";
import { PersonPicker, type Person } from "../ui/person-picker";
import type { RoundView } from "./types";

/** Open a planning cycle — "Opening a planning cycle is an HR action". */
export function OpenCycleForm({ onOpened }: { onOpened: (id: string) => void }) {
  const t = useTranslations("hiring.planning");
  const org = useOrgOptions();
  const [label, setLabel] = useState("");
  const [entityId, setEntityId] = useState("");
  const [openedAt, setOpenedAt] = useState("");
  const create = useHiringMutation<object, { id: string }>("POST", "/api/hiring/planning-rounds", {
    success: t("cycleOpened"),
    onSuccess: (r) => onOpened(r.id),
  });
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Field label={t("cycleLabel")} htmlFor="pc-label" hint={t("cycleLabelHint")}>
        <Input id="pc-label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label={t("entity")} htmlFor="pc-entity">
        <NativeSelect id="pc-entity" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
          <option value="">{t("choose")}</option>
          {(org.data?.entities ?? [])
            .filter((e) => org.data?.manageableEntityIds.includes(e.id))
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <Field label={t("openedDate")} htmlFor="pc-date">
        <Input
          id="pc-date"
          type="date"
          value={openedAt}
          onChange={(e) => setOpenedAt(e.target.value)}
        />
      </Field>
      <div className="flex items-end">
        <Button
          disabled={!label.trim() || !entityId || create.isPending}
          onClick={() => create.mutate({ label, entityId, openedAt: openedAt || undefined })}
        >
          {t("openCycle")}
        </Button>
      </div>
    </div>
  );
}

/** Canvass a department: add it to the cycle with its head as owner. */
export function CanvassDialog({ round, onClose }: { round: RoundView; onClose: () => void }) {
  const t = useTranslations("hiring.planning");
  const org = useOrgOptions();
  const [departmentId, setDepartmentId] = useState("");
  const [owner, setOwner] = useState<Person | null>(null);
  const add = useHiringMutation<object>("POST", `/api/hiring/planning-rounds/${round.id}/needs`, {
    success: t("canvassed"),
    onSuccess: onClose,
  });
  const taken = new Set(round.needs.map((n) => n.departmentId));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("canvass")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t("department")} htmlFor="cv-dept">
            <NativeSelect
              id="cv-dept"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">{t("choose")}</option>
              {org
                .departmentsOf(round.entity?.id ?? "")
                .filter((d) => !taken.has(d.id))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label={t("departmentHead")} htmlFor="cv-owner">
            <PersonPicker id="cv-owner" value={owner} onChange={setOwner} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={!departmentId || add.isPending}
            onClick={() => add.mutate({ departmentId, ownerId: owner?.id ?? null })}
          >
            {t("addDepartment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
