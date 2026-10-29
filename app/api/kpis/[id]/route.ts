import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor, type ResolvedActor } from "@/lib/core/actor";
import { isGoalSettingExempt, type StageWindow } from "@/lib/pms/cycle";
import { GOAL_SETTING_STAGE, kpiEditBlockedReason } from "@/lib/pms/kpi";
import { periodAuthorityBlockedReason } from "@/lib/pms/transfer";
import {
  EDITABLE_KPI_FIELDS,
  KPI_SELECT,
  serializeKpi,
  weightageSummary,
} from "@/lib/pms/kpi-select";
import { visibilityDescendants } from "@/lib/pms/org-tree";
import { canViewEmployee, isHr } from "@/lib/core/permissions";
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
  // `findFirst` with an explicit `deletedAt: null`. `Kpi` IS registered in
  // SOFT_DELETE_MODELS now, so the extension would filter this read anyway —
  // the filter stays explicit because that extension documents (and asserts)
  // that it rewrites the TOP-LEVEL `where` only, and the KPI reads that matter
  // for §5.3's total pull `participant.kpis` through a nested select, which it
  // cannot reach. One convention for every KPI read beats two.
  const kpi = await prisma.kpi.findFirst({
    where: { id: kpiId, deletedAt: null },
    select: {
      ...KPI_SELECT,
      // §12.3 — which portion of a split year this KPI belongs to, and who owned
      // that portion. Null for everyone who never transferred.
      assignmentPeriod: { select: { orderIndex: true, managerEmployeeId: true } },
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

  const descendants = await visibilityDescendants(actor);
  if (!canViewEmployee(actor, participant.employee.id, descendants)) {
    return { ok: false as const, response: notFound("KPI") };
  }

  if (isGoalSettingExempt(participant.employee.roleTrack)) {
    return {
      ok: false as const,
      response: err(
        "C-Level employees skip goal-setting entirely — this participant has no KPI set " +
          "to amend.",
        409,
      ),
    };
  }

  if (participant.cycle.status !== "OPEN") {
    return {
      ok: false as const,
      response: err(
        `KPIs are edited while the cycle is open — this cycle is ${participant.cycle.status}.`,
        409,
      ),
    };
  }

  const stage: StageWindow | null = participant.cycle.stages[0] ?? null;
  if (stage === null) {
    return {
      ok: false as const,
      response: err("This cycle has no goal-setting stage configured yet.", 409),
    };
  }

  const blocked = kpiEditBlockedReason({
    actor,
    target: { id: participant.employee.id, managerId: participant.employee.managerId },
    stage,
    now,
    goalsApprovedAt: participant.goalsApprovedAt,
  });
  // §12.3 — on a split year the LIVE manager check above is the wrong question:
  // after a transfer it names the new manager, who never set the old period's
  // KPIs, and denies the old one, who is the only person who can honestly
  // assess the half they supervised. The period's own manager overrides it.
  if (kpi.assignmentPeriod) {
    const periodBlocked = periodAuthorityBlockedReason({
      actorEmployeeId: actor.employeeId,
      actorIsHr: isHr(actor),
      period: kpi.assignmentPeriod,
    });
    if (periodBlocked) return { ok: false as const, response: err(periodBlocked, 409) };
    // The stage lock (§5.4) and HR's approval lock (§5.1) still apply — only the
    // §4.2 authority sentence is replaced.
    if (blocked && !blocked.includes("§4.2")) {
      return { ok: false as const, response: err(blocked, 409) };
    }
    return { ok: true as const, kpi, participantId: participant.id };
  }
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

    // Soft delete. `Kpi` is registered in SOFT_DELETE_MODELS, so `delete()` is
    // rewritten into a `deletedAt` write and the row survives — §5.1's baseline
    // and Phase 3's change history both need to see what a manager withdrew
    // mid-draft.
    //
    // Written as `delete()` rather than a hand-rolled `update`, which is what
    // this was before the model was registered: the audit extension records the
    // action as **DELETE** through this path, and as a plain UPDATE through the
    // manual one. It infers a soft delete by comparing `deletedAt` across the
    // before/after images, and a narrow `select` (this route's KPI_SELECT does
    // not carry `deletedAt`) hides it. Verified against PostgreSQL: this path
    // logs `DELETE`, the hand-rolled one logged `UPDATE`, and both keep the row.
    await prisma.kpi.delete({ where: { id } });

    return ok({
      id,
      participantId: loaded.participantId,
      deleted: true,
      set: await weightageSummary(loaded.participantId),
    });
  }),
  { id: "pms-kpi-write", limit: 60, windowMs: 60_000 },
);
