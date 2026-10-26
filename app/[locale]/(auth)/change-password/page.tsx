"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
import { AuthCard } from "@/components/shared/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient, ApiError } from "@/lib/api-client";

/**
 * Choose your own password — blueprint §4 (F-d, AC-F4.2). While a temporary
 * password is held, middleware sends every page here. Changing it ends the
 * current session (the password epoch moves), so the page signs straight back
 * in with the new password.
 */
export default function ChangePasswordPage() {
  const t = useTranslations("people.changePassword");
  const locale = useLocale();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (next !== confirm) {
      setError(t("mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { email } = await apiClient.post<{ email: string }>("/api/logins/change-password", {
        currentPassword: current,
        newPassword: next,
      });
      const result = await signIn("credentials", { email, password: next, redirect: false });
      if (result?.error) {
        router.push(`/${locale}/login`);
      } else {
        router.push(`/${locale}`);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("failed"));
      setBusy(false);
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    auto: string,
  ) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-card-foreground">
        {label}
      </label>
      <Input
        id={id}
        type="password"
        autoComplete={auto}
        value={value}
        disabled={busy}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );

  return (
    <AuthCard title={t("title")}>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <form
        method="post"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {field("cp-current", t("current"), current, setCurrent, "current-password")}
        {field("cp-new", t("new"), next, setNext, "new-password")}
        {field("cp-confirm", t("confirm"), confirm, setConfirm, "new-password")}
        <p className="text-xs text-muted-foreground">{t("rule")}</p>
        {error ? (
          <p role="alert" className="text-sm text-destructive-emphasis">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={busy || !current || !next || !confirm}>
          {busy ? t("saving") : t("submit")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void signOut({ callbackUrl: `/${locale}/login` })}
        >
          {t("signOut")}
        </Button>
      </form>
    </AuthCard>
  );
}
