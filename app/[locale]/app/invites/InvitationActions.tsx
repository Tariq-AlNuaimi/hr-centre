"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { RotateCw, Ban, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import type { InvitationStatus } from "@/generated/prisma/client";

type Action = "resend" | "revoke";

// Per-row resend/revoke (UI-SPEC D.5). Admin-only (the server gates the routes;
// managers never receive this component — the page omits it for them). Honest
// async states: spinner while pending, inline error (no toast over a failure),
// router.refresh() on success.
export function InvitationActions({
  id,
  status,
}: {
  id: string;
  status: InvitationStatus;
}) {
  const t = useTranslations("invitations");
  const router = useRouter();
  const [pending, setPending] = React.useState<Action | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Resend is meaningful only before the candidate engaged or after expiry; a
  // STARTED/COMPLETED/REVOKED invite isn't resent (matches the service guard).
  const canResend =
    status === "PENDING" || status === "OPENED" || status === "EXPIRED";
  const canRevoke = status !== "COMPLETED" && status !== "REVOKED";

  async function run(action: Action) {
    if (action === "revoke" && !window.confirm(t("confirmRevoke"))) return;
    setError(null);
    setPending(action);
    try {
      const res = await fetch(`/api/invitations/${id}/${action}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("actionError"));
        setPending(null);
        return;
      }
      router.refresh();
      setPending(null);
    } catch {
      setError(t("actionError"));
      setPending(null);
    }
  }

  if (!canResend && !canRevoke) {
    return <span className="text-muted-foreground">{t("noName")}</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1.5">
        {canResend && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => run("resend")}
            disabled={pending !== null}
          >
            {pending === "resend" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RotateCw className="size-3.5" />
            )}
            {t("resend")}
          </Button>
        )}
        {canRevoke && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => run("revoke")}
            disabled={pending !== null}
          >
            {pending === "revoke" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Ban className="size-3.5" />
            )}
            {t("revoke")}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--signal-below-ink)]">
          {error}
        </p>
      )}
    </div>
  );
}
