import { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { paginatedResponse, parsePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import {
  GOAL_SETTING_STAGE,
  kpiSetAccessRefusal,
  weightageMessage,
  weightageTotal,
} from "@/lib/pms/kpi";
import { isGoalSettingExempt, stageState, type StageWindow } from "@/lib/pms/cycle";
import { visibleEmployeeIds } from "@/lib/pms/org-tree";

/**
 * The goal-setting roster — spec §5.1 (who is where in the flow), §4.2 (which
 * rows this actor may see) and §4.5 (which columns anyone may see).
 *
 * This is the screen a manager works from during December and the screen HR
 * watches the whole org through, so three things are true of it by design:
 *
 *   PAGINATED — it is org-sized for HR. `parsePagination` bounds every read;
 *               there is no "just fetch them all" path.
 *   SCOPED    — HR and executives see every participant; a line manager sees
 *               their own chain plus themselves; anyone else sees only their own
 *               row. One recursive walk (lib/pms/org-tree.ts), not one query per
 *               level, and org-wide actors do not pay for the walk at all.
 *   SALARY-FREE — the employee columns are enumerated explicitly, in the shape
 *               of ORG_TREE_NODE_SELECT. `include: { employee: true }` would put
 *               `basicSalary` (Restricted, §4.5 / SECURITY.md §1) into the
 *               payload of a screen line managers live in. The column is not
 *               hidden here; it is never selected.
 *
 * Each row carries what a drafting screen needs to render a status without a
 * follow-up request per participant: the KPI count, the exact weightage total
 * (§5.3), both signatures (§5.1), HR's approval instant (the lock), whether the
 * employee is goal-setting exempt (§8.3), and why — if at all — THIS actor
 * cannot edit this set right now.
 */

// Search is a boundary input, so it is parsed rather than trusted. Inline
// because it belongs to this one endpoint; the shared KPI/cycle schemas live in
// lib/validations/.
const participantQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  /**
   * §4.4's "My Tasks" filter: the participants whose goal-setting is assigned to
   * ME — my own set, plus my direct reports'. Deliberately not a role filter;
   * §4.4 is explicit that the personal action space is "driven by assignment,
   * not hierarchy or role name", so an HR Super Admin who also manages a team
   * gets exactly their own five rows here, not the whole org.
   *
   * It NARROWS the visibility set computed above; it never widens it.
   */
  scope: z.enum(["mine"]).optional(),
});

/**
 * The employee columns a roster row needs. Deliberately narrow and deliberately
 * enumerated — same discipline as ORG_TREE_NODE_SELECT, and for the same reason:
 * a `select` that lists its columns cannot acquire a Restricted one by accident.
 */
const ROSTER_EMPLOYEE_SELECT = {
  id: true,
  name: true,
  email: true,
  roleTrack: true,
  status: true,
  managerId: true,
  department: { select: { id: true, name: true } },
  entity: { select: { id: true, code: true } },
} satisfies Prisma.EmployeeSelect;

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id: cycleId } = await params;
    const actor = await resolveActor(session);
    const now = new Date();

    const { searchParams } = request.nextUrl;
    const pagination = parsePagination(searchParams);
    const parsedQuery = participantQuerySchema.safeParse({
      search: searchParams.get("search") ?? undefined,
      scope: searchParams.get("scope") ?? undefined,
    });
    if (!parsedQuery.success) {
      return err(parsedQuery.error.issues.map((i) => i.message).join(", "));
    }
    const { search, scope } = parsedQuery.data;

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: {
        id: true,
        year: true,
        status: true,
        stages: {
          where: { kind: GOAL_SETTING_STAGE },
          select: { kind: true, opensAt: true, deadline: true, graceDays: true },
        },
      },
    });
    if (!cycle) return notFound("Cycle");

    // §5.4's lock is a property of the stage, so it is resolved once for the page
    // rather than per row. A cycle with no goal-setting stage configured yet is a
    // legitimate DRAFT state, not an error — the roster renders with every row
    // blocked instead of 500ing.
    const stage: StageWindow | null = cycle.stages[0] ?? null;

    // §4.2 — `null` means org-wide (no id filter), which is why HR never pays for
    // the recursive walk.
    const visibleIds = await visibleEmployeeIds({
      employeeId: actor.employeeId,
      orgWide: actor.capabilities.orgWide,
    });

    // An authenticated user with no employee record and no org-wide role is in
    // none of the roster. An empty page, not a 403: the cycle exists and they are
    // simply not in it.
    if (visibleIds !== null && visibleIds.size === 0) {
      return ok({
        ...paginatedResponse([], 0, pagination),
        cycle: { id: cycle.id, year: cycle.year, status: cycle.status },
        stage: stage ? { ...stage, state: stageState(stage, now) } : null,
      });
    }

    // §4.4 — "My Tasks (personal action space): everything assigned to me to do…
    // Driven by assignment, not hierarchy or role name."
    //
    // Without this the home screen has to fetch a page of the whole org and
    // filter client-side, which is exact at 37 people and silently wrong at 500:
    // the viewer's own row falls off page 2 and their task list quietly loses
    // entries. `scope=mine` is the assignment filter §4.4 describes — my own set,
    // plus the sets I owe a manager's action on.
    const assignedTo = scope === "mine" && actor.employeeId ? actor.employeeId : null;

    const where: Prisma.CycleParticipantWhereInput = {
      cycleId,
      ...(visibleIds !== null ? { employeeId: { in: [...visibleIds] } } : {}),
      ...(assignedTo
        ? { OR: [{ employeeId: assignedTo }, { employee: { managerId: assignedTo } }] }
        : {}),
      ...(search
        ? {
            employee: {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.cycleParticipant.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { employee: { name: "asc" } },
        select: {
          id: true,
          goalsApprovedAt: true,
          employee: { select: ROSTER_EMPLOYEE_SELECT },
          // Domain-bounded child sets, fetched in the SAME query rather than one
          // aggregate per row (Scalable: no N+1). A KPI set is a handful of rows
          // by §5.3's own arithmetic — 100% cannot be divided many ways — and a
          // participant has at most two signatures by construction (§5.1's two
          // parties, `@@unique([participantId, party])`).
          //
          // `deletedAt: null` is written out: the soft-delete extension filters
          // TOP-LEVEL `where` only (see lib/prisma/soft-delete-extension.ts), and
          // `Kpi` is not in its model set at all, so nothing filters this for us.
          kpis: {
            where: { deletedAt: null },
            select: { weightage: true },
          },
          signOffs: { select: { party: true, signedAt: true } },
        },
      }),
      prisma.cycleParticipant.count({ where }),
    ]);

    const data = rows.map((row) => {
      const employeeSigned = row.signOffs.find((s) => s.party === "EMPLOYEE") ?? null;
      const managerSigned = row.signOffs.find((s) => s.party === "MANAGER") ?? null;
      const exempt = isGoalSettingExempt(row.employee.roleTrack);
      // One call: `weightageMessage` is null exactly when the set is signable
      // (non-empty and totalling exactly 100), which is what "complete" means.
      const message = weightageMessage(row.kpis);

      // Why this actor cannot edit this row right now — through the SAME
      // function `POST /api/kpis` and the drafting page use, so the screen can
      // disable the affordance and explain it in one breath, and a user who
      // defeats the disabled button gets the identical sentence from the write
      // route.
      //
      // This was a third hand-rolled copy of that chain until the post-push
      // breadth review found it (2026-08-25). The strings matched, so nothing
      // was broken yet — but Phase 2 had already paid once to collapse two
      // copies into `kpiSetAccessRefusal` precisely because the next edit to the
      // ordering or the wording has no compiler forcing a duplicate to move
      // with it.
      //
      // `visible: true` is not an assumption: this row exists only because it
      // passed the visibility filter that built the query above.
      const editBlockedReason =
        kpiSetAccessRefusal({
          actor,
          visible: true,
          employee: {
            id: row.employee.id,
            managerId: row.employee.managerId,
            roleTrack: row.employee.roleTrack,
          },
          cycleStatus: cycle.status,
          stage,
          goalsApprovedAt: row.goalsApprovedAt,
          now,
        })?.reason ?? null;

      return {
        participantId: row.id,
        employee: row.employee,
        kpiCount: row.kpis.length,
        // Decimal as a STRING: §5.3 compares against exactly 100, and a JSON
        // number is a float the moment it is parsed.
        weightageTotal: weightageTotal(row.kpis).toString(),
        weightageComplete: message === null,
        weightageMessage: message,
        signOff: {
          employeeSignedAt: employeeSigned?.signedAt ?? null,
          managerSignedAt: managerSigned?.signedAt ?? null,
          bothSigned: employeeSigned !== null && managerSigned !== null,
        },
        goalsApprovedAt: row.goalsApprovedAt,
        goalSettingExempt: exempt,
        editBlockedReason,
      };
    });

    return ok({
      ...paginatedResponse(data, total, pagination),
      cycle: { id: cycle.id, year: cycle.year, status: cycle.status },
      stage: stage ? { ...stage, state: stageState(stage, now) } : null,
    });
  }),
  { id: "pms-cycle-participants", limit: 120, windowMs: 60_000 },
);
