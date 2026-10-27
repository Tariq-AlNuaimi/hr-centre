"use client";

import { useTranslations } from "next-intl";
import { FileSearch, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHiringMutation } from "../ui/api";
import { useAiStatus } from "./useAi";

/** Score this candidate's fit (0–100) against the requisition's JD. Redacted before it leaves. */
export function RunFitButton({
  candidateId,
  hasProfile,
}: {
  candidateId: string;
  hasProfile: boolean;
}) {
  const t = useTranslations("hiring.ai");
  const { ready } = useAiStatus();
  const run = useHiringMutation<object>("POST", "/api/hiring/ai/insight", {
    success: t("fitDone"),
  });
  const reason = !ready ? t("notConfigured") : !hasProfile ? t("needProfile") : undefined;
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={Boolean(reason) || run.isPending}
      title={reason}
      onClick={() => run.mutate({ kind: "fit", entityId: candidateId })}
    >
      <Sparkles className="h-4 w-4" />
      {run.isPending ? t("running") : t("runFit")}
    </Button>
  );
}

/** Read the stored CV into the profile (HR with PII rights). */
export function ExtractCvButton({ candidateId }: { candidateId: string }) {
  const t = useTranslations("hiring.ai");
  const { ready } = useAiStatus();
  const run = useHiringMutation<undefined, { saved: boolean; extractionFailed: boolean }>(
    "POST",
    `/api/hiring/candidates/${candidateId}/cv/extract`,
    {},
  );
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!ready || run.isPending}
      title={ready ? undefined : t("notConfigured")}
      onClick={() =>
        run.mutate(undefined, {
          onSuccess: (r) => {
            if (!r.saved) toast.warning(r.extractionFailed ? t("unreadable") : t("manual"));
            else toast.success(t("extracted"));
          },
        })
      }
    >
      <FileSearch className="h-4 w-4" />
      {run.isPending ? t("reading") : t("extractCv")}
    </Button>
  );
}
