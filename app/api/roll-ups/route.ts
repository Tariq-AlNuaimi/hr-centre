import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/pms/actor";
import { isHr } from "@/lib/pms/permissions";
import { ROLL_UP_PROMPT_KEY, canResolveRollUp, resolveBlockedReason } from "@/lib/pms/roll-up";
import { resolveRollUpSchema } from "@/lib/validations/edge-cases";

/**
 * §12.2 — "HR gets a visible prompt for temporary roll-ups ('reports temporarily
 * rolled up — needs a permanent manager') so they don't silently persist."
 *
 * GET is the prompt; POST is HR answering it.
 *
 * ## Why the prompt is a queue rather than a banner
 *
 * "So they don't silently persist" is a requirement about TIME, not about a
 * single moment. A toast shown once at the departure would satisfy the letter
 * and miss the point entirely: the failure mode is a roll-up that is still in
 * place eleven months later, when the temporary manager signs off on people they
 * never drafted for. An open row that never goes away until someone decides is
 * the only shape that survives that.
 *
 * ## Resolving does not touch signatures
 *
 * §12.2 — "The new manager inherits existing signed KPIs and picks up from
 * wherever things stand — no re-drafting of the baseline. Already-signed work
 * stays locked and valid." So this route changes `Employee.managerId` and closes
 * the prompt, and touches nothing else. `managerChangeInvalidatesSignatures()`
 * states that as a testable claim.
 */

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!isHr(actor)) return err("Roll-up prompts are HR's to clear (§12.2).", 403);

    const includeResolved = new URL(request.url).searchParams.get("includeResolved") === "1";

    const rows = await prisma.managerRollUp.findMany({
      where: includeResolved ? {} : { resolvedAt: null },
      take: 500,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        reason: true,
        createdAt: true,
        resolvedAt: true,
        resolutionNote: true,
        employee: {
          select: {
            id: true,
            name: true,
            odooId: true,
            department: { select: { name: true } },
          },
        },
        fromManagerEmployee: { select: { id: true, name: true } },
        toManagerEmployee: { select: { id: true, name: true } },
        resolvedByEmployee: { select: { name: true } },
      },
    });

    return ok({
      // §12.2's own words, as a key the UI renders — a paraphrase of a prompt
      // the spec quotes is a different prompt.
      promptKey: ROLL_UP_PROMPT_KEY,
      rollUps: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        createdAt: r.createdAt,
        // How long this has been sitting there, which is the fact that makes a
        // queue actionable rather than decorative.
        openDays: r.resolvedAt
          ? null
          : Math.floor((Date.now() - r.createdAt.getTime()) / 86_400_000),
        resolvedAt: r.resolvedAt,
        resolvedBy: r.resolvedByEmployee?.name ?? null,
        resolutionNote: r.resolutionNote,
        employeeId: r.employee.id,
        employeeName: r.employee.name,
        employeeNumber: r.employee.odooId,
        department: r.employee.department?.name ?? null,
        fromManager: r.fromManagerEmployee
          ? { id: r.fromManagerEmployee.id, name: r.fromManagerEmployee.name }
          : null,
        // Null means the roll-up found nobody above the departed manager — the
        // employee is temporarily unmanaged, which is the most urgent case here.
        toManager: r.toManagerEmployee
          ? { id: r.toManagerEmployee.id, name: r.toManagerEmployee.name }
          : null,
      })),
      openCount: rows.filter((r) => r.resolvedAt === null).length,
    });
  }),
  { id: "pms-rollup-read", limit: 60, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const by = actor.employeeId;
    if (!by) return err("This account has no linked employee record (ADR-065).", 403);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = resolveRollUpSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { rollUpId, newManagerEmployeeId, resolutionNote } = parsed.data;

    // Authority BEFORE the read. Checking it after `findUnique` would answer
    // 404-vs-403 to a non-HR caller, turning this route into an oracle for which
    // roll-up ids exist — the same reasoning §4.2 applies to employee records.
    if (!canResolveRollUp(actor)) {
      return err("Only HR reassigns a permanent manager (§12.2).", 403);
    }

    const rollUp = await prisma.managerRollUp.findUnique({
      where: { id: rollUpId },
      select: {
        id: true,
        resolvedAt: true,
        employeeId: true,
        toManagerEmployeeId: true,
        employee: { select: { managerId: true } },
      },
    });
    if (!rollUp) return notFound("Roll-up");

    // `undefined` means "confirm the current arrangement"; an explicit null would
    // mean "no manager", which is not something HR should be able to choose here
    // — the schema allows null so the two are distinguishable, and this line
    // resolves the confirm case to the target the roll-up already applied.
    const nextManagerId =
      newManagerEmployeeId === undefined ? rollUp.toManagerEmployeeId : newManagerEmployeeId;

    const blocked = resolveBlockedReason({
      actor,
      rollUp: { resolvedAt: rollUp.resolvedAt, toManagerEmployeeId: rollUp.toManagerEmployeeId },
      newManagerEmployeeId: nextManagerId,
      subjectEmployeeId: rollUp.employeeId,
    });
    if (blocked) return err(blocked.reason, blocked.status);

    if (nextManagerId !== null) {
      const manager = await prisma.employee.findUnique({
        where: { id: nextManagerId },
        select: { id: true, status: true },
      });
      if (!manager) return notFound("Manager");
      // Naming a leaver as the permanent manager would recreate the exact gap
      // §12.1's roll-up just closed.
      if (manager.status === "LEAVER") {
        return err("A leaver cannot be named as the permanent manager (§12.1).", 409);
      }
    }

    const now = new Date();
    // `resolvedAt` was read OUTSIDE this transaction, so it is a snapshot. The
    // claim below is what makes the decision safe: two HR users resolving the
    // same prompt (or one double-click, or a retried request) both pass
    // `resolveBlockedReason`, and without a predicate both `update`s commit —
    // the employee's manager ends up whichever landed last, and the second audit
    // row's `before` reports a manager that was already stale when it was
    // written. Same arbiter as the change-request decide/withdraw routes, for
    // the same reason: `update` cannot carry the condition.
    const resolved = await auditedTransaction(async (tx) => {
      // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- conditional claim; recordAudit() below
      const claimed = await tx.managerRollUp.updateMany({
        where: { id: rollUpId, resolvedAt: null },
        data: {
          resolvedAt: now,
          resolvedByEmployeeId: by,
          resolutionNote: resolutionNote ?? null,
          toManagerEmployeeId: nextManagerId,
        },
      });
      // Lost the race: another resolution already closed this prompt. Nothing
      // has been written, including the manager move below.
      if (claimed.count === 0) return false;
      // §12.2 — "Manager-of-record = whoever CURRENTLY holds the relationship."
      // So the column moves, and nothing about the existing signatures changes.
      if (rollUp.employee.managerId !== nextManagerId) {
        await tx.employee.update({
          where: { id: rollUp.employeeId },
          data: { managerId: nextManagerId },
        });
      }
      await recordAudit(tx, {
        entityType: "ManagerRollUp",
        entityId: rollUpId,
        action: "UPDATE",
        before: { resolvedAt: null, managerId: rollUp.employee.managerId },
        after: {
          resolvedAt: now,
          managerId: nextManagerId,
          resolvedByEmployeeId: by,
          resolutionNote: resolutionNote ?? null,
        },
      });
      return true;
    });

    if (!resolved) {
      return err("This roll-up was resolved by someone else a moment ago (§12.2).", 409);
    }

    return ok({ rollUpId, resolvedAt: now, managerEmployeeId: nextManagerId });
  }),
  { id: "pms-rollup-write", limit: 30, windowMs: 60_000 },
);
