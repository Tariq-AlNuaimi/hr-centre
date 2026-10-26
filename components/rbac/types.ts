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
  scopeType: "GROUP" | "COMPANY" | "DIRECTORATE" | "DEPARTMENT";
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
