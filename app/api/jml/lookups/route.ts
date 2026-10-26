import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { jml, requireAnywhere } from "@/lib/jml/route";
import {
  listContractTypes,
  listEmploymentTypeConfigs,
  listPositionClassifications,
} from "@/lib/jml/config";
import { listJmlHrUsers } from "@/lib/jml/engine/assignment";

/**
 * Read-only option lists for every JML form — open to anyone who may see JML
 * cases. Onboarding's pickers called admin-only routes, so a Junior HR user's
 * dropdowns failed (8.4.2); Offboarding's asset types likewise (F7). Org units
 * are structure, not personnel data; the HR-user list is names and emails of
 * people who hold JML roles.
 */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ actor }) => {
      requireAnywhere(actor, "jml.view");
      const [
        companies,
        directorates,
        departments,
        teams,
        contractTypes,
        employmentTypes,
        hrUsers,
        classifications,
      ] = await Promise.all([
        prisma.orgEntity.findMany({
          select: { id: true, code: true, name: true },
          orderBy: { code: "asc" },
          take: 100,
        }),
        prisma.directorate.findMany({
          select: { id: true, name: true, entityId: true },
          orderBy: { name: "asc" },
          take: 500,
        }),
        prisma.department.findMany({
          select: { id: true, name: true, entityId: true, directorateId: true },
          orderBy: { name: "asc" },
          take: 2000,
        }),
        prisma.team.findMany({
          select: { id: true, name: true, departmentId: true },
          orderBy: { name: "asc" },
          take: 2000,
        }),
        listContractTypes(false),
        listEmploymentTypeConfigs(),
        listJmlHrUsers(),
        listPositionClassifications(false),
      ]);
      return ok({
        companies,
        directorates,
        departments,
        teams,
        contractTypes,
        employmentTypes,
        hrUsers,
        classifications,
      });
    }),
  ),
  { id: "jml-lookups", limit: 120, windowMs: 60_000 },
);
