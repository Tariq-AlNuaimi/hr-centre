"use client";

import { SIRAAJ_URL } from "@/lib/hive/mcp/siraaj";
import { useTranslations } from "next-intl";
import { HiveLogo } from "@/components/hive/HiveLogo";

/**
 * AC-9.7 — what an expired, malformed or revoked reply link shows.
 *
 * "THE SYSTEM SHALL say so plainly and offer to start a fresh question, and
 * SHALL NOT reveal the employee's name, email, question, or any part of the
 * answer."
 *
 * This component takes NO PROPS, and that is the design rather than an
 * accident: there is nothing here that could leak, in any branch, however the
 * caller is later changed. The four failure kinds are also not distinguished —
 * telling "expired" from "unknown" would confirm to whoever is guessing that a
 * real escalation exists behind the token they tried.
 */
export function ReplyInvalid() {
  const t = useTranslations("hive.reply");
  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-[560px] flex-col items-center justify-center gap-5 px-4 text-center">
      <HiveLogo size={72} />
      <h1 className="m-0 text-h3 font-bold text-foreground">{t("invalidTitle")}</h1>
      <p className="m-0 max-w-[42ch] text-base text-muted-foreground">{t("invalidBody")}</p>
      <a
        href={SIRAAJ_URL}
        className="inline-flex items-center justify-center rounded-2xl bg-primary px-5 py-3 text-base font-semibold text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("askSiraaj")}
      </a>
    </main>
  );
}
