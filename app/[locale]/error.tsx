"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

// Locale-scoped error boundary (UI-SPEC E: designed error states, never a raw
// stack trace). Client component, as Next requires for error.tsx.
export default function LocaleError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("error");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-xl font-semibold text-foreground">
          {t("title")}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("body")}</p>
      </div>
      <Button onClick={reset}>{t("tryAgain")}</Button>
    </div>
  );
}
