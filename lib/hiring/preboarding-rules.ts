/**
 * Step 14 rules (Interview Hub `lib/services/handover.ts`), pure. The route
 * depends on who recruited the hire: the requisition owner holding the HR
 * manager ("Sr HRBP") role hands over to another HR person (TRANSFERRED);
 * anyone else keeps the hire (RETAINED); no owner refuses (fail closed).
 * D5 fixed: a DECLINED package clears the package item — declining to share
 * pay evidence is an outcome of step 9, not a blocker.
 */

export type HandoverRoute = "TRANSFERRED" | "RETAINED" | "UNASSIGNED";

export function handoverRoute(ownerId: string | null, ownerIsHrManager: boolean): HandoverRoute {
  if (!ownerId) return "UNASSIGNED";
  return ownerIsHrManager ? "TRANSFERRED" : "RETAINED";
}

export type ChecklistInput = {
  signedOffer: boolean;
  packageConfirmed: boolean;
  packageDeclined: boolean;
  nationalId: boolean;
  joiningDate: Date | null;
};

export type ChecklistItem = {
  key: "signedOffer" | "package" | "nationalId" | "joiningDate";
  cleared: boolean;
};

export function preboardingChecklist(i: ChecklistInput): ChecklistItem[] {
  return [
    { key: "signedOffer", cleared: i.signedOffer },
    { key: "package", cleared: i.packageConfirmed || i.packageDeclined },
    { key: "nationalId", cleared: i.nationalId },
    { key: "joiningDate", cleared: i.joiningDate !== null },
  ];
}

export const HANDOVER_STAGES = ["OFFER_ACCEPTED", "PRE_ONBOARDING", "HIRED"] as const;

/** Why a handover cannot be recorded now, or null. */
export function handoverRefusal(x: {
  stage: string;
  route: HandoverRoute;
  recorded: boolean;
  actorIsOwnerOrAdmin: boolean;
  checklist: ChecklistItem[];
  recipientId: string | null;
  recipientEligible: boolean;
  ownerId: string | null;
  note: string;
}): { code: string; message: string; status: number } | null {
  if (!(HANDOVER_STAGES as readonly string[]).includes(x.stage))
    return {
      code: "WRONG_STAGE",
      message: "The handover is recorded once the offer is accepted.",
      status: 409,
    };
  if (x.route === "UNASSIGNED")
    return {
      code: "NO_OWNER",
      message:
        "This requisition has no recruiter on record, so nobody can hand the hire over. Set the requisition owner first.",
      status: 403,
    };
  if (!x.actorIsOwnerOrAdmin)
    return {
      code: "NOT_OWNER",
      message:
        "Only the recruiter who owns the requisition (or a hiring admin) records the handover.",
      status: 403,
    };
  if (x.recorded)
    return {
      code: "ALREADY_RECORDED",
      message: "The handover has already been recorded.",
      status: 409,
    };
  if (x.checklist.some((c) => !c.cleared))
    return {
      code: "CHECKLIST_OPEN",
      message: "Clear every pre-boarding item before handing over.",
      status: 409,
    };
  if (!x.recipientId || !x.recipientEligible)
    return {
      code: "BAD_RECIPIENT",
      message: "Hand over to an HR manager or HR specialist for this company.",
      status: 409,
    };
  if (x.route === "TRANSFERRED" && x.recipientId === x.ownerId)
    return {
      code: "SAME_PERSON",
      message: "A transfer goes to someone other than the recruiter.",
      status: 409,
    };
  if (x.route === "TRANSFERRED" && !x.note.trim())
    return {
      code: "NOTE_REQUIRED",
      message: "Write a handover note for the person taking over.",
      status: 409,
    };
  return null;
}
