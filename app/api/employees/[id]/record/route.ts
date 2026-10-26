import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { employeeDetailSelect, serializeEmployeeDetail } from "@/lib/pms/employee-select";
import { actorCan, canViewEmployee } from "@/lib/pms/permissions";
import { placementOf } from "@/lib/rbac/resolve";
import { visibilityDescendants } from "@/lib/pms/org-tree";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { recordFieldsTouched } from "@/lib/people/record";
import { updateEmployeeRecord } from "@/lib/people/service";
import { employeeRecordSchema, recordFromBody } from "@/lib/validations/people";

/**
 * HR Centre F-b — edit the employee record's details (job & contract, contact,
 * personal, ID documents). PARTIAL on purpose, unlike the core PUT: a key not
 * sent is left alone, so an HR officer without `people.viewIdDocuments` editing
 * a job title can never blank an ID number they cannot see.
 */
export const PATCH = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);

    // Out-of-scope reads as absent (no existence leak) before any 403.
    const descendants = await visibilityDescendants(actor);
    if (!canViewEmployee(actor, id, descendants)) return notFound("Employee");
    const subject = await placementOf(id);
    if (!subject) return notFound("Employee");
    if (!actorCan(actor, "people.edit", subject)) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = employeeRecordSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const record = recordFromBody(parsed.data);
    const touched = recordFieldsTouched(record);
    if (touched.personal && !actorCan(actor, "people.viewPersonal", subject)) return forbidden();
    if (touched.idDocuments && !actorCan(actor, "people.viewIdDocuments", subject)) {
      return forbidden();
    }

    try {
      await updateEmployeeRecord(id, record);
    } catch (e) {
      return ruleErrorResponse(e);
    }

    const employee = await prisma.employee.findUnique({
      where: { id },
      select: employeeDetailSelect(actor, subject),
    });
    if (!employee) return notFound("Employee");
    return ok(serializeEmployeeDetail(employee));
  }),
  { id: "pms-employee-write", limit: 30, windowMs: 60_000 },
);
