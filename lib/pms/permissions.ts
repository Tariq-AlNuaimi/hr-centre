import type { PmsRole } from "@/generated/prisma/client";

/**
 * PMS capability resolution — spec §4 (roles, permissions & visibility).
 *
 * Every authority question in the system funnels through this file so the
 * answers cannot drift between a route, a server component, and a service.
 *
 * Two structural choices from ADR-065 shape everything here:
 *
 *   1. Roles are ADDITIVE (§4.3). A person may hold several; permissions merge
 *      on a "most access wins" basis. There are no hybrid roles — the COO is
 *      simply someone with EXECUTIVE_VIEWER who also has direct reports.
 *
 *   2. Line-manager authority is DERIVED, never assigned. It comes from
 *      `Employee.managerId` edges, so §4.2's "editing and sign-off is always
 *      reserved for the direct line manager" holds by construction: there is no
 *      field anyone could set to hand another person's sign-off rights away.
 *
 * The functions take a plain `PmsActor` rather than a session so they stay pure
 * and directly testable, and so a background job (a future escalation sweep)
 * can ask the same questions without inventing a session.
 */

/** The resolved identity behind a request. See lib/pms/actor.ts. */
export type PmsActor = {
  /** Auth.js user id. Present for anyone who reached an authenticated route. */
  userId: string;
  /**
   * The linked employee record, or null. Null is a legitimate state, not an
   * error: a platform ADMIN administering the app may have no employee record
   * at all. Such an actor has no PMS authority from this file — platform
   * administration and HR authority are deliberately separate (ADR-065).
   */
  employeeId: string | null;
  pmsRoles: PmsRole[];
  /**
   * True when this actor has at least one direct report. Derived from the org
   * tree, not stored, and the only source of line-manager authority.
   */
  isLineManager: boolean;
};

/**
 * §4.1 — HR Super Admin ("everything + overrides; runs calibration") and HRBP
 * ("runs the cycle org-wide"). Grouped where the spec grants them the same
 * thing; kept apart wherever it does not — see `canRunCalibration` and
 * `canExportMasterResults`, which are Super-Admin-only.
 */
export function isHr(actor: PmsActor): boolean {
  return actor.pmsRoles.includes("HR_SUPER_ADMIN") || actor.pmsRoles.includes("HRBP");
}

export function isHrSuperAdmin(actor: PmsActor): boolean {
  return actor.pmsRoles.includes("HR_SUPER_ADMIN");
}

/** §4.1 — COO / Ops Director: org-wide, full drill-down, read-only throughout. */
export function isExecutiveViewer(actor: PmsActor): boolean {
  return actor.pmsRoles.includes("EXECUTIVE_VIEWER");
}

/**
 * Who may see the whole organization, without regard to reporting lines.
 * §4.1 grants this to HR (both flavours) and to the COO/Ops Director.
 */
export function hasOrgWideVisibility(actor: PmsActor): boolean {
  return isHr(actor) || isExecutiveViewer(actor);
}

/**
 * §4.1 — "Configures? HR Super Admin: Yes — full." Everyone else, including
 * HRBP, is "No". This gates org setup (entities, departments), employee record
 * edits, and applying an import.
 *
 * HRBP deliberately excluded: they run the CYCLE org-wide (approvals, 360
 * setup, deadlines, escalations — Phase 2+), which is a different surface from
 * changing the org structure itself.
 */
export function canConfigure(actor: PmsActor): boolean {
  return isHrSuperAdmin(actor);
}

/**
 * §10.6 — "Only HR Super Admin performs calibration adjustments and overrides
 * (and defines the target distribution). HRBP does not touch calibration."
 * Phase 5 consumer; defined here so the boundary is stated once.
 */
export function canRunCalibration(actor: PmsActor): boolean {
  return isHrSuperAdmin(actor);
}

/**
 * §4.1 / §13.5 — the master results export (every component, raw + calibrated
 * scores, calibration reasons, full audit trail) is "Restricted to HR Super
 * Admin only (not HRBP)". Phase 6 consumer; stated here for the same reason.
 */
export function canExportMasterResults(actor: PmsActor): boolean {
  return isHrSuperAdmin(actor);
}

/**
 * §4.5 + §11.6 — FIELD-LEVEL confidentiality, layered on top of role visibility.
 *
 * "Basic salary and computed bonus amounts are visible only to HR (Super Admin +
 * HRBP), the COO, and the Ops Director. Line managers NEVER see salary or bonus
 * — even for their own direct reports and even in their chain view."
 *
 * Note what is absent: there is no "…unless it's your own record" branch. An
 * employee does not read their own salary out of this system — that is payroll's
 * surface — and the employee scorecard (§13.1) shows a band and a score, never a
 * figure. Keeping this a flat field-level predicate means the answer never
 * depends on WHOSE record is being read, which is what makes it auditable.
 *
 * Enforced at the query layer, never the UI: see lib/pms/employee-select.ts.
 */
export function canViewCompensation(actor: PmsActor): boolean {
  return isHr(actor) || isExecutiveViewer(actor);
}

/**
 * §4.2 — hierarchical visibility. An actor may VIEW an employee when:
 *   - it is themselves, or
 *   - they hold org-wide visibility (HR / executive), or
 *   - the employee is anywhere in their downward reporting chain, however deep.
 *
 * `descendantIds` is supplied by the caller (lib/pms/org-tree.ts resolves it in
 * one recursive query) rather than fetched here, so that a list endpoint pays
 * for the walk once instead of once per row.
 */
export function canViewEmployee(
  actor: PmsActor,
  targetEmployeeId: string,
  descendantIds: ReadonlySet<string>,
): boolean {
  if (hasOrgWideVisibility(actor)) return true;
  if (actor.employeeId && actor.employeeId === targetEmployeeId) return true;
  return descendantIds.has(targetEmployeeId);
}

/**
 * §4.2 — "View-only below direct reports: a manager can act (draft/assess/
 * sign-off) only on their DIRECT reports. Everything deeper is view-only.
 * Editing/sign-off is always reserved for the direct line manager — this
 * preserves one owner per employee's assessment."
 *
 * Deliberately keyed on `directManagerId` (a single edge) rather than on the
 * descendant set used by `canViewEmployee`. That difference IS the rule: view
 * follows the whole chain, action follows exactly one link.
 *
 * HR is included because §4.1 grants them "Everything + overrides"; the
 * executive viewer is not, because §4.1 pins them to "Acts on: Nothing".
 */
export function canActOnEmployee(
  actor: PmsActor,
  target: { id: string; managerId: string | null },
): boolean {
  if (isHr(actor)) return true;
  if (!actor.employeeId) return false;
  return target.managerId === actor.employeeId;
}

/**
 * §4.1 — the executive viewer is read-only "throughout". Used to suppress
 * action affordances for an actor who can see everything but change nothing.
 * Note the ordering: someone holding BOTH EXECUTIVE_VIEWER and a line-manager
 * relationship is not read-only, because roles are additive and most access
 * wins (§4.3) — the COO still acts on their own reports.
 */
export function isReadOnly(actor: PmsActor): boolean {
  return isExecutiveViewer(actor) && !isHr(actor) && !actor.isLineManager;
}

/**
 * §3 — who may run an employee import. Upload/preview is HR (either flavour) so
 * an HRBP can prepare and check a file; APPLYING it writes the org structure and
 * is therefore `canConfigure` (Super Admin only), per §4.1's configure column.
 */
export function canPreviewImport(actor: PmsActor): boolean {
  return isHr(actor);
}

export function canApplyImport(actor: PmsActor): boolean {
  return canConfigure(actor);
}

/**
 * The capability bundle handed to server components so a page can render
 * affordances without importing every predicate. Computed once per request.
 */
export type PmsCapabilities = {
  orgWide: boolean;
  /**
   * §4.1's HR (Super Admin or HRBP) — who may RUN the cycle, as opposed to
   * `orgWide`, which is who may SEE it. The two are not the same set: an
   * executive viewer is org-wide and may write nothing. A screen gating an
   * HR-only action on `orgWide` offers a button that always 403s, and
   * `readOnly` is not the complement either — it excludes an executive who
   * happens to have direct reports. This states the predicate the routes use.
   */
  hr: boolean;
  configure: boolean;
  viewCompensation: boolean;
  previewImport: boolean;
  applyImport: boolean;
  runCalibration: boolean;
  exportMasterResults: boolean;
  readOnly: boolean;
  lineManager: boolean;
};

export function capabilitiesFor(actor: PmsActor): PmsCapabilities {
  return {
    orgWide: hasOrgWideVisibility(actor),
    hr: isHr(actor),
    configure: canConfigure(actor),
    viewCompensation: canViewCompensation(actor),
    previewImport: canPreviewImport(actor),
    applyImport: canApplyImport(actor),
    runCalibration: canRunCalibration(actor),
    exportMasterResults: canExportMasterResults(actor),
    readOnly: isReadOnly(actor),
    lineManager: actor.isLineManager,
  };
}
