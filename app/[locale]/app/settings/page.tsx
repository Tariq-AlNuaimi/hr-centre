import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/authz";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/PageHeader";
import { getAiSettingsView, getOrgProfile, type AiSettingsView } from "@/lib/settings";
import { listOrgUsers } from "@/lib/services/user";
import { AiSettingsForm } from "./AiSettingsForm";
import { OrgProfileForm } from "./OrgProfileForm";
import { UserManager } from "./UserManager";
import { EraseCandidateForm } from "./EraseCandidateForm";

// Settings (UI-SPEC D.10) — admin only. Sections: AI/scoring config (ADR-031), org
// profile, users, and data retention + PDPL erasure. Reads are RSC via tenant-scoped
// services (the AI tokens are never sent to the client — masked view); the forms are
// client islands. Branding/theme stay in brand.config.ts (within token bounds).
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireAdmin(locale);
  const orgId = session.user.orgId;

  const t = await getTranslations("settings");

  const emptyAi: AiSettingsView = {
    llm: { url: null, urlEnv: null, model: null, modelEnv: "gpt-oss-120b", tokenSet: false, tokenHint: null, tokenSource: "none" },
    scoring: { url: null, urlEnv: null, tokenSet: false, tokenHint: null, tokenSource: "none" },
  };
  const [aiView, orgProfile, users] = orgId
    ? await Promise.all([getAiSettingsView(orgId), getOrgProfile(orgId), listOrgUsers(orgId)])
    : [emptyAi, null, []];

  // Retention windows are platform-configured (the purge cron reads these env vars).
  const auditRetentionDays = Number(process.env.AUDIT_RETENTION_DAYS) || 365;
  const binRetentionDays = Number(process.env.RECYCLE_BIN_RETENTION_DAYS) || 90;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {/* AI & scoring config (ADR-031) */}
      <Card>
        <CardHeader>
          <CardTitle>{t("aiTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("aiSubtitle")}</p>
        </CardHeader>
        <CardContent>
          <AiSettingsForm view={aiView} />
        </CardContent>
      </Card>

      {/* Organization */}
      <Card>
        <CardHeader>
          <CardTitle>{t("orgTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("orgSubtitle")}</p>
        </CardHeader>
        <CardContent>
          <OrgProfileForm
            name={orgProfile?.name ?? ""}
            defaultLocale={orgProfile?.defaultLocale ?? "en"}
          />
        </CardContent>
      </Card>

      {/* Users */}
      <Card>
        <CardHeader>
          <CardTitle>{t("usersTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("usersSubtitle")}</p>
        </CardHeader>
        <CardContent>
          <UserManager
            users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null }))}
            currentUserId={session.user.id}
          />
        </CardContent>
      </Card>

      {/* Data retention & PDPL erasure */}
      <Card>
        <CardHeader>
          <CardTitle>{t("retentionTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("retentionSubtitle")}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <dt className="text-xs text-muted-foreground">{t("retentionAudit")}</dt>
              <dd className="text-sm font-medium text-foreground tabular-nums">
                {t("retentionDaysValue", { days: auditRetentionDays })}
              </dd>
            </div>
            <div className="rounded-md border border-border p-3">
              <dt className="text-xs text-muted-foreground">{t("retentionBin")}</dt>
              <dd className="text-sm font-medium text-foreground tabular-nums">
                {t("retentionDaysValue", { days: binRetentionDays })}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">{t("retentionPlatformNote")}</p>

          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground">{t("eraseTitle")}</p>
            <p className="mb-3 text-xs text-muted-foreground">{t("eraseSubtitle")}</p>
            <EraseCandidateForm />
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{t("moreComing")}</p>
    </div>
  );
}
