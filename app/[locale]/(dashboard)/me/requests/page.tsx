import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/core/actor";
import { myRequests } from "@/lib/people/me";
import { formatTicketId } from "@/lib/hive/ticket-id";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";

/**
 * P2 (UX R22, P2-11) — "My requests": the HR questions I raised and where each
 * stands, in employee words (with HR / answered / closed). My own tickets only:
 * read by my employee id (and my login email for tickets raised before my
 * record was linked). No draft, note or HR name is read.
 */
export default async function MyRequestsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("me.requests");
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
  const rows = await myRequests(actor.employeeId, session.user?.email ?? null);
  const day = (iso: string) => iso.slice(0, 10);
  return (
    <div className="space-y-6">
      {header}
      <SectionCard title={t("listTitle")}>
        {rows.length === 0 ? (
          <EmptyState description={t("empty")} />
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {formatTicketId(r.ticketNumber)} · {t("opened", { date: day(r.openedAt) })}
                  </span>
                  <Badge variant={r.state === "ANSWERED" ? "success" : "outline"}>
                    {t(`state.${r.state}`)}
                  </Badge>
                </div>
                <p className="m-0 mt-1 line-clamp-3 whitespace-pre-line">{r.question}</p>
                {r.answeredAt && (
                  <p className="m-0 mt-1 text-xs text-muted-foreground">
                    {t("answered", { date: day(r.answeredAt) })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
