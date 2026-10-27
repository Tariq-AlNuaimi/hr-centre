import type { ContractType } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { allocateEmployeeCode, getEmployeeCodeSequence } from "@/lib/people/employee-code";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import { canFor, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { resolveHrAssignment } from "../engine/assignment";
import { nextCaseRef, withCaseRefRetry } from "../engine/case-ref";
import { generateTasks } from "../engine/generate";
import { materialiseTasks } from "../engine/materialise";
import { selectJoinOrMoveTemplate, templateTaskDefs } from "../engine/templates";
import { joinerSubject, loadJoinerRow, type JoinerRow } from "./joiner-data";
import { readinessProblem } from "./readiness";
import {
  assertActivatable,
  candidateOf,
  directorateProblem,
  duplicateProblem,
  emailDuplicates,
  factsOf,
  placementOf,
} from "./activation-checks";
import { onActivated } from "./triggers";

/**
 * Activation — HR Onboarding `activation.ts:119-375` (§9.4, US1–US3). The order
 * is load-bearing and kept: readiness → directorate rule → duplicate email →
 * (one transaction) owner → template → tasks → EMP code LAST → case reference.
 * Nothing is half-done: a refusal anywhere leaves no code, case or task.
 *
 * Fixed while porting: the case-reference race retries (8.4.8); due dates read
 * the working schedule and holidays (8.4.4); the employment-type settings are
 * honoured — an inactive type blocks, a suggested template is preferred (8.4.10).
 */

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

async function employmentTypeTemplate(tx: Tx, type: ContractType | null) {
  if (!type) return null;
  const config = await tx.jmlEmploymentTypeConfig.findUnique({
    where: { employmentType: type },
    select: { active: true, defaultTemplateId: true },
  });
  if (config && !config.active) {
    throw new JmlError(
      "That employment type is not offered on new hires (Employment types settings).",
      409,
    );
  }
  if (!config?.defaultTemplateId) return null;
  const suggested = await tx.jmlTaskTemplate.findUnique({
    where: { id: config.defaultTemplateId },
    select: { name: true },
  });
  if (!suggested) return null;
  // The suggestion names a template; its newest active version is the one used.
  return tx.jmlTaskTemplate.findFirst({
    where: { name: suggested.name, caseType: "JOIN", active: true },
    orderBy: { version: "desc" },
    select: { id: true, name: true, version: true },
  });
}

async function chooseTemplate(tx: Tx, row: JoinerRow, companyCode: string | null) {
  const template =
    (await employmentTypeTemplate(tx, row.employee.contractType)) ??
    (await selectJoinOrMoveTemplate("JOIN", factsOf(row, companyCode), null, tx));
  if (!template) {
    throw new JmlError(
      "No checklist template matches this joiner, so the case would have no tasks. Add or widen a template in JML settings first.",
      409,
    );
  }
  return template;
}

async function generateFor(tx: Tx, row: JoinerRow, companyCode: string | null, templateId: string) {
  const [defs, calendar] = await Promise.all([
    templateTaskDefs(templateId, tx),
    loadWorkingCalendar(),
  ]);
  const tasks = generateTasks(
    defs,
    {
      caseType: "JOIN",
      facts: factsOf(row, companyCode),
      anchors: { START_DATE: row.joinDetail!.plannedStartDate },
    },
    calendar,
  );
  if (tasks.length === 0) {
    throw new JmlError(
      defs.length === 0
        ? "The matching checklist template has no tasks, so the case would have no checklist."
        : "Every task in the matching template is excluded by its conditions for this joiner. Widen the task conditions first.",
      409,
    );
  }
  return tasks;
}

/** Every blocker at once, for the activation panel (GET …/activate). */
export async function previewActivation(actor: JmlActor, caseId: string) {
  const row = await loadJoinerRow(caseId);
  const subject = joinerSubject(row.employee);
  if (!canFor(actor, "jml.view", subject)) throw new JmlError("Joiner not found", 404);
  const blockers: string[] = [];
  const push = (m: string | null) => m && blockers.push(m);
  try {
    assertActivatable(row);
  } catch (e) {
    return { ready: false, blockers: [(e as Error).message], duplicates: [] };
  }
  push(readinessProblem(candidateOf(row)));
  push(await directorateProblem(row));
  const duplicates = await emailDuplicates(row);
  if (duplicates.length > 0 && !canFor(actor, "jml.supervise", subject)) {
    push(await duplicateProblem(actor, row, undefined));
  }
  blockers.push(...(await setupProblems(row)));
  return { ready: blockers.length === 0, blockers, duplicates };
}

/** The configuration a joiner's activation needs: HR rule, code cutover, template. */
async function setupProblems(row: Awaited<ReturnType<typeof loadJoinerRow>>): Promise<string[]> {
  const out: string[] = [];
  const owner = await resolveHrAssignment(placementOf(row), "JOIN");
  if (!owner) {
    out.push("No HR assignment rule covers this position. Add a rule in JML settings.");
  }
  if (!(await getEmployeeCodeSequence())) {
    out.push("The employee code cutover has not been configured yet (BR-021).");
  }
  try {
    await chooseTemplate(prisma as unknown as Tx, row, row.employee.entity.code);
  } catch (e) {
    if (e instanceof JmlError) out.push(e.message);
    else throw e;
  }
  return out;
}

/** Several refusals as one message: numbered, so each reads on its own. */
export function joinProblems(problems: readonly string[]): string {
  if (problems.length === 1) return problems[0]!;
  return `Activation is blocked by ${problems.length} things: ${problems
    .map((p, i) => `(${i + 1}) ${p.replace(/\.$/, "")}`)
    .join("; ")}.`;
}

export async function activateJoiner(
  actor: JmlActor,
  caseId: string,
  options: { duplicateOverrideReason?: string } = {},
) {
  const row = await loadJoinerRow(caseId);
  const subject = joinerSubject(row.employee);
  if (!canFor(actor, "jml.view", subject)) throw new JmlError("Joiner not found", 404);
  if (!canFor(actor, "jml.manageJoiners", subject)) {
    throw new JmlError("You cannot activate onboarding for this joiner.", 403);
  }
  assertActivatable(row);
  // QA D-10: report EVERY blocker in one refusal (as the preview does), not the
  // first one per attempt — on a fresh install that was contract type, then HR
  // rule, then the employee-code cutover, one click each.
  const problems = [
    readinessProblem(candidateOf(row)),
    await directorateProblem(row),
    await duplicateProblem(actor, row, options.duplicateOverrideReason),
    ...(await setupProblems(row)),
  ].filter((p): p is string => Boolean(p));
  if (problems.length > 0) {
    const onlyDuplicate = problems.length === 1 && problems[0]!.includes("already used by");
    throw new JmlError(joinProblems(problems), onlyDuplicate ? 409 : 422);
  }
  const dupes = await emailDuplicates(row);
  const overrideReason = dupes.length > 0 ? (options.duplicateOverrideReason ?? null) : null;

  const result = await withCaseRefRetry(() =>
    auditedTransaction(
      async (tx) => {
        const owner = await resolveHrAssignment(placementOf(row), "JOIN", tx);
        if (!owner) {
          throw new JmlError(
            "No HR assignment rule covers this position, so the case has no owner. Add a rule in JML settings first.",
            409,
          );
        }
        const template = await chooseTemplate(tx, row, row.employee.entity.code);
        const tasks = await generateFor(tx, row, row.employee.entity.code, template.id);
        // LAST, so every refusal above leaves the sequence untouched (BR-003).
        const employeeCode = await allocateEmployeeCode(tx);
        const caseRef = await nextCaseRef(tx, "JOIN");
        await tx.employee.update({
          where: { id: row.employee.id },
          data: { employeeCode },
          select: { id: true },
        });
        await tx.jmlCase.update({
          where: { id: caseId, version: row.version, status: "DRAFT" },
          data: {
            caseRef,
            status: "ACTIVE",
            stage: "PREBOARDING",
            hrOwnerUserId: owner.rule.juniorHr.id,
            seniorHrUserId: owner.rule.seniorHr.id,
            templateId: template.id,
            activatedAt: new Date(),
            duplicateOverrideReason: overrideReason,
            lastUpdatedById: actor.userId,
            version: { increment: 1 },
          },
          select: { id: true },
        });
        const taskCount = await materialiseTasks(tx, caseId, tasks, owner.rule.juniorHr.id);
        return {
          caseId,
          caseRef,
          employeeCode,
          hrOwnerUserId: owner.rule.juniorHr.id,
          templateId: template.id,
          taskCount,
        };
      },
      { timeout: 20_000 },
    ),
  );
  try {
    await onActivated(result.caseId);
  } catch (e) {
    // Activation is not rolled back for a message (Onboarding): the failure is logged.
    console.error(
      `[jml] case ${result.caseId} activated; the joiner messages could not be queued`,
      e,
    );
  }
  return result;
}
