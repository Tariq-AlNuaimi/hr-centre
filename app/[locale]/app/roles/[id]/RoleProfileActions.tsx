"use client";

import * as React from "react";
import { useTranslations, useLocale } from "next-intl";
import { Copy, Pencil, CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

type Action = "version" | "approve";

// Admin-only action bar on the detail view (UI-SPEC D.4). Mirrors the server gate
// (managers never receive this component). Honest async states: loading spinner,
// inline error (no green toast over a failure), navigation on success.
export function RoleProfileActions({
  id,
  isEditable,
}: {
  id: string;
  /** DRAFT/IN_REVIEW → editable; show Edit + Approve. */
  isEditable: boolean;
}) {
  const t = useTranslations("roleProfiles");
  const locale = useLocale();
  const router = useRouter();
  const [pending, setPending] = React.useState<Action | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run(action: Action) {
    setError(null);
    setPending(action);
    try {
      const res = await fetch(`/api/role-profiles/${id}/${action}`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { id: string };
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? t("actionError"));
        setPending(null);
        return;
      }
      if (action === "version" && body.data?.id) {
        // Clone lands as a new DRAFT — open it for editing.
        router.push(`/app/roles/${body.data.id}/edit`, { locale });
      } else {
        router.refresh();
      }
    } catch {
      setError(t("actionError"));
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onClick={() => run("version")}
          disabled={pending !== null}
        >
          {pending === "version" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Copy className="size-4" />
          )}
          {t("newVersion")}
        </Button>

        {isEditable && (
          <>
            <Button
              variant="outline"
              onClick={() =>
                router.push(`/app/roles/${id}/edit`, { locale })
              }
              disabled={pending !== null}
            >
              <Pencil className="size-4" />
              {t("edit")}
            </Button>
            <Button
              onClick={() => run("approve")}
              disabled={pending !== null}
            >
              {pending === "approve" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              {t("approveActivate")}
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-[var(--signal-below)]">
          {error}
        </p>
      )}
    </div>
  );
}
