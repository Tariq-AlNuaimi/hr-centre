import { Badge } from "@/components/ui/badge";
import type { InvitationStatus } from "@/generated/prisma/client";

// Calm status tones (UI-SPEC A.2, never traffic-light): sent muted, opened/started
// accent, completed the pass signal, expired outline, revoked the muted clay
// "below" tone (not alarm-red). The label is i18n'd by the caller.
const STATUS_VARIANT: Record<
  InvitationStatus,
  "default" | "accent" | "pass" | "outline" | "below"
> = {
  PENDING: "default",
  OPENED: "accent",
  STARTED: "accent",
  COMPLETED: "pass",
  EXPIRED: "outline",
  REVOKED: "below",
};

export function InvitationStatusBadge({
  status,
  label,
}: {
  status: InvitationStatus;
  label: string;
}) {
  return <Badge variant={STATUS_VARIANT[status]}>{label}</Badge>;
}
