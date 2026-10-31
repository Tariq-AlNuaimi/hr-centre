import { prisma } from "@/lib/prisma";

/**
 * The core grade catalogue (ADR-097, ADR-103). An employee's grade IS a
 * catalogue row (`Employee.gradeId`); the legacy free-text `Employee.grade`
 * and its sync trigger are gone. Every writer hands over a grade CODE (the
 * import sheet, the form) and resolves it here: the company's own grade first,
 * then a group-wide one, matching ignores case and surrounding spaces. An
 * unknown code is refused with a sentence that says what to do.
 */

export type CatalogueGrade = { id: string; code: string; entityId: string | null };

const norm = (s: string) => s.trim().toLowerCase();

/** Pure: the grade a code names for a company, or null. */
export function pickGrade(
  grades: readonly CatalogueGrade[],
  code: string,
  entityId: string | null,
): CatalogueGrade | null {
  const want = norm(code);
  const hits = grades.filter(
    (g) => norm(g.code) === want && (g.entityId === entityId || g.entityId === null),
  );
  return hits.find((g) => g.entityId !== null) ?? hits[0] ?? null;
}

/** The sentence for a code the catalogue does not know (names the known codes). */
export function unknownGradeMessage(
  code: string,
  companyName: string | null,
  grades: readonly CatalogueGrade[],
  entityId: string | null,
): string {
  const known = [
    ...new Set(
      grades.filter((g) => g.entityId === entityId || g.entityId === null).map((g) => g.code),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const where = companyName ? ` for ${companyName}` : "";
  const hint = known.length
    ? ` Use one of: ${known.slice(0, 12).join(", ")}${known.length > 12 ? ", …" : ""}.`
    : " The catalogue has no grades for this company yet.";
  return `Grade "${code.trim()}" is not in the grade catalogue${where}.${hint} New grades are added in Hiring › Settings › Library.`;
}

/** Every live catalogue grade (codes and companies only — never pay bands). */
export function loadGradeCatalogue(): Promise<CatalogueGrade[]> {
  return prisma.grade.findMany({
    where: { deletedAt: null },
    select: { id: true, code: true, entityId: true },
    orderBy: [{ order: "asc" }, { code: "asc" }],
    take: 2000,
  });
}

/**
 * Resolve one code for a company: the catalogue grade, null for "no grade"
 * (`null` / blank), or `{ problem }` with the sentence to show.
 */
export async function resolveGradeCode(
  code: string | null | undefined,
  entityId: string,
): Promise<{ gradeId: string | null; code: string | null } | { problem: string }> {
  if (code === null || code === undefined || code.trim() === "")
    return { gradeId: null, code: null };
  const [grades, company] = await Promise.all([
    loadGradeCatalogue(),
    prisma.orgEntity.findUnique({ where: { id: entityId }, select: { name: true } }),
  ]);
  const hit = pickGrade(grades, code, entityId);
  return hit
    ? { gradeId: hit.id, code: hit.code }
    : { problem: unknownGradeMessage(code, company?.name ?? null, grades, entityId) };
}
