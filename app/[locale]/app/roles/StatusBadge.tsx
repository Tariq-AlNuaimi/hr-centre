import { Badge } from "@/components/ui/badge";
import type { RoleProfileStatus } from "@/generated/prisma/client";

// Calm status tones (no traffic-light): DRAFT muted, IN_REVIEW/APPROVED accent,
// ACTIVE the pass signal, ARCHIVED outline. The label is i18n'd by the caller.
const STATUS_VARIANT: Record<
  RoleProfileStatus,
  "default" | "accent" | "pass" | "outline"
> = {
  DRAFT: "default",
  IN_REVIEW: "accent",
  APPROVED: "accent",
  ACTIVE: "pass",
  ARCHIVED: "outline",
};

export function StatusBadge({
  status,
  label,
}: {
  status: RoleProfileStatus;
  label: string;
}) {
  return <Badge variant={STATUS_VARIANT[status]}>{label}</Badge>;
}
