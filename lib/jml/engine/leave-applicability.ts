import type { JmlNationalityScope, LeaveExitType } from "@/generated/prisma/client";

/**
 * LEAVE task applicability — HR Offboarding `task-generation.ts`
 * `taskAppliesToCase`: exit types (empty = all), nationality branch (ANY or
 * equal), settlement (null = either). All three must admit (Offboarding §8.4).
 */

export type LeaveApplicability = {
  appliesToExitTypes: readonly LeaveExitType[];
  appliesToNationality: JmlNationalityScope;
  appliesToSettlement: boolean | null;
};

export type LeaveProfile = {
  exitType: LeaveExitType;
  nationality: "OMANI" | "EXPATRIATE";
  settlementApplicable: boolean;
};

/** All three scopes must pass (Offboarding §8.4). */
export function leaveTaskApplies(task: LeaveApplicability, profile: LeaveProfile): boolean {
  if (task.appliesToExitTypes.length > 0 && !task.appliesToExitTypes.includes(profile.exitType)) {
    return false;
  }
  if (task.appliesToNationality !== "ANY" && task.appliesToNationality !== profile.nationality) {
    return false;
  }
  if (
    task.appliesToSettlement !== null &&
    task.appliesToSettlement !== profile.settlementApplicable
  ) {
    return false;
  }
  return true;
}
