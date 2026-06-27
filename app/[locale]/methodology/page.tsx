import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Wordmark } from "@/components/brand/Wordmark";
import { LocaleToggle } from "@/components/layout/LocaleToggle";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

// Public methodology page (UI-SPEC D.11) — the defensibility surface shown to an
// auditor or a candidate. No auth, no app chrome. Expanded in the compliance
// phase; Phase 1 states the standards chain + norm-data limits honestly.
export default async function MethodologyPage() {
  const t = await getTranslations("methodology");

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-16 items-center justify-between border-b border-border px-4 sm:px-8">
        <Link href="/" aria-label="Rihal Aptitude">
          <Wordmark />
        </Link>
        <LocaleToggle />
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-2 pb-8">
          <span
            className="journey-line w-24"
            style={{ "--journey": "60%" } as React.CSSProperties}
          />
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="text-base text-muted-foreground">{t("subtitle")}</p>
        </div>

        <p className="text-sm leading-relaxed text-foreground">{t("intro")}</p>

        <div className="mt-8 flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("chainTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground">
              {t("chain")}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("normsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground">
              {t("norms")}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
