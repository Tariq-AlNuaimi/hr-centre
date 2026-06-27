import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/authz";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/PageHeader";
import { getAiSettingsView, type AiSettingsView } from "@/lib/settings";
import { AiSettingsForm } from "./AiSettingsForm";

// Settings (UI-SPEC D.10) — admin only. The AI/scoring endpoint config (ADR-031) is
// the first section; reads are RSC via the masked settings view (the token plaintext
// is never sent to the client), the form is a client island that PUTs the patch.
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireAdmin(locale);
  const orgId = session.user.orgId;

  const t = await getTranslations("settings");

  // Empty/disabled view when there's no org context (defensive — admins have one).
  const view: AiSettingsView = orgId
    ? await getAiSettingsView(orgId)
    : {
        llm: {
          url: null,
          urlEnv: null,
          model: null,
          modelEnv: "gpt-oss-120b",
          tokenSet: false,
          tokenHint: null,
          tokenSource: "none",
        },
        scoring: { url: null, urlEnv: null, tokenSet: false, tokenHint: null, tokenSource: "none" },
      };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("aiTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("aiSubtitle")}</p>
        </CardHeader>
        <CardContent>
          <AiSettingsForm view={view} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{t("moreComing")}</p>
    </div>
  );
}
