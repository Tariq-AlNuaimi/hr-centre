import { prisma } from "@/lib/prisma";
import { proposeRaters, templateTypeFor, type RaterCandidate } from "./three-sixty";

/**
 * §9.6's generation half — turning the relationship map into assignments.
 *
 * Split out of `app/api/three-sixty/assignments/route.ts` when that route
 * crossed the complexity budget. The seam is by cohesion rather than by line
 * count: everything here answers "who assesses whom, and on which form", and
 * none of it decides authority, state or the response shape — those stay in the
 * route.
 */

/**
 * §9.6 — "Projects (optional): ability to create projects and link employees,
 * so peers can be drawn from shared project work."
 *
 * Returns, per employee, everyone they shared a project with in this cycle.
 * Symmetric by construction: if A and B are on one project, each appears in the
 * other's set.
 *
 * This is what lets a one-person department reach §9.4's three raters at all.
 * Without it the peer pool is the department, and a department of one has no
 * peers — the shortfall would be structural rather than an oversight HR could
 * fix, which is precisely why the clause offers projects.
 *
 * Empty for a fork that never uses projects, which is the common case: "not
 * applicable to everyone", as the clause says.
 */
export async function projectPeers(cycleId: string): Promise<Map<string, Set<string>>> {
  const projects = await prisma.project.findMany({
    where: { cycleId },
    take: 500,
    select: { id: true, members: { select: { employeeId: true }, take: 200 } },
  });
  const out = new Map<string, Set<string>>();
  for (const project of projects) {
    const ids = project.members.map((m) => m.employeeId);
    for (const id of ids) {
      const set = out.get(id) ?? new Set<string>();
      for (const other of ids) if (other !== id) set.add(other);
      out.set(id, set);
    }
  }
  return out;
}

/**
 * §9.4's peer pool for one ratee: their own department, plus anyone who shared a
 * project with them (§9.6). Both mean "someone they worked with".
 *
 * The line manager is excluded — they are already the mandatory first rater and
 * would otherwise take the peer slot as well, leaving the ratee assessed twice
 * by the same person.
 */
export function peerPoolFor(params: {
  ratee: RaterCandidate;
  people: readonly RaterCandidate[];
  projectPeersByEmployee: ReadonlyMap<string, Set<string>>;
}): RaterCandidate[] {
  const { ratee, people, projectPeersByEmployee } = params;
  const shared = projectPeersByEmployee.get(ratee.id);
  return people.filter(
    (p) =>
      p.id !== ratee.id &&
      p.id !== ratee.managerId &&
      ((p.departmentId !== null && p.departmentId === ratee.departmentId) ||
        (shared?.has(p.id) ?? false)),
  );
}

export type PlannedAssignment = { rateeId: string; raterId: string; templateId: string };

/**
 * The whole plan, computed before anything is written.
 *
 * Planning first and writing after keeps the route's loop trivial and makes the
 * mapping testable without a database — but it is also the honest shape: §9.6
 * describes generating a MAPPING, and the writes are how it is stored, not what
 * it is.
 *
 * A rater whose relationship yields no template (§9.2 decides from the
 * direction) is dropped rather than guessed at, and the resulting gap shows up
 * in the shortfall — §9.4's count is checked at activation, so an unfillable
 * slot surfaces there rather than being padded here.
 */
export function planAssignments(params: {
  rateable: readonly RaterCandidate[];
  people: readonly RaterCandidate[];
  byId: ReadonlyMap<string, RaterCandidate>;
  templateByType: ReadonlyMap<string, string>;
  projectPeersByEmployee: ReadonlyMap<string, Set<string>>;
}): { planned: PlannedAssignment[]; shortfalls: { rateeId: string; missing: number }[] } {
  const { rateable, people, byId, templateByType, projectPeersByEmployee } = params;
  const planned: PlannedAssignment[] = [];
  const shortfalls: { rateeId: string; missing: number }[] = [];

  for (const ratee of rateable) {
    const lineManager = ratee.managerId ? (byId.get(ratee.managerId) ?? null) : null;
    const reports = people.filter((p) => p.managerId === ratee.id);
    const peerPool = peerPoolFor({ ratee, people, projectPeersByEmployee });

    const { raterIds, shortfall } = proposeRaters({ ratee, lineManager, reports, peerPool });
    if (shortfall > 0) shortfalls.push({ rateeId: ratee.id, missing: shortfall });

    for (const raterId of raterIds) {
      const rater = byId.get(raterId);
      if (!rater) continue;
      const type = templateTypeFor({ rater, ratee });
      if (type === null) continue;
      const templateId = templateByType.get(type);
      if (!templateId) continue;
      planned.push({ rateeId: ratee.id, raterId, templateId });
    }
  }

  return { planned, shortfalls };
}
