"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { useStatusLabels } from "@/components/hive/escalations/status-labels";
import { StatusPill } from "@/components/hive/escalations/StatusPill";
import { useNotify } from "@/hooks/use-notify";
import { apiClient } from "@/lib/api-client";
import { formatTicketId } from "@/lib/hive/ticket-id";
import { cn } from "@/lib/utils";
import { HistoryCard } from "@/components/hive/escalations/TicketHistory";
import { ActionRow, type Detail } from "@/components/hive/escalations/TicketActions";
import { EmployeeLink } from "@/components/hive/escalations/EmployeeLink";

/**
 * One escalation: read it, draft an answer, approve and send (US10, US11).
 *
 * **The Approve button is hidden without the `approve` permission (ADMIN, ADR-072), and that is chrome, not
 * a control.** AC-10.2 is explicit that a user without approval rights gets a
 * 403 "not merely hidden", and the refusal lives in `approveAndSend` where every
 * caller meets it. What hiding buys is honesty: §5.3 gives Alaa Admin WITHOUT
 * approval, so for her a visible Approve button would be a dead control — the
 * Tier-0 failure `docs/uat-rubric.md` names — and the explanatory line in its
 * place says who can, which is the thing she actually needs to know.
 *
 * **Draft and Approve are separate actions and separate permissions.** §5.4 step
 * 5 requires approval "regardless of who drafted it", so writing the answer
 * confers nothing; Rahma drafts, Muna approves, and the screen shows both names
 * once they exist.
 *
 * **Submit, then approve (spec V2 §5.4 step 5).** A drafter saves and submits;
 * the approver approves exactly the stored text. Approve is disabled while the
 * on-screen text differs from what was submitted — saving would withdraw the
 * submission (the service moves it back to IN_PROGRESS), and approving the
 * stored text would send words the approver is not looking at.
 *
 * A SENT answer is read-only here. Editing the record of an email an employee
 * has already read would make the trail describe something nobody received —
 * the service refuses it, and the form says so rather than failing on submit.
 */

export default function EscalationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("hive.escalations");
  const locale = useLocale();
  const notify = useNotify();

  const query = useQuery<Detail>({
    queryKey: ["hive", "escalation", id],
    queryFn: () => apiClient.get<Detail>(`/api/hive/escalations/${id}`),
  });

  if (query.isError) return <EmptyState description={t("loadFailed")} />;
  if (!query.data) return <EmptyState description={t("loading")} />;

  return (
    <DetailView
      // Remounted when the stored answer or status changes, so the textarea is
      // seeded from the fetched value with no effect and no setState-in-render.
      key={`${query.data.status}|${query.data.draftAnswer ?? ""}`}
      detail={query.data}
      canApprove={query.data.abilities.approve}
      canDraft={query.data.abilities.draft}
      locale={locale}
      refetch={() => void query.refetch()}
      notify={notify}
      t={t}
    />
  );
}

function DetailView({
  detail,
  canApprove,
  canDraft,
  locale,
  refetch,
  notify,
  t,
}: {
  detail: Detail;
  canApprove: boolean;
  canDraft: boolean;
  locale: string;
  refetch: () => void;
  notify: { success: (m: string) => void; error: (m: string) => void };
  t: (key: string, values?: Record<string, string>) => string;
}) {
  const statusLabel = useStatusLabels(detail.settings.statusLabels);
  const [draft, setDraft] = useState(detail.draftAnswer ?? "");
  const [busy, setBusy] = useState(false);
  const sent = detail.status === "SENT";
  const closed = detail.status === "CLOSED";

  async function act(
    run: () => Promise<unknown>,
    okMessage: string,
    failMessage: string,
  ): Promise<void> {
    setBusy(true);
    try {
      await run();
      refetch();
      notify.success(okMessage);
    } catch (error) {
      // The server's message is surfaced verbatim where it has one: a failed
      // SEND says WHY, and "couldn't send that" would throw away the only
      // detail that makes it fixable.
      notify.error(error instanceof Error ? error.message : failMessage);
    } finally {
      setBusy(false);
    }
  }

  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    );

  return (
    <>
      <PageHeader
        title={t("detailTitle", {
          ticketId: formatTicketId(detail.ticketNumber, detail.settings.ticketPrefix),
        })}
        subtitle={`${detail.employeeName} · ${detail.hrPair?.name ?? "—"}`}
        actions={
          <StatusPill status={detail.status} label={statusLabel[detail.status] ?? detail.status} />
        }
      />

      <div className="flex flex-col gap-6">
        <SectionCard title={t("theyAsked")} subtitle={when(detail.createdAt)}>
          <p className="m-0 whitespace-pre-line text-base leading-relaxed text-foreground">
            {detail.question}
          </p>
          <EmployeeLink detail={detail} />
        </SectionCard>

        {detail.messages.length > 0 && (
          <SectionCard title={t("followUps")}>
            <div className="flex flex-col gap-3">
              {detail.messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "flex flex-col gap-1",
                    m.direction === "INBOUND" ? "items-start" : "items-end",
                  )}
                >
                  <span className="px-1 text-xs text-muted-foreground">
                    {m.direction === "INBOUND" ? t("fromEmployee") : t("fromHr")} · {when(m.at)}
                  </span>
                  <p className="m-0 max-w-[85%] whitespace-pre-line rounded-2xl border border-border px-4 py-3 text-base leading-relaxed text-foreground">
                    {m.body}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {detail.sendError && (
          <SectionCard title={t("sendErrorLabel")}>
            <p className="m-0 text-sm text-muted-foreground">{detail.sendError}</p>
          </SectionCard>
        )}

        <SectionCard
          // Not `draftLabel` — that is the FIELD's label, and repeating it as
          // the card heading directly above put the same two words on screen
          // twice with nothing between them.
          title={t("draftSection")}
          subtitle={
            [
              detail.draftedBy?.name ? t("draftedBy", { name: detail.draftedBy.name }) : null,
              detail.submittedBy?.name ? t("submittedBy", { name: detail.submittedBy.name }) : null,
              detail.approvedBy?.name ? t("answeredBy", { name: detail.approvedBy.name }) : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        >
          <div className="flex flex-col gap-4">
            {/* Three states, and the two terminal ones render the answer as TEXT
                rather than as a disabled field. A closed thread used to show an
                editable-looking textarea with no buttons under it and no reason
                given — the reader's only clue that nothing could be done was the
                absence of a control, which is exactly the dishonest empty state
                the rubric's state-honesty row is about. */}
            {sent || closed || detail.status === "APPROVED" || !canDraft ? (
              <>
                <p className="m-0 whitespace-pre-line text-base leading-relaxed text-foreground">
                  {detail.draftAnswer}
                </p>
                <p className="m-0 text-sm text-muted-foreground">
                  {closed
                    ? t("closedNotice")
                    : sent
                      ? t("alreadySent")
                      : detail.status === "APPROVED"
                        ? t("statusAPPROVED")
                        : t("noDraftRights")}
                </p>
              </>
            ) : (
              <>
                <Label htmlFor="draft-answer">{t("draftLabel")}</Label>
                <textarea
                  id="draft-answer"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t("draftPlaceholder")}
                  className="min-h-48 w-full rounded-md border border-input bg-background p-3 text-sm"
                />
                {detail.status === "PENDING_APPROVAL" && (
                  <p className="m-0 text-sm text-muted-foreground">{t("pendingNotice")}</p>
                )}
              </>
            )}

            <ActionRow
              detail={detail}
              draft={draft}
              busy={busy}
              canApprove={canApprove}
              canDraft={canDraft}
              act={act}
              t={t}
            />
          </div>
        </SectionCard>

        <HistoryCard events={detail.events} when={when} t={t} />

        <Link
          href={`/${locale}/tickets`}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          {t("back")}
        </Link>
      </div>
    </>
  );
}
