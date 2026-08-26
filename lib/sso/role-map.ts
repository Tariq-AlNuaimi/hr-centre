import type { Role } from "@/generated/prisma/client";

/**
 * Map an IdP's claims onto the platform `Role` — the SSO seam ADR-013 reserved
 * and ADR-069 filled in.
 *
 * ## Which of the two role systems this is
 *
 * `User.role` (ADMIN / EDITOR / VIEWER) governs PLATFORM administration:
 * `withAdminAuth` gates `/api/users`, `/api/recycling-bin` and `/api/audit-log`
 * on it. It is NOT §4.1's HR authority — that lives on `Employee.pmsRoles`
 * (HR_SUPER_ADMIN / HRBP / EXECUTIVE_VIEWER) and is granted at `/admin/roles`
 * by a human who means it.
 *
 * So an IdP group can make someone a platform administrator. It cannot make them
 * an HR Super Admin, and it must not: §4.1's authority is derived from the org
 * and from a deliberate grant, not from a directory group somebody in IT edits.
 *
 * ## Least privilege, and why the default matters most
 *
 * Anything not explicitly listed lands on `VIEWER`. That is the same answer the
 * employee import gives a newly-provisioned account, so the two paths into the
 * system cannot disagree about what an ordinary person is.
 *
 * The default is the security property here. A misconfigured IdP — wrong claim
 * name, groups not emitted, a tenant that sends object ids where names were
 * expected — produces an empty group list, and an empty group list must grant
 * nothing. Written as an allowlist rather than a denylist for exactly that
 * reason: the failure mode of a forgotten entry is too little access, never too
 * much.
 */
export function mapSsoRole(claims: Record<string, unknown> | undefined): Role {
  const groups = extractGroups(claims);
  const admin = csv(process.env.SSO_ADMIN_GROUPS);
  const editor = csv(process.env.SSO_EDITOR_GROUPS);
  if (groups.some((g) => admin.has(g))) return "ADMIN";
  if (groups.some((g) => editor.has(g))) return "EDITOR";
  return "VIEWER";
}

function csv(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * IdPs disagree about where group membership lives, so check the three shapes
 * that actually occur: `groups` (Okta, generic OIDC), `roles` (Entra app roles),
 * and Entra's fully-qualified SAML-style claim URI, which still appears in some
 * token configurations.
 *
 * A single comma-separated string is accepted alongside an array: some tenants
 * emit one group as a bare string rather than a one-element list, and treating
 * that as "no groups" would silently demote a real administrator.
 */
function extractGroups(claims: Record<string, unknown> | undefined): string[] {
  if (!claims) return [];
  const raw =
    claims.groups ??
    claims.roles ??
    claims["http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}
