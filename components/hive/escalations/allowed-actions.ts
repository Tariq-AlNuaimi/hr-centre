/**
 * Which actions a ticket offers this viewer — the §5.4 state machine as data,
 * kept pure so the action row only renders it (client mirror; the server decides).
 */
export function allowedActions(
  status: string,
  canApprove: boolean,
  canDraft: boolean,
  unsaved: boolean,
  ownDraft: boolean,
) {
  const pending = status === "PENDING_APPROVAL";
  const editable =
    canDraft && ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL", "SEND_FAILED"].includes(status);
  return {
    save: editable,
    submit:
      editable &&
      (status === "OPEN" || status === "IN_PROGRESS" || (status === "SEND_FAILED" && unsaved)),
    // Amendment B-3: nobody approves the draft they wrote.
    approve: pending && canApprove && !ownDraft,
    // A retry re-sends the STORED answer, so it steps aside while there is an
    // unsaved edit — the edit is a new answer, submitted again.
    // APPROVED too: a send claim that never settled (a crashed send) is
    // recovered by retrying; the service refuses while the claim is fresh.
    retry: (status === "SEND_FAILED" || status === "APPROVED") && canApprove && !unsaved,
    returnToDraft: pending && canApprove,
    close:
      status !== "CLOSED" &&
      status !== "APPROVED" &&
      (canApprove || (canDraft && status === "SENT")),
    explainUnsaved: pending && canApprove && !ownDraft && unsaved,
    explainOwnDraft: pending && canApprove && ownDraft,
    explainNoApprove: (pending || status === "SEND_FAILED") && !canApprove,
  };
}
