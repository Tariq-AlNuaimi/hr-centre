"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { RotateCw, RefreshCw, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

// Compute/recompute trigger (UI-SPEC D.7). Two modes:
//   "recompute" — re-run scoring over an existing result (preserves decision +
//                 narrative; the service omits those fields on update).
//   "retry"     — first compute after a transient "scoring-unreachable" state.
// Both POST the compute route with ?recompute=1 and refresh on success. Honest
// async states: spinner while pending, inline error (no green over a failure).
export function ComputeButton({
  assessmentId,
  mode,
}: {
  assessmentId: string;
  mode: "recompute" | "retry";
}) {
  const t = useTranslations("results");
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/results/${assessmentId}/compute?recompute=1`, {
        method: "POST",
      });
      if (!res.ok) {
        setError(mode === "retry" ? t("retryError") : t("recomputeError"));
        setPending(false);
        return;
      }
      router.refresh();
      setPending(false);
    } catch {
      setError(mode === "retry" ? t("retryError") : t("recomputeError"));
      setPending(false);
    }
  }

  const Icon = mode === "retry" ? RefreshCw : RotateCw;
  const idle = mode === "retry" ? t("retry") : t("recompute");
  const busy = mode === "retry" ? t("retrying") : t("recomputing");

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant={mode === "retry" ? "default" : "outline"}
        size="sm"
        onClick={run}
        disabled={pending}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
        {pending ? busy : idle}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive-ink">
          {error}
        </p>
      )}
    </div>
  );
}
