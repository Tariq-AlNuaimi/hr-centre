import { Badge, type BadgeProps } from "@/components/ui/badge";

/**
 * A ticket's status as the Rihal HR platform look v0.2 draws it (ADR-076): a
 * tinted pill with a leading dot, one hue per meaning, the same in every HR app.
 *
 * - Open: warn (waiting on a person to pick it up)
 * - In progress, Sending: info (in motion)
 * - Pending approval: the accent (the one hand-off HIVE exists to enforce)
 * - Sent: ok
 * - Send failed: err. It is recoverable, but it is the one state where an
 *   employee is waiting on an email that never left, and in v0.2 orange
 *   already means Open.
 * - Closed: neutral
 *
 * The dot is decoration (`aria-hidden`); the label carries the meaning, so
 * nothing depends on telling the colours apart.
 */
const TONE: Record<string, NonNullable<BadgeProps["variant"]>> = {
  OPEN: "warning",
  IN_PROGRESS: "info",
  APPROVED: "info",
  PENDING_APPROVAL: "brand",
  SENT: "success",
  SEND_FAILED: "danger",
  CLOSED: "default",
};

export function StatusPill({ status, label }: { status: string; label: string }) {
  return (
    <Badge variant={TONE[status] ?? "default"}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </Badge>
  );
}
