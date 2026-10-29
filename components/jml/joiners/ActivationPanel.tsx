"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import { Field } from "@/components/shared/FormControls";
import { LoadFailed, LoadingBlock } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";

type Preview = {
  ready: boolean;
  blockers: string[];
  duplicates: Array<{ id: string; name: string; employeeCode: string | null; status: string }>;
};

/**
 * Activate onboarding (§9.4) — every blocker listed at once; a duplicate
 * personal email can be overridden with a recorded reason by Senior HR.
 */
export function ActivationPanel({ caseId }: { caseId: string }) {
  const t = useTranslations("jml.joiners.activation");
  const { can } = useJmlAccess();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const { run, busy } = useJmlAction(t("failed"));
  const preview = useQuery({
    queryKey: ["jml", "activation", caseId],
    queryFn: () => apiClient.get<Preview>(`/api/jml/joiners/${caseId}/activate`),
  });
  const p = preview.data;
  const needsReason = Boolean(p && p.duplicates.length > 0 && can("jml.supervise"));
  async function activate() {
    const result = await run(() =>
      apiClient.post<{ caseId: string; caseRef: string; employeeCode: string; taskCount: number }>(
        `/api/jml/joiners/${caseId}/activate`,
        needsReason ? { duplicateOverrideReason: reason.trim() } : {},
      ),
    );
    if (result) router.push(`/jml/cases/${result.caseId}?activated=1`);
  }
  return (
    <SectionCard title={t("title")} subtitle={t("subtitle")}>
      {preview.isLoading ? (
        <LoadingBlock />
      ) : preview.isError || !p ? (
        <LoadFailed />
      ) : (
        <div className="space-y-4">
          {p.blockers.length > 0 ? (
            <div role="status" className="rounded-md border border-border bg-muted p-3 text-sm">
              <p className="mb-2 font-medium text-foreground">{t("blockedBy")}</p>
              <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
                {p.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("ready")}</p>
          )}
          {needsReason ? (
            <Field
              id="dup-reason"
              label={t("overrideReason")}
              hint={t("overrideHint", { names: p.duplicates.map((d) => d.name).join(", ") })}
            >
              <textarea
                id="dup-reason"
                className="min-h-16 w-full rounded-md border border-input bg-background p-2 text-sm"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          ) : null}
          <Button
            onClick={() => void activate()}
            disabled={busy || !p.ready || (needsReason && reason.trim().length < 10)}
          >
            {t("activate")}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
