"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";

/**
 * The hiring manager's decision on one candidate (UX review tickets P1-9,
 * Greenhouse HM Review): Advance to the next stage, or Reject with a note.
 * Both go through the existing stage route, so every stage gate and scope
 * check still applies and its refusal sentence is shown as it is.
 */
export function MyHiringReview({
  candidateId,
  nextStage,
  nextLabel,
}: {
  candidateId: string;
  nextStage: string | null;
  nextLabel: string | null;
}) {
  const t = useTranslations("team.myHiring");
  const router = useRouter();
  const { success } = useNotify();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(stage: string, reason?: string) {
    setBusy(true);
    setError(null);
    try {
      await apiClient.patch(`/api/hiring/candidates/${candidateId}/stage`, {
        stage,
        ...(reason ? { reason } : {}),
      });
      success(stage === "REJECTED" ? t("rejected") : t("advanced"));
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {rejecting ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void move("REJECTED", note.trim());
          }}
        >
          <Input
            aria-label={t("rejectNote")}
            placeholder={t("rejectNote")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-8 w-56"
          />
          <Button type="submit" size="sm" variant="destructive" disabled={busy || !note.trim()}>
            {t("confirmReject")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)}>
            {t("cancel")}
          </Button>
        </form>
      ) : (
        <div className="flex gap-2">
          {nextStage ? (
            <Button size="sm" disabled={busy} onClick={() => void move(nextStage)}>
              {t("advance", { stage: nextLabel ?? nextStage })}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
            {t("reject")}
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="m-0 text-xs text-destructive-emphasis">
          {error}
        </p>
      ) : null}
    </div>
  );
}
