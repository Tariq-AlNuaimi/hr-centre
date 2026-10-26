import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { hasDirectReports } from "./org-tree";
import { loadGrants, scopeMemberIds } from "@/lib/rbac/resolve";
import type { Grants } from "@/lib/rbac/grants";
import { capabilitiesFor, type PmsActor, type PmsCapabilities } from "./permissions";

/**
 * Resolves an Auth.js session into the PMS actor behind it — the one place the
 * `User` (login identity) and `Employee` (org record) halves of ADR-065 are
 * assembled, so no caller has to know they are separate tables.
 *
 * Called once per request. Every capability question afterwards is a pure
 * function over the returned object (lib/pms/permissions.ts), so a page that
 * asks nine questions still pays for one lookup.
 */

export type ResolvedActor = PmsActor & {
  capabilities: PmsCapabilities;
  /** Denormalised for display; null when the actor has no employee record. */
  employeeName: string | null;
  entityId: string | null;
  departmentId: string | null;
  /**
   * F-c — employees a COMPANY/DIRECTORATE/DEPARTMENT-scoped `people.view`
   * covers (empty for Group-scoped or no grant). Folded into visibility by
   * lib/pms/org-tree.ts so a scoped HR officer sees exactly their scope.
   */
  scopeMembers: ReadonlySet<string>;
};

/**
 * An actor with a session but no employee record. A legitimate state, not an
 * error: a platform ADMIN maintaining the application may never appear in the
 * HR org data, and the two authority systems are deliberately separate
 * (ADR-065). Such an actor sees nothing in the PMS and can configure nothing.
 *
 * That is a statement about the RESTING state, not a security boundary. A
 * platform admin controls credentials — they can provision a login on an
 * unclaimed employee's email and let the first-login match below link it, or
 * simply reset an already-linked user's password. Both were reproduced; both are
 * audited. See ADR-065 "What this separation does and does not buy". Do not
 * restate this as "platform administration does not confer HR authority": it
 * confers it by default, and withholds it only from an admin who does not act.
 */
async function withGrants(
  base: Omit<PmsActor, "grants">,
  extra: Pick<ResolvedActor, "employeeName" | "entityId" | "departmentId">,
): Promise<ResolvedActor> {
  // ONE assignments query per request, expanded in memory; nothing cached past
  // the request, so a role edit takes effect on the very next one.
  const grants: Grants = await loadGrants(base.userId);
  const actor: PmsActor = { ...base, grants };
  return {
    ...actor,
    ...extra,
    capabilities: capabilitiesFor(actor),
    scopeMembers: await scopeMemberIds(grants, "people.view"),
  };
}

function unlinkedActor(userId: string): Promise<ResolvedActor> {
  return withGrants(
    { userId, employeeId: null, pmsRoles: [], isLineManager: false },
    { employeeName: null, entityId: null, departmentId: null },
  );
}

/**
 * Resolve the actor for a session.
 *
 * The employee is found by `userId` link first. If there is no link yet, we fall
 * back to matching the session email — that is the first-login linking path
 * (§3.3 lists email as the field used "for login/notifications", and employees
 * exist in the table before they ever sign in). The link is then persisted so
 * subsequent requests take the indexed `userId` path and so an Odoo email change
 * cannot silently detach an account that was already linked.
 *
 * Email matching is only ever used to establish a link that does not exist. Once
 * `userId` is set it is authoritative, exactly as ADR-045 concluded for SCIM:
 * correlating on a mutable email at every request would let a directory email
 * change reattach a session to the wrong record.
 */
export async function resolveActor(session: Session): Promise<ResolvedActor> {
  const userId = session.user.id;

  let employee = await prisma.employee.findUnique({
    where: { userId },
    select: {
      id: true,
      name: true,
      entityId: true,
      departmentId: true,
    },
  });

  if (!employee) {
    const email = session.user.email;
    if (!email) return unlinkedActor(userId);

    const unlinked = await prisma.employee.findFirst({
      // `userId: null` matters: without it, an employee already linked to a
      // DIFFERENT user whose email happens to match would be hijacked here.
      where: { email, userId: null },
      select: { id: true, name: true, entityId: true, departmentId: true },
    });
    if (!unlinked) return unlinkedActor(userId);

    // Persist the link. Wrapped rather than awaited bare: two concurrent
    // requests from a first login can race, and the loser hits the unique
    // constraint on `userId`. That is a benign collision — the link it wanted
    // already exists — so it must not turn a page render into a 500.
    try {
      await prisma.employee.update({ where: { id: unlinked.id }, data: { userId } });
    } catch {
      // Intentionally swallowed: the actor below is correct either way, and the
      // next request takes the `userId` path.
    }
    employee = unlinked;
  }

  const isLineManager = await hasDirectReports(employee.id);

  // F-c: authority comes from role assignments; `Employee.pmsRoles` is no
  // longer read (migrated into assignments by 20261026180000).
  return withGrants(
    { userId, employeeId: employee.id, pmsRoles: [], isLineManager },
    {
      employeeName: employee.name,
      entityId: employee.entityId,
      departmentId: employee.departmentId,
    },
  );
}
