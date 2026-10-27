import type { Role } from "@/generated/prisma/client";

/**
 * Map an IdP's claims onto the platform `Role` — the SSO seam ADR-013 reserved
 * and ADR-069 filled in.
 *
 * ## Which of the two role systems this is
 *
 * `User.role` (ADMIN / EDITOR / VIEWER) governs PLATFORM administration:
 * `withAdminAuth` gates `/api/users`, `/api/recycling-bin` and `/api/audit-log`
 * on it. It is NOT §4.1's HR authority — that is a role assignment
 * (`AccessRole` / `RoleAssignment`, lib/rbac) granted at `/admin/roles` by a
 * human who means it.
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
 *
 * ## Why the return type is two values, not three (ADR-070, 2026-08-27)
 *
 * This used to read `SSO_EDITOR_GROUPS` and return `EDITOR`. ADR-070 established
 * that `EDITOR` gates NOTHING in this application — `withEditorAuth` exists but
 * is never called — and narrowed the API so the value can no longer be granted
 * there. This was the one remaining way to mint one, and a post-push breadth
 * review found it: JIT provisioning never touches `createUserSchema`, so the
 * boundary narrowing did not reach it.
 *
 * Removing the branch changes no effective permission — someone who would have
 * become `EDITOR` becomes `VIEWER`, and the two grant exactly the same thing —
 * while removing a stored value that LOOKS like a privilege and is not. That is
 * the whole point of ADR-070: a role that does not do what it appears to do
 * teaches something false to the next person who reads the row.
 *
 * `SSO_EDITOR_GROUPS` is therefore no longer read. A deployment that still sets
 * it is not broken and needs no coordinated change — those users simply land on
 * `VIEWER`, which is what `EDITOR` already meant in practice. Retire the variable
 * at leisure; see `.env.example`.
 */
export function mapSsoRole(claims: Record<string, unknown> | undefined): Role {
  const groups = extractGroups(claims);
  const admin = csv(process.env.SSO_ADMIN_GROUPS);
  if (groups.some((g) => admin.has(g))) return "ADMIN";
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
