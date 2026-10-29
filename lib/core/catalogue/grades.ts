import { prisma } from "@/lib/prisma";

/**
 * The core grade catalogue (ADR-097). `Employee.gradeId` is kept in step with
 * `Employee.grade` by a database trigger on every employee write; this re-runs
 * that link for employees whose grade matches a code that was just added to or
 * renamed in the catalogue (and drops links to a removed grade).
 *
 * Raw SQL with placeholders, scoped by WHERE: the link is a derived column the
 * trigger owns, so re-deriving it is not an employee edit worth an audit row
 * per person (the catalogue change itself is audited).
 */
export async function relinkEmployeeGrades(codes: ReadonlyArray<string | null | undefined>) {
  const lower = [...new Set(codes.filter((c): c is string => Boolean(c?.trim())))].map((c) =>
    c.trim().toLowerCase(),
  );
  if (lower.length === 0) return 0;
  return prisma.$executeRaw`
    UPDATE "employees"
    SET "grade_id" = core_employee_grade_id("grade", "entityId")
    WHERE "grade" IS NOT NULL AND lower(btrim("grade")) = ANY(${lower})`;
}
