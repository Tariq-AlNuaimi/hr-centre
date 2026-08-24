import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Reporting-chain resolution — spec §4.2 (hierarchical visibility).
 *
 * "Hierarchical visibility: a manager sees down their entire reporting chain,
 * however deep."
 *
 * The naive implementation walks a level at a time (`where: { managerId: { in:
 * [...] } }` in a loop), which is one round trip per level of the org and grows
 * with the shape of the company rather than with the data actually needed —
 * the N+1 the Scalable pillar forbids. Instead this resolves the whole subtree
 * in ONE recursive CTE and returns just the ids, which callers then feed to an
 * ordinary paginated Prisma query.
 *
 * Raw SQL is used deliberately and within the data rules (docs/rules/prisma.md):
 * a parameterised `$queryRaw` with an explicit column list. Prisma has no
 * first-class recursive-query API, and a recursive CTE is the correct tool for
 * a transitive closure over a self-relation.
 */

/**
 * How far down the tree the walk will go before stopping.
 *
 * This is a safety bound, not a business rule. The import validator rejects
 * manager cycles because it can see the whole proposed graph at once (see
 * lib/pms/import/validate.ts), and a single-row CHECK constraint refuses
 * self-management — but neither can catch a cycle introduced by two separate
 * legitimate-looking edits (A's manager set to B today, B's manager set to A
 * next week). Without a bound, such a cycle turns any chain query into an
 * infinite loop that pins a database connection.
 *
 * 32 is far past any real reporting depth (the spec's own tracks imply about
 * five: C-Level → Director → Manager → Lead → Individual) while keeping a
 * pathological graph cheap to abandon.
 */
export const MAX_ORG_DEPTH = 32;

/**
 * Every employee below `managerEmployeeId`, at any depth. Excludes the manager
 * themselves — §4.2 is about what a manager sees BELOW them; a caller that also
 * wants the actor's own record adds it explicitly, which keeps "my record" and
 * "my chain" from silently merging.
 *
 * Soft-deleted rows are excluded. `prisma.$queryRaw` bypasses the soft-delete
 * extension (it operates on the query API, not raw SQL), so the filter is
 * written out here rather than inherited — a real trap, and the reason the
 * predicate appears in both the anchor and the recursive term.
 *
 * Leavers ARE included: §12.1 preserves their record and history, and a manager
 * must still be able to see a departed report's assessment for the cycle they
 * worked. Filtering by status is the caller's decision, made against
 * `EmployeeStatus`, not baked into visibility.
 */
export async function descendantEmployeeIds(
  managerEmployeeId: string,
  maxDepth: number = MAX_ORG_DEPTH,
): Promise<Set<string>> {
  // `depth` is not user input in any current caller, but it is interpolated
  // into the query as a parameter regardless -- never as string concatenation.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE chain AS (
      SELECT e."id", 1 AS depth
      FROM "employees" e
      WHERE e."managerId" = ${managerEmployeeId}
        AND e."deletedAt" IS NULL

      UNION ALL

      SELECT e."id", c.depth + 1
      FROM "employees" e
      JOIN chain c ON e."managerId" = c."id"
      WHERE e."deletedAt" IS NULL
        AND c.depth < ${maxDepth}
    )
    SELECT DISTINCT "id" FROM chain
  `);

  return new Set(rows.map((r) => r.id));
}

/**
 * The ids an actor is entitled to SEE (§4.2), as a bounded set:
 *   - org-wide actors (HR, executives) get `null`, meaning "no id filter" —
 *     callers must translate that to an unrestricted (but still paginated)
 *     query rather than materialising every id in the company;
 *   - a manager gets their subtree plus themselves;
 *   - everyone else gets exactly themselves.
 *
 * Returning `null` rather than a giant Set is the point: an org-wide list must
 * not pay for a full-table id scan just to build a `WHERE id IN (...)` clause
 * the size of the company.
 */
export async function visibleEmployeeIds(actor: {
  employeeId: string | null;
  orgWide: boolean;
}): Promise<Set<string> | null> {
  if (actor.orgWide) return null;
  if (!actor.employeeId) return new Set();

  const ids = await descendantEmployeeIds(actor.employeeId);
  ids.add(actor.employeeId);
  return ids;
}

/**
 * Whether this employee has any direct report — the sole source of line-manager
 * authority (ADR-065). A `findFirst` with `select: { id: true }`, not a count:
 * the question is existence, and the answer stops at the first row.
 */
export async function hasDirectReports(employeeId: string): Promise<boolean> {
  const report = await prisma.employee.findFirst({
    where: { managerId: employeeId },
    select: { id: true },
  });
  return report !== null;
}

/**
 * The upward chain: an employee's manager, their manager's manager, and so on
 * to the top. Ordered nearest-first.
 *
 * §5.5's escalation ladder needs the skip-level manager ("escalate to the
 * manager's manager, who has authority to compel action"), and §12.1 needs the
 * roll-up target when a manager departs ("Direct reports auto-roll-up one level
 * to the departed manager's own manager"). Both are answered by walking up, so
 * the walk lives here next to its downward twin rather than being reinvented in
 * Phase 2.
 *
 * Depth-capped for the same reason as the downward walk.
 */
export async function managerChain(
  employeeId: string,
  maxDepth: number = MAX_ORG_DEPTH,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; depth: number }>>(Prisma.sql`
    WITH RECURSIVE chain AS (
      SELECT m."id", m."managerId", 1 AS depth
      FROM "employees" e
      JOIN "employees" m ON m."id" = e."managerId"
      WHERE e."id" = ${employeeId}
        AND m."deletedAt" IS NULL

      UNION ALL

      SELECT m."id", m."managerId", c.depth + 1
      FROM chain c
      JOIN "employees" m ON m."id" = c."managerId"
      WHERE m."deletedAt" IS NULL
        AND c.depth < ${maxDepth}
    )
    SELECT "id", depth FROM chain ORDER BY depth ASC
  `);

  return rows.map((r) => r.id);
}
