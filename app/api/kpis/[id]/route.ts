import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor, type ResolvedActor } from "@/lib/pms/actor";
import { isGoalSettingExempt, type StageWindow } from "@/lib/pms/cycle";
import {
  GOAL_SETTING_STAGE,
  kpiEditBlockedReason,
  weightageMessage,
  weightageTotal,
} from "@/lib/pms/kpi";
import {
  EDITABLE_KPI_FIELDS,
  KPI_SELECT,
  serializeKpi,
  weightageSummary,
} from "@/lib/pms/kpi-select";
import { descendantEmployeeIds } from "@/lib/pms/org-tree";
import { canViewEmployee } from "@/lib/pms/permissions";
import { updateKpiSchema } from "@/lib/validations/kpi";

/**
 * One KPI — amend it (§5.2) or withdraw it, while the window is open (§5.4) and
 * before HR's approval locks the baseline (§5.1).
 *
 * PUT and DELETE run the IDENTICAL gate, because they are the same act as far as
 * §5.1 is concerned: both change the agreed set. The gate is
 * `kpiEditBlockedReason` (lib/pms/kpi.ts) and its sentence is returned verbatim
 * with a **409**, so an operator reading a failed request sees the same wording
 * the drafting screen showed them.
 */

/**
 * Load the KPI and answer "may this actor change it right now?" in one place, so
 * PUT and DELETE cannot drift apart.
 *
 * Returns either the KPI (with the participant context the caller needs) or the
 * response to send instead. Every refusal path is represented:
 *   - missing / soft-deleted / invisible → 404 (no existence oracle, §4.2)
 *   - C-Level participant                → 409 (§8.3)
 *   - cycle not running                  → 409 (§2)
 *   - no goal-setting stage              → 409 (§2)
 *   - §4.2 / §5.4 / §5.1                 → 409, verbatim from kpiEditBlockedReason
 */
async function loadEditableKpi(kpiId: string, actor: ResolvedActor, now: Date) {
  // `findFirst` with an explicit `deletedAt: null`, NOT `findUnique`: `Kpi` is
  // absent from SOFT_DELETE_MODELS in lib/prisma/soft-delete-extension.ts, so
  // nothing filters withdrawn rows for us even though the columns exist.
  const kpi = await prisma.kpi.findFirst({
    where: { id: kpiId, deletedAt: null },
    select: {
      ...KPI_SELECT,
      participant: {
        select: {
          id: true,
          goalsApprovedAt: true,
          // Enumerated columns only — `include: { employee: true }` would carry
          // `basicSalary` (Restricted, §4.5) into a drafting response.
          employee: { select: { id: true, managerId: true, roleTrack: true } },
          cycle: {
            select: {
              id: true,
              status: true,
              stages: {
                where: { kind: GOAL_SETTING_STAGE },
                select: { kind: true, opensAt: true, deadline: true, graceDays: true },
              },
            },
          },
        },
      },
    },
  });
  if (!kpi) return { ok: false as const, response: notFound("KPI") };

  const { participant } = kpi;

  const descendants = actor.capabilities.orgWide
    ? new Set<string>()
    : actor.employeeId
      ? await descendantEmployeeIds(actor.employeeId)
      : new Set<string>();
  if (!canViewEmployee(actor, participant.employee.id, descendants)) {
    return { ok: false as const, response: notFound("KPI") };
  }

  if (isGoalSettingExempt(participant.employee.roleTrack)) {
    return {
      ok: false as const,
      response: err(
        "C-Level employees skip goal-setting entirely (§8.3) — this participant has no KPI set " +
          "to amend.",
        409,
      ),
    };
  }

  if (participant.cycle.status !== "OPEN") {
    return {
      ok: false as const,
      response: err(
        `KPIs are edited while the cycle is open — this cycle is ${participant.cycle.status} (§2).`,
        409,
      ),
    };
  }

  const stage: StageWindow | null = participant.cycle.stages[0] ?? null;
  if (stage === null) {
    return {
      ok: false as const,
      response: err("This cycle has no goal-setting stage configured yet (§2).", 409),
    };
  }

  const blocked = kpiEditBlockedReason({
    actor,
    target: { id: participant.employee.id, managerId: participant.employee.managerId },
    stage,
    now,
    goalsApprovedAt: participant.goalsApprovedAt,
  });
  if (blocked) return { ok: false as const, response: err(blocked, 409) };

  return { ok: true as const, kpi, participantId: participant.id };
}

export const PUT = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = updateKpiSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const input = parsed.data;

    // Which fields the caller ACTUALLY sent, read off the raw body rather than
    // the parsed result. `updateKpiSchema` cannot answer this: `orderIndex`
    // carries `.default(0)`, a default survives `.partial()`, and so every parse
    // — including of `{}` — comes back carrying an orderIndex the caller never
    // wrote. Trusting the parsed object would (a) make the schema's "Nothing to
    // update" guard unreachable and (b) silently reset a KPI to position 0 every
    // time someone edited only its description. Pinned in
    // tests/contracts/pms-kpi.test.ts; the durable fix is in lib/validations/kpi.ts.
    const sent = new Set(Object.keys(body as Record<string, unknown>));
    const provided = EDITABLE_KPI_FIELDS.filter((field) => sent.has(field));
    if (provided.length === 0) {
      return err(`Nothing to update. Send at least one of: ${EDITABLE_KPI_FIELDS.join(", ")}.`);
    }
    const only = <K extends (typeof EDITABLE_KPI_FIELDS)[number]>(field: K) =>
      sent.has(field) ? input[field] : undefined;

    const loaded = await loadEditableKpi(id, actor, new Date());
    if (!loaded.ok) return loaded.response;

    // A partial update: only the fields the caller sent are written, so a screen
    // that edits one descriptor does not have to round-trip the other five.
    // Prisma treats `undefined` as "leave this column alone".
    const updated = await prisma.kpi.update({
      where: { id },
      data: {
        description: only("description"),
        weightage: only("weightage"),
        descriptorOutstanding: only("descriptorOutstanding"),
        descriptorExcellent: only("descriptorExcellent"),
        descriptorTarget: only("descriptorTarget"),
        descriptorAlmostAchieved: only("descriptorAlmostAchieved"),
        descriptorUnsatisfactory: only("descriptorUnsatisfactory"),
        orderIndex: only("orderIndex"),
      },
      select: KPI_SELECT,
    });

    return ok({ kpi: serializeKpi(updated), set: await weightageSummary(loaded.participantId) });
  }),
  { id: "pms-kpi-write", limit: 60, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(async (_request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);

    const loaded = await loadEditableKpi(id, actor, new Date());
    if (!loaded.ok) return loaded.response;

    // SOFT delete, written by hand.
    //
    // `prisma.kpi.delete()` would be a HARD delete here: the soft-delete
    // extension rewrites `delete` only for the models in its SOFT_DELETE_MODELS
    // set (User, Employee, Department, OrgEntity), and `Kpi` is not one of them
    // despite carrying `deletedAt` / `deletedBy`. Setting the columns through
    // `update` keeps the row — §5.1's baseline and Phase 3's change history both
    // need to be able to see what a manager withdrew mid-draft — and the audit
    // extension records the write with before/after either way.
    await prisma.kpi.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: session.user.id },
      select: { id: true },
    });

    return ok({
      id,
      participantId: loaded.participantId,
      deleted: true,
      set: await weightageSummary(loaded.participantId),
    });
  }),
  { id: "pms-kpi-write", limit: 60, windowMs: 60_000 },
);
