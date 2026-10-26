import type { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { forbidden } from "@/lib/api-response";
import type { Permission } from "@/lib/rbac/catalogue";
import { canInScope, type Grants, type ScopeRef } from "@/lib/rbac/grants";
import { loadGrants } from "@/lib/rbac/resolve";
import { registerHivePairScopes } from "@/lib/hive/pair-scope";

/**
 * HR tickets' permission model on HR Centre's role builder (docs/blueprints/hive.md
 * §Access; replaces HIVE's `HrPermissionGrant` rows, ADR-073).
 *
 * HIVE's six per-person grants become catalogue actions held through roles:
 *
 *   SEE_TICKETS → tickets.see        DRAFT        → tickets.draft
 *   APPROVE     → tickets.approve    EDIT_CONTENT → tickets.editContent
 *   VIEW_REPORTS→ tickets.viewReports
 *   MANAGE_ACCOUNTS → (none) — only platform admins manage roles (operator
 *   decision); `tickets.configure` is new: the reference-data admin screens.
 *
 * Draft and Approve keep HIVE's three scopes as assignment scopes: GROUP (all
 * pairs), HR_PAIR (one named pair — time-boxed cover), OWN_HR_PAIR (the pair of
 * the HR Tag member linked to the holder's login). The scope kinds are
 * registered with `registerScopeResolver` and every check goes through
 * `canInScope` → `scopeCovers`.
 *
 * Read live on every request (one assignments query), never from the JWT, so a
 * revoked role stops working on the next request (HIVE AC-T3.5).
 */

registerHivePairScopes();

/** The HIVE actions, in the names the routes and services use. */
export type HiveAction =
  "seeTickets" | "draftEscalation" | "approve" | "editContent" | "configure" | "viewReports";

export type HivePermissions = Record<HiveAction, boolean>;

/** @public */
export const ACTION_PERMISSION: Record<HiveAction, Permission> = {
  seeTickets: "tickets.see",
  draftEscalation: "tickets.draft",
  approve: "tickets.approve",
  editContent: "tickets.editContent",
  configure: "tickets.configure",
  viewReports: "tickets.viewReports",
};

/** Pair-scoped actions: held "somewhere" when held at any ticket scope. */
const PAIR_SCOPED = new Set<HiveAction>(["draftEscalation", "approve"]);
const PAIR_SCOPE_TYPES = new Set(["GROUP", "HR_PAIR", "OWN_HR_PAIR"]);

function holds(grants: Grants, action: HiveAction): boolean {
  const scopes: readonly ScopeRef[] = grants.get(ACTION_PERMISSION[action]) ?? [];
  if (PAIR_SCOPED.has(action)) return scopes.some((s) => PAIR_SCOPE_TYPES.has(s.type));
  // The rest act group-wide only (HIVE refused to scope them): a scoped
  // assignment of them grants nothing.
  return scopes.some((s) => s.type === "GROUP");
}

/**
 * Current permissions: does the person hold each action for AT LEAST ONE pair?
 * That gates a route or a menu entry; acting on a particular ticket is
 * {@link canOnPair}. All-false for an unknown user rather than throwing.
 *
 * @public
 */
export async function getHivePermissions(userId: string): Promise<HivePermissions> {
  const grants = await loadGrants(userId);
  return permissionsFrom(grants);
}

/** @public */
export function permissionsFrom(grants: Grants): HivePermissions {
  return {
    seeTickets: holds(grants, "seeTickets"),
    draftEscalation: holds(grants, "draftEscalation"),
    approve: holds(grants, "approve"),
    editContent: holds(grants, "editContent"),
    configure: holds(grants, "configure"),
    viewReports: holds(grants, "viewReports"),
  };
}

/** @public */
export async function hasHivePermission(userId: string, action: HiveAction): Promise<boolean> {
  return holds(await loadGrants(userId), action);
}

/**
 * The pairs this login is a member of (OWN_HR_PAIR). One member per login
 * (`HrTagMember.userId @unique`), so at most one id; a deleted member or pair
 * gives nothing — fail closed rather than guess.
 */
export async function ownPairIds(userId: string): Promise<string[]> {
  const member = await prisma.hrTagMember.findUnique({
    where: { userId },
    select: { pairId: true, deletedAt: true, pair: { select: { deletedAt: true } } },
  });
  if (!member || member.deletedAt || member.pair.deletedAt) return [];
  return [member.pairId];
}

/**
 * May this person Draft / Approve on a ticket routed to `pairId`, right now?
 * GROUP covers every pair; HR_PAIR the one it names; OWN_HR_PAIR the pair of the
 * member linked to the login. An account linked to no member gets nothing from
 * OWN_HR_PAIR.
 *
 * @public
 */
export async function canOnPair(
  userId: string,
  action: "draftEscalation" | "approve",
  pairId: string,
): Promise<boolean> {
  const grants = await loadGrants(userId);
  const permission = ACTION_PERMISSION[action];
  const scopes = grants.get(permission) ?? [];
  // Only read the member link when an OWN_HR_PAIR assignment could use it.
  const actorPairIds = scopes.some((s) => s.type === "OWN_HR_PAIR") ? await ownPairIds(userId) : [];
  return canInScope(grants, permission, { hrPairId: pairId, actorPairIds });
}

/**
 * The label shown beside a person's name (HIVE AC-T3.7) — display only.
 * HIVE's "Admin" meant Manage accounts; here it means the ticket admin actions.
 *
 * @public
 */
export function roleLabelFor(p: HivePermissions): "Admin" | "Approver" | "Drafter" | "Viewer" {
  if (p.configure || p.editContent) return "Admin";
  if (p.approve) return "Approver";
  if (p.draftEscalation) return "Drafter";
  return "Viewer";
}

/**
 * Permission guard, applied INSIDE an auth wrapper:
 * `withAuth(requireHivePermission("editContent", handler))` — 403 without it.
 * Composed rather than its own wrapper so `withAuth` stays visible in every
 * route file (`no-bare-api-route`).
 *
 * @public
 */
export function requireHivePermission(
  action: HiveAction,
  handler: (
    req: NextRequest,
    ctx: { params: Promise<Record<string, string>>; session: Session },
  ) => Promise<NextResponse>,
) {
  return async (
    req: NextRequest,
    ctx: { params: Promise<Record<string, string>>; session: Session },
  ): Promise<NextResponse> => {
    if (!(await hasHivePermission(ctx.session.user.id, action))) return forbidden();
    return handler(req, ctx);
  };
}

/**
 * Which pairs this person may Draft / Approve on right now — "all" for a
 * group-wide assignment, else the HR_PAIR ids plus their own pair. Used to
 * build their task list (My tasks); each action still re-checks `canOnPair`.
 *
 * @public
 */
export async function pairsFor(
  userId: string,
  action: "draftEscalation" | "approve",
): Promise<"all" | string[]> {
  const scopes = (await loadGrants(userId)).get(ACTION_PERMISSION[action]) ?? [];
  if (scopes.some((s) => s.type === "GROUP")) return "all";
  const named = scopes.filter((s) => s.type === "HR_PAIR" && s.id).map((s) => s.id!);
  const own = scopes.some((s) => s.type === "OWN_HR_PAIR") ? await ownPairIds(userId) : [];
  return [...new Set([...named, ...own])];
}
