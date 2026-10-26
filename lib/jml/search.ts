import { prisma } from "@/lib/prisma";
import { caseScopeWhere, type JmlActor } from "./access";

/**
 * Case search (Onboarding AC-DASH-008, `search.ts:48`): name, employee code,
 * case reference, job title or department; ≥ 2 characters, at most 20 hits,
 * newest first, inside the actor's scope.
 */
export async function searchCases(actor: JmlActor, q: string) {
  const scope = caseScopeWhere(actor, "jml.view");
  if (scope === null) return [];
  const term = { contains: q, mode: "insensitive" as const };
  const rows = await prisma.jmlCase.findMany({
    where: {
      AND: [
        scope,
        {
          OR: [
            { caseRef: term },
            { employee: { name: term } },
            { employee: { employeeCode: term } },
            { employee: { jobTitle: term } },
            { employee: { department: { name: term } } },
          ],
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      caseRef: true,
      caseType: true,
      status: true,
      employee: { select: { name: true, employeeCode: true, jobTitle: true } },
    },
  });
  return rows.map((r) => ({
    caseId: r.id,
    caseRef: r.status === "DRAFT" ? null : r.caseRef,
    caseType: r.caseType,
    status: r.status,
    name: r.employee.name,
    employeeCode: r.employee.employeeCode,
    jobTitle: r.employee.jobTitle,
  }));
}
