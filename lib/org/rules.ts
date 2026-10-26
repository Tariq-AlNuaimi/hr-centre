/**
 * Pure org-structure rules — blueprint §1 (F-a), AC-F1.1–AC-F1.3.
 *
 * No database access here, so the rules are unit-testable and the import, the
 * form and the admin screens all ask the same question the same way.
 */

/** A refusal the route turns into an HTTP response (409 by default). */
export class OrgRuleError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 409,
  ) {
    super(message);
    this.name = "OrgRuleError";
  }
}

/**
 * A department's directorate (if any) must belong to the department's company.
 * The DB enforces the same thing with `departments_directorate_entity_agree_fkey`;
 * this produces the sentence.
 */
export function departmentPlacementProblem(input: {
  entityId: string;
  directorate: { entityId: string } | null;
}): string | null {
  if (input.directorate && input.directorate.entityId !== input.entityId) {
    return "directorateId: that directorate belongs to a different company";
  }
  return null;
}

type UnitKind = "directorate" | "department" | "team";

/**
 * AC-F1.3 — "Retiring a unit with people in it is refused with a count." A
 * directorate holds people only through its departments, so it is refused while
 * it still has any.
 */
export function retireRefusal(
  kind: UnitKind,
  counts: { people?: number; departments?: number },
): string | null {
  const people = counts.people ?? 0;
  const departments = counts.departments ?? 0;
  if (people > 0) {
    const who = people === 1 ? "1 person" : `${people} people`;
    return `This ${kind} still has ${who} in it. Move them to another ${kind} before retiring it.`;
  }
  if (departments > 0) {
    const what = departments === 1 ? "1 department" : `${departments} departments`;
    return `This ${kind} still has ${what} under it. Move or retire them before retiring it.`;
  }
  return null;
}
