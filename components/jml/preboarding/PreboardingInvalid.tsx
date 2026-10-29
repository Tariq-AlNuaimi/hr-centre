"use client";

import { useTranslations } from "next-intl";

/**
 * What every failed preboarding link shows. No props by design: nothing about
 * the joiner or the company can leak, and "expired" is not told apart from
 * "unknown" (that would confirm a real case behind a guessed token).
 */
export function PreboardingInvalid() {
  const t = useTranslations("jml.preboarding.public");
  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-[560px] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="m-0 text-h3 font-bold text-foreground">{t("invalidTitle")}</h1>
      <p className="m-0 max-w-[42ch] text-base text-muted-foreground">{t("invalidBody")}</p>
    </main>
  );
}
