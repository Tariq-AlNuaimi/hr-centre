import { SCOPED_PERMISSIONS, STARTER_ROLES, type Permission } from "./catalogue";

/**
 * Grants — what an actor may do, and where. Pure (no Prisma): built once per
 * request from the actor's assignments (lib/rbac/resolve.ts) and asked
 * synchronously afterwards, so no cached permission outlives the request
 * (blueprint worst path).
 *
 * SCOPES ARE EXTENSIBLE. The org kinds (GROUP, COMPANY, DIRECTORATE,
 * DEPARTMENT) are registered here; a module adds its own kind (e.g. HR tickets'
 * pairings) by extending the `ScopeType` enum and calling
 * `registerScopeResolver` — every check goes through `scopeCovers`, the ONE
 * function that decides whether a scope covers a subject.
 */

export type ScopeRef = { type: string; id: string | null };

/** What a scope is evaluated against: an employee's placement, plus any module keys. */
export type ScopeSubject = {
  entityId?: string | null;
  directorateId?: string | null;
  departmentId?: string | null;
  [key: string]: unknown;
};

type ScopeResolver = (scopeId: string | null, subject: ScopeSubject) => boolean;

const resolvers = new Map<string, ScopeResolver>([
  ["GROUP", () => true],
  ["COMPANY", (id, s) => id !== null && s.entityId === id],
  ["DIRECTORATE", (id, s) => id !== null && s.directorateId === id],
  ["DEPARTMENT", (id, s) => id !== null && s.departmentId === id],
]);

/** For modules: teach the evaluator a new scope kind. Org kinds cannot be replaced. */
export function registerScopeResolver(type: string, resolver: ScopeResolver): void {
  if (["GROUP", "COMPANY", "DIRECTORATE", "DEPARTMENT"].includes(type)) {
    throw new Error(`Scope ${type} is built in and cannot be re-registered`);
  }
  resolvers.set(type, resolver);
}

/** THE scope check. An unknown kind covers nothing (fail closed). */
export function scopeCovers(scope: ScopeRef, subject: ScopeSubject): boolean {
  const resolver = resolvers.get(scope.type);
  return resolver ? resolver(scope.id, subject) : false;
}

export type Grants = ReadonlyMap<Permission, readonly ScopeRef[]>;

export const NO_GRANTS: Grants = new Map();

/** Merge role bundles into one grant map — "most access wins" (§4.3). */
export function expandGrants(
  assignments: ReadonlyArray<{ permissions: readonly string[]; scope: ScopeRef }>,
): Grants {
  const out = new Map<Permission, ScopeRef[]>();
  for (const a of assignments) {
    for (const p of a.permissions) {
      const list = out.get(p as Permission) ?? [];
      list.push(a.scope);
      out.set(p as Permission, list);
    }
  }
  return out;
}

export function has(grants: Grants, permission: Permission): boolean {
  return (grants.get(permission)?.length ?? 0) > 0;
}

/** Held for the whole group — the only form an org-wide permission counts in. */
export function hasGroup(grants: Grants, permission: Permission): boolean {
  return grants.get(permission)?.some((s) => s.type === "GROUP") ?? false;
}

/**
 * May the actor do `permission` for this subject? Org-wide permissions only
 * count at Group scope (lib/rbac/catalogue.ts scope note).
 */
export function canInScope(grants: Grants, permission: Permission, subject: ScopeSubject): boolean {
  const scopes = grants.get(permission) ?? [];
  if (!SCOPED_PERMISSIONS.has(permission)) return scopes.some((s) => s.type === "GROUP");
  return scopes.some((s) => scopeCovers(s, subject));
}

/** The non-Group scopes a permission is held in (for building scoped lists). */
export function partialScopes(grants: Grants, permission: Permission): ScopeRef[] {
  if (hasGroup(grants, permission)) return [];
  return [...(grants.get(permission) ?? [])];
}

/**
 * The grants a set of starter-role keys means — each starter role at Group
 * scope. Used for actors that predate assignments (and by the Performance
 * contract tests, which is what proves the starter roles reproduce them).
 */
export function starterGrants(pmsRoles: readonly string[]): Grants {
  return expandGrants(
    STARTER_ROLES.filter((r) => pmsRoles.includes(r.key)).map((r) => ({
      permissions: r.permissions,
      scope: { type: "GROUP", id: null },
    })),
  );
}

// --- Assignment windows (time-boxed cover) -----------------------------------

export const MAX_COVER_DAYS = 180;

/** Active now: started (or no start) and not yet ended (or no end). */
export function isAssignmentActive(
  a: { validFrom: Date | null; validUntil: Date | null },
  now: Date,
): boolean {
  return (
    (a.validFrom === null || a.validFrom <= now) && (a.validUntil === null || a.validUntil > now)
  );
}

/** A cover grant ends after it starts and lasts at most 180 days. */
export function validityProblem(
  validFrom: Date | null,
  validUntil: Date | null,
  now: Date,
): string | null {
  if (validUntil === null) return null;
  const start = validFrom ?? now;
  if (validUntil <= start) return "validUntil: must be after the start";
  if (validUntil <= now)
    return "validUntil: must be in the future — this assignment would never apply";
  const days = (validUntil.getTime() - start.getTime()) / 86_400_000;
  if (days > MAX_COVER_DAYS) {
    return `validUntil: a time-boxed assignment lasts at most ${MAX_COVER_DAYS} days`;
  }
  return null;
}
