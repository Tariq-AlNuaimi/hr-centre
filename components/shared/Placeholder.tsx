import { getTranslations } from "next-intl/server";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Honest "designed empty state" for surfaces that arrive in a later phase
// (UI-SPEC E: states are designed, not default). Carries the evidence-trail
// journey line so even placeholders feel like Rihal.
export async function Placeholder({
  title,
  icon: Icon,
}: {
  title: string;
  icon: LucideIcon;
}) {
  const t = await getTranslations("placeholder");
  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <span className="rounded-xl bg-secondary p-3 text-accent">
        <Icon className="size-6" />
      </span>
      <div className="flex flex-col items-center gap-2">
        <Badge variant="accent">{t("badge")}</Badge>
        <h2 className="font-display text-lg font-semibold text-foreground">
          {title}
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">{t("body")}</p>
      </div>
      <div
        className="journey-line mt-2 max-w-xs"
        style={{ "--journey": "28%" } as React.CSSProperties}
      />
    </Card>
  );
}
