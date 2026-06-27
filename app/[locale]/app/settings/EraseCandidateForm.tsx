"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// PDPL candidate-erasure tool (UI-SPEC D.10). Confirms, POSTs the email, and reports
// the honest outcome (count erased / not found / error). The records are soft-deleted
// now and purged on the retention schedule.
export function EraseCandidateForm() {
  const t = useTranslations("settings");
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ kind: "ok" | "info" | "error"; text: string } | null>(null);

  async function erase() {
    const target = email.trim();
    if (!target) return;
    if (!window.confirm(t("eraseConfirm", { email: target }))) return;
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch("/api/settings/erase-candidate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: target }),
      });
      const body = (await res.json().catch(() => ({}))) as { data?: { sittings: number }; error?: string };
      if (res.status === 404) {
        setMessage({ kind: "info", text: t("eraseNotFound") });
      } else if (!res.ok) {
        setMessage({ kind: "error", text: body.error ?? t("eraseError") });
      } else {
        setMessage({ kind: "ok", text: t("eraseDone", { count: body.data?.sittings ?? 0, email: target }) });
        setEmail("");
        router.refresh();
      }
    } catch {
      setMessage({ kind: "error", text: t("eraseError") });
    } finally {
      setBusy(false);
    }
  }

  const tone =
    message?.kind === "ok"
      ? "text-[var(--signal-pass-ink)]"
      : message?.kind === "error"
        ? "text-[var(--signal-below-ink)]"
        : "text-[var(--signal-partial-ink)]";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="erase-email">{t("eraseEmail")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="erase-email"
            type="email"
            value={email}
            className="max-w-xs"
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button variant="outline" onClick={erase} disabled={busy || email.trim() === ""}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {busy ? t("erasing") : t("eraseButton")}
          </Button>
        </div>
      </div>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${tone}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
