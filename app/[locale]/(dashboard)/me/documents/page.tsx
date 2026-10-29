import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/core/actor";
import { myDocuments } from "@/lib/people/me";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";

/**
 * P2 (UX R22) — "My documents": my ID documents (type and expiry, never the
 * number) and the evidence I attached to my goals. My own record only.
 */
export default async function MyDocumentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("me.documents");
  const actor = await resolveActor(session);
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  if (!actor.employeeId) {
    return (
      <div className="space-y-6">
        {header}
        <SectionCard title={t("notLinked")}>
          <EmptyState description={t("notLinkedHelp")} />
        </SectionCard>
      </div>
    );
  }
  const docs = await myDocuments(actor.employeeId);
  return (
    <div className="space-y-6">
      {header}
      <SectionCard title={t("idTitle")} subtitle={t("idHelp")}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {docs.idDocuments.map((d) => (
            <li key={d.kind} className="rounded-md border border-border p-3 text-sm">
              <p className="m-0 font-medium">{t(`kind.${d.kind}`)}</p>
              <p className="m-0 text-muted-foreground">
                {d.expiresOn ? t("expires", { date: d.expiresOn }) : t("noExpiry")}
              </p>
            </li>
          ))}
        </ul>
      </SectionCard>
      <SectionCard title={t("evidenceTitle")} subtitle={t("evidenceHelp")}>
        {docs.evidence.length === 0 ? (
          <EmptyState description={t("noEvidence")} />
        ) : (
          <ul className="space-y-2 text-sm">
            {docs.evidence.map((e) => (
              <li key={e.id} className="rounded-md border border-border p-3">
                <a
                  className="font-medium text-primary hover:underline"
                  href={`/api/year-end/evidence/${e.id}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {e.label}
                </a>
                <p className="m-0 text-xs text-muted-foreground">
                  {t("evidenceFor", { goal: e.goal, date: e.uploadedAt })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <p className="text-xs text-muted-foreground">{t("lettersNote")}</p>
    </div>
  );
}
