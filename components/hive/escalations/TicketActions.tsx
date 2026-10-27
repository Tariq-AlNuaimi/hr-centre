"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { apiClient } from "@/lib/api-client";
import { allowedActions } from "./allowed-actions";

export interface Detail {
  /**
   * What THIS viewer may do on THIS ticket, decided by the server from their
   * pair-scoped grants (ADR-073). Chrome only — every action re-checks.
   */
  abilities: { draft: boolean; approve: boolean; ownDraft: boolean };
  /** Spec V2 §8.8 Settings: the prefix and HR's label renames. */
  settings: { ticketPrefix: string; statusLabels: Record<string, string> };
  id: string;
  ticketNumber: number;
  status: string;
  employeeName: string;
  employeeEmail: string;
  identityVerified: boolean;
  employee: { id: string; name: string } | null;
  question: string;
  draftAnswer: string | null;
  sendError: string | null;
  createdAt: string;
  sentAt: string | null;
  approvedAt: string | null;
  submittedAt: string | null;
  hrPair: { id: string; name: string } | null;
  assignee: { id: string; name: string | null } | null;
  dueAt: string | null;
  draftedBy: { id: string; name: string | null } | null;
  approvedBy: { id: string; name: string | null } | null;
  submittedBy: { id: string; name: string | null } | null;
  events: {
    id: string;
    kind: string;
    note: string | null;
    at: string;
    actor: { id: string; name: string | null } | null;
  }[];
  messages: { id: string; direction: string; body: string; at: string }[];
}

/** The detail screen's action row, return form and history (split from the page for size). */

export type Act = (run: () => Promise<unknown>, ok: string, fail: string) => Promise<void>;

/**
 * What this ticket still permits, as buttons.
 *
 * Split out because the branching IS the §5.4 workflow — save, submit, return,
 * approve, retry, close — each with its own permission and its own state, and a
 * component that also renders the answer had to re-derive all of it around a
 * textarea. Every button here is chrome over a service-side check: the service
 * refuses the action whatever this row shows.
 */
export function ActionRow({
  detail,
  draft,
  busy,
  canApprove,
  canDraft,
  act,
  t,
}: {
  detail: Detail;
  draft: string;
  busy: boolean;
  canApprove: boolean;
  canDraft: boolean;
  act: Act;
  t: (key: string, values?: Record<string, string>) => string;
}) {
  const [more, setMore] = useState(false);
  const [returning, setReturning] = useState(false);
  const trimmed = draft.trim();
  const empty = trimmed.length === 0;
  const unsaved = trimmed !== (detail.draftAnswer ?? "").trim();
  const can = allowedActions(
    detail.status,
    canApprove,
    canDraft,
    unsaved,
    detail.abilities.ownDraft,
  );

  const saveDraft = () =>
    apiClient.request(`/api/hive/escalations/${detail.id}`, {
      method: "PATCH",
      body: { draftAnswer: trimmed },
    });
  const approve = () => apiClient.post(`/api/hive/escalations/${detail.id}/approve`);
  const submit = async () => {
    // Submitting is a statement about the text on screen, so it saves first.
    if (unsaved) await saveDraft();
    await apiClient.post(`/api/hive/escalations/${detail.id}/submit`);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* UX P1 (tickets P1-3): ONE primary action by state — approve and send,
          retry, or submit — with Save as the quiet companion, Return as a
          disclosure and Close behind "More". */}
      <div className="flex flex-wrap items-center gap-3">
        <PrimaryAction
          can={can}
          busy={busy}
          unsaved={unsaved}
          empty={empty}
          hasDraft={Boolean(detail.draftAnswer?.trim())}
          onApprove={() => void act(approve, t("approved"), t("approveFailed"))}
          onSubmit={() => void act(submit, t("submitted"), t("submitFailed"))}
          t={t}
        />

        {can.save && (
          <Button
            variant="outline"
            disabled={busy || empty || !unsaved}
            onClick={() => void act(saveDraft, t("draftSaved"), t("draftFailed"))}
          >
            {busy ? t("savingDraft") : t("saveDraft")}
          </Button>
        )}

        {can.returnToDraft && (
          <Button
            variant="ghost"
            aria-expanded={returning}
            onClick={() => setReturning(!returning)}
          >
            {t("returnToggle")}
          </Button>
        )}

        {can.close && (
          <Button variant="ghost" aria-expanded={more} onClick={() => setMore(!more)}>
            {t("more")}
          </Button>
        )}
      </div>

      {more && can.close ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
          <ConfirmAction
            title={t("close")}
            description={t("closeConfirm")}
            okText={t("close")}
            okType="danger"
            onConfirm={() =>
              void act(
                () => apiClient.post(`/api/hive/escalations/${detail.id}/close`),
                t("closed"),
                t("closeFailed"),
              )
            }
          >
            <Button variant="outline" disabled={busy}>
              {t("close")}
            </Button>
          </ConfirmAction>
          <span className="text-xs text-muted-foreground">{t("closeHint")}</span>
        </div>
      ) : null}

      {can.explainUnsaved && (
        <p className="m-0 text-sm text-muted-foreground">{t("unsavedBeforeApprove")}</p>
      )}

      {/* AC-10.2: hiding a control is not refusing an action — the service
          refuses it. This line says why there is no Approve button. */}
      {can.explainOwnDraft && (
        <p className="m-0 text-sm text-muted-foreground">{t("waitingForAnotherApprover")}</p>
      )}

      {can.explainNoApprove && (
        <p className="m-0 text-sm text-muted-foreground">{t("noApproveRights")}</p>
      )}

      {can.returnToDraft && returning ? (
        <ReturnForm id={detail.id} busy={busy} act={act} t={t} />
      ) : null}
    </div>
  );
}

/** The one primary action this state allows: approve and send, retry, or submit. */
function PrimaryAction({
  can,
  busy,
  unsaved,
  empty,
  hasDraft,
  onApprove,
  onSubmit,
  t,
}: {
  can: ReturnType<typeof allowedActions>;
  busy: boolean;
  unsaved: boolean;
  empty: boolean;
  hasDraft: boolean;
  onApprove: () => void;
  onSubmit: () => void;
  t: (key: string) => string;
}) {
  if (can.approve)
    return (
      <Button disabled={busy || unsaved} onClick={onApprove}>
        {busy ? t("approving") : t("approve")}
      </Button>
    );
  if (can.retry)
    return (
      <Button disabled={busy || !hasDraft} onClick={onApprove}>
        {busy ? t("approving") : t("retrySend")}
      </Button>
    );
  if (can.submit)
    return (
      <Button disabled={busy || empty} onClick={onSubmit}>
        {busy ? t("submitting") : t("submit")}
      </Button>
    );
  return null;
}

/** An approver hands a submitted draft back, with an optional note (AC-T2.2). */
function ReturnForm({
  id,
  busy,
  act,
  t,
}: {
  id: string;
  busy: boolean;
  act: Act;
  t: (key: string, values?: Record<string, string>) => string;
}) {
  const [returnNote, setReturnNote] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="return-note">{t("returnNoteLabel")}</Label>
      <div className="flex flex-wrap items-start gap-3">
        <textarea
          id="return-note"
          value={returnNote}
          maxLength={1000}
          onChange={(e) => setReturnNote(e.target.value)}
          placeholder={t("returnNotePlaceholder")}
          className="min-h-20 w-full max-w-xl rounded-md border border-input bg-background p-3 text-sm"
        />
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void act(
              () =>
                apiClient.post(`/api/hive/escalations/${id}/return`, {
                  note: returnNote.trim() || undefined,
                }),
              t("returned"),
              t("returnFailed"),
            )
          }
        >
          {t("returnToDraft")}
        </Button>
      </div>
    </div>
  );
}
