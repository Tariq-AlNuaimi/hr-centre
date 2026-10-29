import { ApprovalsInbox } from "@/components/approvals/ApprovalsInbox";

/** The one Approvals inbox (ADR-094): every decision waiting on the viewer, and their delegations. */
export default function ApprovalsPage() {
  return <ApprovalsInbox />;
}
