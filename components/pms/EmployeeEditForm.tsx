"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Form, TextField, useZodForm } from "@/components/shared/FormField";
import { EmployeePicker, type PickablePerson } from "@/components/pms/EmployeePicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";
import {
  ROLE_TRACKS,
  updateEmployeeSchema,
  type UpdateEmployeeInput,
} from "@/lib/validations/employee";

/**
 * HR's hand-edit of one employee record — spec §3, §1.2, §4.1.
 *
 * `lib/validations/employee.ts` opens by saying its schemas "guard the
 * hand-editing paths (HR fixing one record in the UI)". There was no such path:
 * `PUT /api/employees/[id]` had no caller anywhere in the product
 * (`docs/verification/SPEC-REDTEAM.md`, F12), so a mistyped name, a wrong
 * department or a role track set to the wrong value could only be corrected by
 * re-importing — and an import creates an `importBatch`, which permanently
 * blocks the demo fixture. HR's smallest correction was the product's most
 * expensive act.
 *
 * Four decisions shape this form:
 *
 *   1. **The schema IS the route's schema.** `updateEmployeeSchema` is bound as
 *      the resolver, so §1.2's exclusive-or, the manager requirement and §11.4's
 *      leaver rule are checked here in the same words, on the same field paths,
 *      as they are at the boundary. There is no second copy of those sentences
 *      to drift.
 *   2. **`PUT` is a full replace, so every field is carried — and TypeScript
 *      enforces it.** The submitted payload is typed `UpdateEmployeeInput`, whose
 *      every key is required, so a field this form forgets to hold is a build
 *      error rather than a silently wiped column. Salary is the one that matters:
 *      omitting it would encrypt `null` over a real figure and §11 would pay the
 *      wrong bonus for a year.
 *   3. **Only six fields are OFFERED.** Status and last working day belong to
 *      §12.1's audited departure path (`LeaverRecorder`), and `pmsRoles` to
 *      §4.3's roles screen. Both are held and returned unchanged; putting a
 *      second, unaudited control for them here would make "who recorded this
 *      departure" unanswerable.
 *   4. **`odooId` is absent, as it is from the schema.** §3.2 makes it the
 *      permanent key every downstream record hangs off. Correcting a mistyped ID
 *      is a delete-and-recreate, not an edit made in passing.
 */

/** §1.2 — a department belongs to exactly one entity, so the pair moves together. */
type DepartmentOption = { id: string; name: string; entityId: string };
type EntityOption = { id: string; code: string; name: string };

export interface EmployeeEditFormProps {
  employeeId: string;
  /**
   * The record as it stands, in the schema's own vocabulary. Every key of
   * `UpdateEmployeeInput` is here because the route replaces the whole row (see
   * note 2 above) — the ones this form does not render are returned untouched.
   */
  initial: UpdateEmployeeInput;
  /** For the manager control, which shows a name rather than an id. */
  managerName: string | null;
}

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground " +
  "outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed " +
  "disabled:opacity-50 aria-[invalid=true]:border-destructive";

export function EmployeeEditForm({ employeeId, initial, managerName }: EmployeeEditFormProps) {
  const t = useTranslations("pms.editEmployee");
  const tPms = useTranslations("pms");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { success } = useNotify();

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [manager, setManager] = useState<PickablePerson | null>(
    initial.managerId ? { id: initial.managerId, name: managerName ?? initial.managerId } : null,
  );

  const form = useZodForm(updateEmployeeSchema, { defaultValues: initial });
  const roleTrack = form.watch("roleTrack");
  const entityId = form.watch("entityId");
  const isCLevel = roleTrack === "C_LEVEL";

  const entities = useQuery({
    queryKey: ["pms", "org", "entities"],
    queryFn: () => apiClient.get<EntityOption[]>("/api/org/entities"),
    enabled: open,
  });

  const departments = useQuery({
    queryKey: ["pms", "org", "departments", entityId],
    queryFn: () =>
      apiClient.get<{ data: DepartmentOption[] }>(
        `/api/org/departments?pageSize=200&entityId=${encodeURIComponent(entityId)}`,
      ),
    enabled: open && !isCLevel && entityId !== "",
  });

  /*
    §1.2's two structural consequences, applied as the user types rather than
    left for the server to refuse:

      - a C-Level employee is tagged to an entity DIRECTLY and has no
        department, so the field is cleared and the control goes away;
      - departments are unique to their entity ("Rihal Marketing" and "TP Sales"
        are different departments), so moving someone between entities cannot
        carry the old department id with it.
  */
  useEffect(() => {
    if (isCLevel && form.getValues("departmentId") !== null) {
      form.setValue("departmentId", null, { shouldValidate: true });
    }
  }, [isCLevel, form]);

  useEffect(() => {
    if (isCLevel) return;
    const current = form.getValues("departmentId");
    if (!current) return;
    const options = departments.data?.data;
    if (options && !options.some((d) => d.id === current)) {
      form.setValue("departmentId", null, { shouldValidate: true });
    }
  }, [departments.data, isCLevel, form]);

  async function handleSubmit(values: UpdateEmployeeInput) {
    setSubmitting(true);
    setFormError(null);
    try {
      await apiClient.put(`/api/employees/${employeeId}`, values);
      setOpen(false);
      success(t("savedToast", { name: values.name }));
      router.refresh();
    } catch (e) {
      // The route's sentence, verbatim: it names the field and the rule
      // ("that department belongs to a different entity"), which is the only
      // part worth reading.
      setFormError(e instanceof ApiError ? e.message : t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  function chooseManager(person: PickablePerson | null) {
    setManager(person);
    form.setValue("managerId", person?.id ?? null, { shouldValidate: true });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" />
        {t("action")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (submitting) return;
          setOpen(next);
          if (!next) setFormError(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("help")}</DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              id="employee-edit-form"
              className="flex flex-col gap-4"
              onSubmit={form.handleSubmit(handleSubmit)}
            >
              <TextField name="name" label={tPms("name")} disabled={submitting} />
              <TextField name="email" type="email" label={tPms("email")} disabled={submitting} />

              <FormField
                name="roleTrack"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tPms("roleTrack")}</FormLabel>
                    <FormControl>
                      <select {...field} disabled={submitting} className={SELECT_CLASS}>
                        {ROLE_TRACKS.map((track) => (
                          <option key={track} value={track}>
                            {tPms(`track.${track}`)}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormDescription>{t("roleTrackHelp")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                name="entityId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tPms("entity")}</FormLabel>
                    <FormControl>
                      <select {...field} disabled={submitting} className={SELECT_CLASS}>
                        {(entities.data ?? []).map((entity) => (
                          <option key={entity.id} value={entity.id}>
                            {entity.code} — {entity.name}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormDescription>{t("entityHelp")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* §1.2 — C-Level are tagged to an entity directly. The control is
                  not disabled, it is absent: a greyed-out department box implies
                  a value someone could set, and there is none. */}
              {isCLevel ? (
                <p className="text-sm text-muted-foreground">{t("noDepartmentCLevel")}</p>
              ) : (
                <FormField
                  name="departmentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tPms("department")}</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                          disabled={submitting || departments.isPending}
                          className={SELECT_CLASS}
                        >
                          <option value="">{t("chooseDepartment")}</option>
                          {(departments.data?.data ?? []).map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                name="managerId"
                render={() => (
                  <FormItem>
                    <FormLabel>{tPms("manager")}</FormLabel>
                    {manager ? (
                      <div className="flex items-center gap-2">
                        <Input readOnly value={manager.name} />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={submitting}
                          onClick={() => chooseManager(null)}
                        >
                          {t("change")}
                        </Button>
                      </div>
                    ) : (
                      <EmployeePicker
                        id="employee-edit-manager"
                        label={t("searchManager")}
                        exclude={[employeeId]}
                        onPick={chooseManager}
                      />
                    )}
                    <FormDescription>
                      {isCLevel ? t("managerHelpCLevel") : t("managerHelp")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Said out loud, because the form silently returns these three
                  unchanged and a reader would otherwise wonder where they went. */}
              <p className="max-w-prose text-xs text-muted-foreground">{t("notEditedHere")}</p>
            </form>
          </Form>

          {formError ? (
            <p role="alert" className="text-sm text-destructive-emphasis">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" form="employee-edit-form" disabled={submitting}>
              {submitting ? t("saving") : t("saveAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
