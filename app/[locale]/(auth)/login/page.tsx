import { getTranslations } from "next-intl/server";
import { Wordmark, RihalMark } from "@/components/brand/Wordmark";
import { LocaleToggle } from "@/components/layout/LocaleToggle";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LoginForm } from "./LoginForm";

// Auth screen (UI-SPEC: clean, instrument-like, trustworthy — brand-critical).
// Split layout: a quiet deep-blue brand panel (hidden on mobile) + the form.
export default async function LoginPage() {
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-rihal-deep p-12 text-rihal-paper lg:flex">
        <Wordmark className="[&_span]:text-rihal-paper" />
        <div className="flex flex-col gap-4">
          <RihalMark className="h-10 w-10" />
          <p className="max-w-sm font-display text-2xl font-semibold leading-snug tracking-tight">
            {tc("tagline")}
          </p>
          <p className="max-w-sm text-sm text-rihal-paper/70">
            {t("signInSubtitle")}
          </p>
          <span
            className="journey-line mt-2 max-w-[12rem]"
            style={{ "--journey": "72%" } as React.CSSProperties}
          />
        </div>
        <span className="text-xs text-rihal-paper/50">
          {tc("appName")}
        </span>
      </div>

      {/* Form panel */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-4 lg:justify-end">
          <div className="lg:hidden">
            <Wordmark />
          </div>
          <LocaleToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle className="text-xl">{t("signInTitle")}</CardTitle>
              <CardDescription>{t("signInSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <LoginForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
