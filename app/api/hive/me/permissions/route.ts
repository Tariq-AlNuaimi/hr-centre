import { withAuth } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { getHivePermissions, roleLabelFor } from "@/lib/hive/services/permissions";

/**
 * The caller's own HIVE permissions (§5.3's four booleans), read live.
 *
 * This exists for the navigation, not for access control. §5.3 puts the four
 * booleans on `User` and deliberately keeps them OUT of the session (see
 * `lib/services/hive/permissions.ts` for why), which means client chrome has no
 * way to know whether the person looking at it may edit content -- and a nav
 * entry that leads to a 403 is a dead control, which `docs/uat-rubric.md` makes
 * a Tier-0 failure.
 *
 * It is not a control and must never be treated as one. Every HIVE route gates
 * itself server-side through `withHivePermission`; AC-10.2 is explicit that
 * hiding a control is not refusing an action. This endpoint only answers "what
 * would the server let me do", so the menu can tell the truth.
 *
 * Returns only the caller's own row -- there is no `userId` parameter, so there
 * is nothing here to enumerate other accounts with. The admin-wide view is
 * `GET /api/hive/admin/permissions`, which is `withAdminAuth`.
 */
export const GET = withAuth(async (_req, { session }) => {
  const permissions = await getHivePermissions(session.user.id);
  return ok({
    ...permissions,
    // Blueprint AC-T3.7: the label beside the name, DERIVED from grants for
    // display only (Admin / Approver / Drafter / Viewer).
    roleLabel: roleLabelFor(permissions),
    // The template role, for the surfaces that stay role-gated (HIVE Settings,
    // ADR-069; User management). HIVE's own screens use the grants above
    // (ADR-073). The session already carries this; echoed for one shape.
    isAdmin: session.user.role === "ADMIN",
  });
});
