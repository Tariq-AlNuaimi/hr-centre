import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusPill } from "@/components/hive/escalations/StatusPill";
import { formatTicketId } from "@/lib/hive/ticket-id";
import { getTicketSettings } from "@/lib/hive/services/ticket-settings";
import { ticketTasksFor, ticketsForEmployee } from "@/lib/hive/services/my-tasks";
import { formatDate } from "@/lib/format";

/**
 * HR tickets inside the rest of HR Centre (US-H10), as server components: the
 * "waiting on you" lists on home, and the tickets tab on an employee record.
 * Questions are shortened here; the full text sits behind the ticket page,
 * where its own gate applies.
 */

type T = Awaited<ReturnType<typeof getTranslations>>;

/** Built-in status labels with HR's renames (Settings) laid over — literal keys. */
function statusLabels(t: T, overrides: Record<string, string>): Record<string, string> {
  return {
    OPEN: t("statusOPEN"),
    IN_PROGRESS: t("statusIN_PROGRESS"),
    PENDING_APPROVAL: t("statusPENDING_APPROVAL"),
    APPROVED: t("statusAPPROVED"),
    SENT: t("statusSENT"),
    SEND_FAILED: t("statusSEND_FAILED"),
    CLOSED: t("statusCLOSED"),
    ...overrides,
  };
}

function short(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

type Row = {
  id: string;
  ticketNumber: number;
  status: string;
  question: string;
  createdAt: Date;
  hrPair: { name: string };
};

function TicketList({
  rows,
  locale,
  prefix,
  labels,
}: {
  rows: Row[];
  locale: string;
  prefix: string;
  labels: Record<string, string>;
}) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
          <Link
            href={`/${locale}/hive/escalations/${r.id}`}
            className="font-mono text-xs underline underline-offset-4"
          >
            {formatTicketId(r.ticketNumber, prefix)}
          </Link>
          <StatusPill status={r.status} label={labels[r.status] ?? r.status} />
          <span className="min-w-0 flex-1 truncate">{short(r.question)}</span>
          <span className="text-xs text-muted-foreground">{r.hrPair.name}</span>
          <span className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Home → My tasks: tickets waiting on this person. Renders nothing for non-HR. */
export async function TicketTasks({ userId, locale }: { userId: string; locale: string }) {
  const tasks = await ticketTasksFor(userId);
  if (!tasks.canApprove && !tasks.canDraft) return null;
  const [t, tStatus, settings] = await Promise.all([
    getTranslations("hive.tasks"),
    getTranslations("hive.escalations"),
    getTicketSettings(),
  ]);
  const labels = statusLabels(tStatus, settings.statusLabels);
  type Section = { key: string; title: string; rows: Row[] };
  const sections: Section[] = [];
  if (tasks.canApprove) {
    sections.push({
      key: "approve",
      title: t("toApprove", { count: tasks.toApprove.count }),
      rows: [...tasks.toApprove.rows],
    });
  }
  if (tasks.canDraft) {
    sections.push({
      key: "answer",
      title: t("toAnswer", { count: tasks.toAnswer.count }),
      rows: [...tasks.toAnswer.rows],
    });
  }
  return (
    <SectionCard
      title={t("title")}
      subtitle={t("subtitle")}
      actions={
        <Link href={`/${locale}/hive/escalations`} className="text-sm underline underline-offset-4">
          {t("openQueue")}
        </Link>
      }
    >
      <div className="space-y-4">
        {sections.map((s) => (
          <div key={s.key}>
            <h4 className="m-0 mb-1 text-sm font-semibold">{s.title}</h4>
            {s.rows.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">{t("nothing")}</p>
            ) : (
              <TicketList
                rows={s.rows}
                locale={locale}
                prefix={settings.ticketPrefix}
                labels={labels}
              />
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

/** Employee record → "HR tickets" tab. The page checks `tickets.see` first. */
export async function EmployeeTickets({
  employeeId,
  locale,
}: {
  employeeId: string;
  locale: string;
}) {
  const [rows, t, tStatus, settings] = await Promise.all([
    ticketsForEmployee(employeeId),
    getTranslations("hive.tasks"),
    getTranslations("hive.escalations"),
    getTicketSettings(),
  ]);
  const labels = statusLabels(tStatus, settings.statusLabels);
  return (
    <SectionCard title={t("recordTitle")} subtitle={t("recordSubtitle")}>
      {rows.length === 0 ? (
        <EmptyState description={t("recordEmpty")} />
      ) : (
        <>
          <TicketList rows={rows} locale={locale} prefix={settings.ticketPrefix} labels={labels} />
          {rows.some((r) => !r.identityVerified) ? (
            <p className="mt-3 text-xs text-muted-foreground">
              <Badge variant="outline">{t("unverified")}</Badge> {t("unverifiedNote")}
            </p>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
