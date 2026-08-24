/**
 * The per-field import checks, grouped by what they answer:
 *
 *   identity   — who the row says the person is (context-free)
 *   placement  — where they sit in the org (needs entity/department/manager context)
 *   employment — the terms that feed Phase 5's money path
 *
 * `validate.ts` composes them; the batch-level rules that need the whole file
 * (ID uniqueness, reporting cycles) stay there.
 */
export { issue, normalize, type Check, type ValidationContext } from "./shared";
export { checkEmployeeId, checkNameAndEmail, checkRoleTrack, checkStatus } from "./identity";
export { checkPlacement, checkManager } from "./placement";
export { checkSalary, checkLastWorkingDay, checkUnpaidLeave } from "./employment";
