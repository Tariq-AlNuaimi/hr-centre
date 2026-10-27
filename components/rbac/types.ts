import type { ScopeTypeCode } from "@/lib/validations/rbac";

/** Wire shapes of /api/rbac/* as the admin screens consume them. */

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  starterKey: string | null;
  _count: { assignments: number };
};

export type AssignmentRow = {
  id: string;
  scopeType: ScopeTypeCode;
  scopeId: string | null;
  scopeLabel: string | null;
  validFrom: string | null;
  validUntil: string | null;
  note: string | null;
  expired: boolean;
  user: { id: string; name: string | null; email: string };
  role: { id: string; name: string };
  grantedBy: { name: string | null; email: string } | null;
};

/** GET /api/rbac/effective — one person's effective access (UX P1 R12d). */
export type EffectiveAccess = {
  assignments: Array<{
    id: string;
    role: { id: string; name: string };
    scope: { type: string; label: string | null };
    validUntil: string | null;
  }>;
  permissions: Array<{ code: string; scopes: Array<{ type: string; label: string | null }> }>;
};
