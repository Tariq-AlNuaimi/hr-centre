"use client";

import { useLocale, useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { nextLocale } from "@/i18n/config";
import { Button } from "@/components/ui/button";

// EN/AR toggle (UI-SPEC C.5/D): switches locale on the SAME path, preserving
// position. RTL/LTR flips automatically via the <html dir> in the locale layout.
export function LocaleToggle() {
  const locale = useLocale();
  const t = useTranslations("shell");
  const router = useRouter();
  const pathname = usePathname();

  const target = nextLocale(locale);
  const label = target === "ar" ? t("switchToArabic") : t("switchToEnglish");

  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-2"
      aria-label={label}
      onClick={() => router.replace(pathname, { locale: target })}
    >
      <Languages className="size-4" />
      <span className="text-sm font-medium">{label}</span>
    </Button>
  );
}
