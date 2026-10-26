"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { PageSkeleton, TableSkeleton } from "@/components/shared/Skeletons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CycleForm, type CycleFormSubmitValues } from "@/components/pms/CycleForm";
import { CycleList, type PerformanceCycle } from "@/components/pms/CycleList";
import { CyclePolicyDialog } from "@/components/pms/CyclePolicyDialog";
import { usePmsActor } from "@/hooks/use-pms-actor";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";

/**
 * Performance cycles — spec §2 (the year and its three touchpoints), §5.4 (a
 * deadline is a hard lock) and §5.5 (an extension is a formal HR intervention).
 *
 * List archetype: PageHeader → DataTable, with the two writes in dialogs.
 *
 * Who may run a cycle is `canRunCycle` (§4.1: HR Super Admin OR HRBP — "runs the
 * cycle org-wide"), which is deliberately WIDER than `capabilities.configure`
 * (Super Admin only) used by org setup, and read here off the actor's own roles
 * rather than a capability flag so the page asks the same question the route
 * does. `usePmsActor` fails closed, so an unresolved actor manages nothing.
 *
 * Reading the cycles is open to any authenticated user at the API (which years
 * exist is not personnel data), but this screen is HR's console; a non-HR viewer
 * is told so rather than shown controls that would 403.
 */
export default function CyclesPage() {
  const t = useTranslations("pms");
  const tCommon = useTranslations("common");
  const { capabilities, isLoading: actorLoading } = usePmsActor();
  const { success, warning, error: showError } = useNotify();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PerformanceCycle | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyCycleId, setBusyCycleId] = useState<string | null>(null);
  const [policyCycle, setPolicyCycle] = useState<PerformanceCycle | null>(null);

  const canRunCycle = capabilities.hr;

  const cycles = useQuery({
    queryKey: ["pms", "cycles"],
    queryFn: () => apiClient.get<PerformanceCycle[]>("/api/cycles"),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["pms", "cycles"] });
  }

  async function handleCreate(values: CycleFormSubmitValues) {
    setSubmitting(true);
    setFormError(null);
    try {
      await apiClient.post("/api/cycles", values);
      success(t("cycles.created", { year: values.year }));
      setCreateOpen(false);
      await refresh();
    } catch (e) {
      // Shown in the dialog, next to the fields it is about — a toast would
      // scroll away while the user is still looking at the form.
      setFormError(e instanceof ApiError ? e.message : t("cycles.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveStages(values: CycleFormSubmitValues) {
    if (!editing) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const saved = await apiClient.put<{ reopenedChangeRequests: number }>(
        `/api/cycles/${editing.id}/stages`,
        { stages: values.stages },
      );
      // §6.2 — extending a mid-year deadline brings back the change requests
      // that deadline had locked (ADR-072). HR has to be told, for the same
      // reason the enrolment count below is in its confirmation: a side effect
      // nobody is shown is one they find out about from someone else.
      const reopened = saved?.reopenedChangeRequests ?? 0;
      success(
        reopened > 0
          ? t("cycles.deadlinesSavedReopened", { year: editing.year, count: reopened })
          : t("cycles.deadlinesSaved", { year: editing.year }),
      );
      setEditing(null);
      await refresh();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t("cycles.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  // §3.5 — the manual half of the enrolment fix. The import runs this itself
  // now; this is for the import that applied while enrolment did not, and for
  // employees who arrived by some other path. Idempotent, so a zero is a real
  // answer ("nobody was missing"), not a failure, and it says so.
  async function enrolMissing(cycle: PerformanceCycle) {
    setBusyCycleId(cycle.id);
    try {
      const result = await apiClient.post<{
        participantsAdded: number;
        participantsPending: number;
        goalSettingClosed: boolean;
      }>(`/api/cycles/${cycle.id}/participants`, {});
      const added = result?.participantsAdded ?? 0;
      const pending = result?.participantsPending ?? 0;
      success(
        added > 0
          ? t("cycles.enrolledMissing", { year: cycle.year, count: added })
          : t("cycles.enrolledNobodyMissing", { year: cycle.year }),
      );
      // Each call is bounded, so a big backlog clears over several presses.
      // Saying how many are left makes that obvious instead of mysterious.
      if (pending > 0) warning(t("cycles.enrolMorePending", { count: pending }));
      // The consequence, said at the moment it is caused rather than discovered
      // at calibration time months later.
      if (result?.goalSettingClosed) warning(t("cycles.enrolledAfterGoalSetting"));
      await refresh();
    } catch (e) {
      showError(e instanceof ApiError ? e.message : t("cycles.enrolMissingFailed"));
    } finally {
      setBusyCycleId(null);
    }
  }

  async function changeStatus(cycle: PerformanceCycle, status: "OPEN" | "CLOSED") {
    setBusyCycleId(cycle.id);
    try {
      const updated = await apiClient.put<{
        participantsAdded: number;
        participantsPending: number;
      }>(`/api/cycles/${cycle.id}`, { status });
      if (status === "OPEN") {
        // §3.5 — enrolment happens at OPEN, so the count is the answer to
        // "did that do anything?" and belongs in the confirmation.
        success(t("cycles.opened", { year: cycle.year, count: updated?.participantsAdded ?? 0 }));
        // Bounded now, so a very large org opens over more than one action.
        // Saying so is what keeps a half-enrolled cycle from being invisible.
        if ((updated?.participantsPending ?? 0) > 0) {
          warning(t("cycles.enrolMorePending", { count: updated!.participantsPending }));
        }
      } else {
        success(t("cycles.closed", { year: cycle.year }));
      }
      await refresh();
    } catch (e) {
      showError(e instanceof ApiError ? e.message : t("cycles.statusFailed"));
    } finally {
      setBusyCycleId(null);
    }
  }

  if (actorLoading) {
    // The whole page's silhouette, not a real title over a skeleton table: until
    // the actor resolves we do not yet know whether this user gets the console
    // or the "managed by HR" notice, and a header would prejudge that.
    return <PageSkeleton rows={6} withAction />;
  }

  if (!canRunCycle) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("cycles.title")} />
        <SectionCard title={t("cycles.title")}>
          {/* §4.1 — running the cycle is HR's; everyone else sees the cadence
              through their own screens, not through this console. */}
          <EmptyState description={t("cycles.notPermitted")} />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("cycles.title")}
        subtitle={t("cycles.subtitle")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("cycles.newAction")}
          </Button>
        }
      />

      {cycles.isLoading ? (
        <TableSkeleton rows={4} />
      ) : cycles.isError ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-destructive-emphasis">
            {t("cycles.loadFailed")}
          </p>
          <Button variant="outline" onClick={() => cycles.refetch()}>
            {t("cycles.retry")}
          </Button>
        </div>
      ) : (
        <CycleList
          cycles={cycles.data ?? []}
          loading={cycles.isFetching}
          canManage={canRunCycle}
          busyCycleId={busyCycleId}
          onCreate={() => setCreateOpen(true)}
          onOpenCycle={(cycle) => changeStatus(cycle, "OPEN")}
          onCloseCycle={(cycle) => changeStatus(cycle, "CLOSED")}
          onEditDeadlines={(cycle) => {
            setFormError(null);
            setEditing(cycle);
          }}
          onEnrolMissing={enrolMissing}
          onEditPolicy={(cycle) => {
            setFormError(null);
            setPolicyCycle(cycle);
          }}
        />
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setFormError(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("cycles.createTitle")}</DialogTitle>
            <DialogDescription>{t("cycles.createNote")}</DialogDescription>
          </DialogHeader>

          {/* Radix unmounts the content on close, so a reopened dialog starts
              from fresh defaults rather than the last attempt's values. */}
          <CycleForm
            formId="cycle-create-form"
            mode="create"
            submitting={submitting}
            onSubmit={handleCreate}
          />

          {formError ? (
            <p role="alert" className="text-sm text-destructive-emphasis">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" form="cycle-create-form" disabled={submitting}>
              {submitting ? t("cycles.saving") : t("cycles.createAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setFormError(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing?.status === "OPEN"
                ? t("cycles.extendTitle", { year: editing?.year ?? "" })
                : t("cycles.editTitle", { year: editing?.year ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {/* §5.5 — on an OPEN cycle this is an extension HR is accountable
                  for, and the audit trail records it as such. Say that here. */}
              {editing?.status === "OPEN" ? t("cycles.extendNote") : t("cycles.editNote")}
            </DialogDescription>
          </DialogHeader>

          {editing ? (
            <CycleForm
              key={editing.id}
              formId="cycle-stages-form"
              mode="edit"
              defaultYear={editing.year}
              initialStages={editing.stages}
              submitting={submitting}
              onSubmit={handleSaveStages}
            />
          ) : null}

          {formError ? (
            <p role="alert" className="text-sm text-destructive-emphasis">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={submitting}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" form="cycle-stages-form" disabled={submitting}>
              {submitting ? t("cycles.saving") : t("cycles.saveDeadlines")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extracted wholesale — it owns its own fetch, its own save, and its own
          error states, none of which this page needs to know about. It also
          kept `CyclesPage` inside the complexity budget, which is the honest
          second reason. */}
      <CyclePolicyDialog
        cycle={policyCycle}
        onClose={() => {
          setPolicyCycle(null);
          setFormError(null);
        }}
      />
    </div>
  );
}
