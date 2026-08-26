"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmployeePicker, type PickablePerson } from "@/components/pms/EmployeePicker";
import { apiClient } from "@/lib/api-client";

/**
 * §12.1's manual departure — "settable by import **or manually** (immediate
 * one-off resignations)".
 *
 * `POST /api/leavers` had no caller; `/admin/edge-cases` only ever read it, so
 * the manual half of §12.1 did not exist (`docs/verification/SPEC-REDTEAM.md`,
 * F4).
 *
 * Recording a departure rolls every direct report up a level, stops pending
 * actions chasing them, and flags any 360 they were rating for reassignment.
 * There is no undo in the product, so the card says what will happen before it
 * happens — §13.2's instinct about publishing, at a smaller scale.
 */

export function LeaverRecorder({ onDone }: { onDone: () => void }) {
  const t = useTranslations("pms.edgeCaseRecord.leaver");
  const queryClient = useQueryClient();
  const [person, setPerson] = useState<PickablePerson | null>(null);
  const [lastWorkingDay, setLastWorkingDay] = useState("");
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post("/api/leavers", {
        employeeId: person?.id,
        lastWorkingDay,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success(t("savedToast", { name: person?.name ?? "" }));
      setPerson(null);
      setLastWorkingDay("");
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["pms", "edgeCases"] });
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const ready = person !== null && lastWorkingDay !== "";

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
            <Label htmlFor="leaver-chosen">{t("who")}</Label>
            <div className="flex items-center gap-2">
              <Input id="leaver-chosen" value={person.name} readOnly />
              <Button variant="outline" size="sm" onClick={() => setPerson(null)}>
                {t("change")}
              </Button>
            </div>
          </div>
        ) : (
          <EmployeePicker id="leaver-search" label={t("who")} onPick={setPerson} />
        )}

        <div className="space-y-1">
          <Label htmlFor="leaver-last-day">{t("lastWorkingDay")}</Label>
          <Input
            id="leaver-last-day"
            type="date"
            value={lastWorkingDay}
            onChange={(e) => setLastWorkingDay(e.target.value)}
          />
        </div>

        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="leaver-note">{t("note")}</Label>
          <Input
            id="leaver-note"
            value={note}
            placeholder={t("notePlaceholder")}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      {/* §12.1's consequences, before the click rather than after it. */}
      <p className="mt-4 max-w-prose text-sm text-muted-foreground">{t("consequences")}</p>
    </SectionCard>
  );
}
