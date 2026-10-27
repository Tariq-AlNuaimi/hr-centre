"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNotify } from "@/hooks/use-notify";
import { useControllableOpen } from "@/hooks/use-controllable-open";
import { apiClient, ApiError } from "@/lib/api-client";
import { RecordFields, recordPayload, type RecordValues } from "./RecordFields";

/**
 * Edit details — the F-b record fields of one employee, via the PARTIAL
 * `PATCH /api/employees/[id]/record`. The server's refusal sentence is shown
 * verbatim (it names the field and why — AC-F2.1).
 */
export function EmployeeRecordForm({
  employeeId,
  initial,
  canEditPersonal,
  canEditIdDocuments,
  open: openProp,
  onOpenChange,
}: {
  employeeId: string;
  initial: RecordValues;
  canEditPersonal: boolean;
  canEditIdDocuments: boolean;
  /** Controlled open state (opened from the record's Edit menu); no own trigger then. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("people.record");
  const router = useRouter();
  const { success } = useNotify();
  const [open, setOpenState, controlled] = useControllableOpen(openProp, onOpenChange);
  const [values, setValues] = useState<RecordValues>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Every opening starts from the record as saved, never from an abandoned edit.
  function setOpen(next: boolean) {
    if (next) {
      setValues(initial);
      setFormError(null);
    }
    setOpenState(next);
  }

  async function save() {
    setSubmitting(true);
    setFormError(null);
    try {
      // Only what changed: an untouched ID number is not re-encrypted, and
      // the audit trail shows the edit that was actually made.
      const all = recordPayload(values, {
        personal: canEditPersonal,
        idDocuments: canEditIdDocuments,
      });
      const changed = Object.fromEntries(
        Object.entries(all).filter(([k, v]) => v !== (initial[k as keyof RecordValues] ?? "")),
      );
      await apiClient.patch(`/api/employees/${employeeId}/record`, changed);
      setOpen(false);
      success(t("saved"));
      router.refresh();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t("saveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {controlled ? null : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Pencil className="h-4 w-4" />
          {t("edit")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={(next) => !submitting && setOpen(next)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("editTitle")}</DialogTitle>
            <DialogDescription>{t("editHelp")}</DialogDescription>
          </DialogHeader>
          <form
            id="employee-record-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <RecordFields
              values={values}
              onChange={(field, value) => setValues((v) => ({ ...v, [field]: value }))}
              showPersonal={canEditPersonal}
              showIdDocuments={canEditIdDocuments}
              disabled={submitting}
            />
          </form>
          {formError ? (
            <p role="alert" className="text-sm text-destructive-emphasis">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="employee-record-form" disabled={submitting}>
              {submitting ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
