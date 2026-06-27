import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Wordmark } from "@/components/brand/Wordmark";
import { Button } from "@/components/ui/button";

export default async function LocaleNotFound() {
  const t = await getTranslations("notFound");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <Wordmark />
      <div className="flex flex-col gap-2">
        <p className="font-display text-5xl font-semibold tabular-nums text-rihal-azure">
          404
        </p>
        <h1 className="font-display text-xl font-semibold text-foreground">
          {t("title")}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("body")}</p>
      </div>
      <Button asChild>
        <Link href="/app">{t("backHome")}</Link>
      </Button>
    </div>
  );
}
