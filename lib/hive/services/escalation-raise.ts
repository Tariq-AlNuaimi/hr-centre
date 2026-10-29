import { prisma } from "@/lib/prisma";
import { isPlaceholderEmail } from "@/lib/people/provisional-id";
import type { RaiseForEmployeeInput } from "@/lib/validations/hive/escalation";
import { createEscalation, type CreatedEscalation } from "./escalation";

/**
 * HR raises a ticket on an employee's behalf (overnight item 2, UX R10 "Raise
 * ticket on behalf").
 *
 * The caller holds Draft on at least one pair (checked by the route). The
 * ticket is the employee's: name, email and placement come from their record,
 * it routes through the same rules as a Siraaj ticket (company, then
 * directorate/department), and it lands OPEN like every other — approval and
 * the self-approval rule are untouched. What differs is the record of how it
 * started: source HR, `raisedById`, and a history line "Raised by HR for …".
 *
 * @public
 */

export type RaiseOutcome =
  | { ok: true; ticket: CreatedEscalation }
  | { ok: false; status: 404 | 409 | 422 | 429 | 503; error: string };

/** Employees a ticket can be raised for: on file, not a leaver, with a real email. */
const RAISABLE = { deletedAt: null, status: { not: "LEAVER" as const } };

export async function raiseTicketForEmployee(
  actor: { userId: string; name: string | null },
  input: RaiseForEmployeeInput,
): Promise<RaiseOutcome> {
  const employee = await prisma.employee.findFirst({
    where: { id: input.employeeId, ...RAISABLE },
    select: {
      id: true,
      name: true,
      email: true,
      entityId: true,
      entity: { select: { name: true } },
      departmentId: true,
      department: {
        select: { name: true, directorateId: true, directorate: { select: { name: true } } },
      },
    },
  });
  if (!employee) return { ok: false, status: 404, error: "Employee not found." };
  if (isPlaceholderEmail(employee.email)) {
    return {
      ok: false,
      status: 422,
      error: "This person has no work email on file yet, so HR's answer could not reach them.",
    };
  }

  const result = await createEscalation(
    {
      employeeName: employee.name,
      employeeEmail: employee.email.trim().toLowerCase(),
      question: input.question,
      directorate: employee.department?.directorate?.name ?? employee.department?.name,
      company: employee.entity.name,
    },
    {
      sessionId: null,
      source: "HR",
      // HR picked the employee's own record: the address is theirs, not a claim.
      identityVerified: true,
      companyId: employee.entityId,
      orgUnitId: employee.department?.directorateId ?? employee.departmentId,
      raisedBy: {
        userId: actor.userId,
        employeeId: employee.id,
        note: `Raised by HR (${actor.name ?? "an HR user"}) for ${employee.name}.`,
      },
    },
  );
  if ("error" in result) {
    return result.error === "rate_limited"
      ? {
          ok: false,
          status: 429,
          error: "This person already has three tickets raised in the last hour. Try again later.",
        }
      : { ok: false, status: 503, error: "No HR pair is set up to receive tickets yet." };
  }
  if (result.duplicate) {
    return {
      ok: false,
      status: 409,
      error: "The same question was raised for this person in the last 30 minutes.",
    };
  }
  return { ok: true, ticket: result };
}

/** The raise form's employee picker: name, email and company only — bounded. */
export async function searchTicketEmployees(params: { search?: string; id?: string }) {
  const rows = await prisma.employee.findMany({
    where: {
      ...RAISABLE,
      ...(params.id ? { id: params.id } : {}),
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: "insensitive" as const } },
              { email: { contains: params.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, email: true, entity: { select: { name: true } } },
    orderBy: { name: "asc" },
    take: 20,
  });
  return rows
    .filter((r) => !isPlaceholderEmail(r.email))
    .map((r) => ({ id: r.id, name: r.name, email: r.email, company: r.entity.name }));
}
