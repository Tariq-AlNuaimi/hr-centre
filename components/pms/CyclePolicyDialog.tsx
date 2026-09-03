"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { CyclePolicyForm, type CyclePolicyValues } from "@/components/pms/CyclePolicyForm";
import type { PerformanceCycle } from "@/components/pms/CycleList";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";

/**
 * The §6.2 / §7.1 / §8.7 policy dialog — the whole thing, including its own
 * fetch and save.
 *
 * Split out of the cycles page because none of this is the page's business: the
 * page knows which cycle was clicked, and nothing else. The body is a second
 * component inside this file so Radix's unmount-on-close discards a half-edited
 * draft rather than showing it against the next cycle opened.
 */
export function CyclePolicyDialog({
  cycle,
  onClose,
}: {
  cycle: PerformanceCycle | null;
  onClose: () => void;
}) {
  const t = useTranslations("pms");
  return (
    <Dialog
      open={cycle !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("cyclePolicy.title", { year: cycle?.year ?? "" })}</DialogTitle>
          <DialogDescription>{t("cyclePolicy.note")}</DialogDescription>
        </DialogHeader>
        {cycle ? <CyclePolicyBody cycleId={cycle.id} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The policy dialog's body, split out so the fetch lives with the form rather
 * than in the page's already-long component, and so Radix's unmount-on-close
 * discards a half-edited draft instead of showing it against the next cycle.
 */
function CyclePolicyBody({ cycleId }: { cycleId: string }) {
  const t = useTranslations("pms");
  const tCommon = useTranslations("common");
  const { success, error: showError } = useNotify();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const query = useQuery({
    queryKey: ["pms", "cycle-policy", cycleId],
    queryFn: () =>
      apiClient.get<{ policy: CyclePolicyValues; editable: boolean }>(
        `/api/cycles/${cycleId}/policy`,
      ),
  });

  if (query.isLoading) return <TableSkeleton rows={3} />;
  if (query.isError || !query.data) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive-emphasis">
          {t("cyclePolicy.loadFailed")}
        </p>
        <Button variant="outline" onClick={() => query.refetch()}>
          {t("cycles.retry")}
        </Button>
      </div>
    );
  }

  const { policy, editable } = query.data;

  const handleSubmit = async (values: CyclePolicyValues) => {
    setSaving(true);
    try {
      await apiClient.patch(`/api/cycles/${cycleId}/policy`, values);
      await queryClient.invalidateQueries({ queryKey: ["pms", "cycle-policy", cycleId] });
      success(t("cyclePolicy.saved"));
    } catch (e) {
      showError(e instanceof ApiError ? e.message : t("cyclePolicy.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <CyclePolicyForm
        formId="cycle-policy-form"
        value={policy}
        editable={editable}
        submitting={saving}
        onSubmit={handleSubmit}
      />
      {editable ? (
        <DialogFooter>
          <Button type="submit" form="cycle-policy-form" disabled={saving}>
            {saving ? t("cycles.saving") : tCommon("save")}
          </Button>
        </DialogFooter>
      ) : null}
    </>
  );
}
