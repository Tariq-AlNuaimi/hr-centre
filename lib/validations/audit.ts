// Client-safe audit constants (the handoff's client/server boundary trap): the audit
// filter is a "use client" island, so the action/entity-type tuples it renders must
// live in a module that does NOT import the Prisma runtime (lib/services/audit.ts
// does). Both the client filter and the server service/route import these from here.

export const AUDIT_ACTIONS = ["CREATE", "UPDATE", "DELETE", "RESTORE"] as const;
export type AuditActionValue = (typeof AUDIT_ACTIONS)[number];

// The entity types that appear in the trail — drives the filter dropdown. A superset
// is harmless (a type with no rows simply lists nothing); a missing one just isn't a
// filter option. Keep roughly in step with the audited models.
export const AUDIT_ENTITY_TYPES = [
  "User",
  "Organization",
  "RoleFamily",
  "RoleProfile",
  "Competency",
  "SjtItem",
  "Invitation",
  "Assessment",
  "Result",
  "OutcomeRecord",
  "ProfileCalibration",
  "AppSetting",
] as const;
