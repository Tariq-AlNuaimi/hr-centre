/**
 * Exit interview rules (Offboarding `interview.ts`, AC-8.1/8.2, AC-9.1/9.2),
 * pure. F9 fixed: codes are validated against the CONFIGURED taxonomy (active
 * rows, parent = the chosen Level 1), passed in by the caller.
 */

export type TaxonomyCode = { code: string; label: string; level1: string; active: boolean };

export type InterviewCapture = {
  conducted: "CONDUCTED" | "DECLINED";
  primaryL1: string;
  primaryL2Code: string | null;
  secondaryL2Code: string | null;
  retentionAttempted: boolean | null;
  counterOfferMade: boolean | null;
  recommendScore: number | null;
  returnScore: number | null;
};

export type Blocker = { field: string; message: string };

function codeProblem(
  level1: string,
  code: string,
  taxonomy: readonly TaxonomyCode[],
  field: string,
): Blocker | null {
  const hit = taxonomy.find((c) => c.code === code);
  if (!hit) return { field, message: `"${code}" is not a Level 2 reason code.` };
  if (!hit.active) return { field, message: `"${hit.label}" (${code}) is no longer in use.` };
  if (hit.level1 !== level1) {
    return {
      field,
      message: `"${hit.label}" belongs to ${hit.level1}, not ${level1}. A Level 2 code is valid only within its Level 1 parent (BR-OFF-016).`,
    };
  }
  return null;
}

export function checkInterviewCapture(
  c: InterviewCapture,
  ctx: { exitType: string; taxonomy: readonly TaxonomyCode[] },
): Blocker[] {
  const out: Blocker[] = [];
  if (!c.primaryL2Code) {
    out.push({ field: "primaryL2Code", message: "A Level 2 reason code is required (AC-8.1)." });
  } else {
    const p = codeProblem(c.primaryL1, c.primaryL2Code, ctx.taxonomy, "primaryL2Code");
    if (p) out.push(p);
  }
  if (c.secondaryL2Code) {
    if (c.secondaryL2Code === c.primaryL2Code) {
      out.push({
        field: "secondaryL2Code",
        message: "The secondary reason cannot repeat the primary reason.",
      });
    } else {
      const p = codeProblem(c.primaryL1, c.secondaryL2Code, ctx.taxonomy, "secondaryL2Code");
      if (p) out.push(p);
    }
  }
  for (const [field, value] of [
    ["recommendScore", c.recommendScore],
    ["returnScore", c.returnScore],
  ] as const) {
    if (value === null) out.push({ field, message: "A score from 1 to 5 is required (§12.4)." });
    else if (!Number.isInteger(value) || value < 1 || value > 5)
      out.push({ field, message: "The score must be a whole number from 1 to 5." });
  }
  if (ctx.exitType === "RESIGNATION") {
    if (c.retentionAttempted === null) {
      out.push({
        field: "retentionAttempted",
        message: "Record whether retention was attempted — required for a resignation (§12.4).",
      });
    }
    if (c.counterOfferMade === null) {
      out.push({
        field: "counterOfferMade",
        message: "Record whether a counter-offer was made — required for a resignation (§12.4).",
      });
    }
  }
  return out;
}

export function checkAssessment(a: {
  regrettable: string | null;
  preventable: string | null;
  preventionFactor: string | null;
}): Blocker[] {
  const out: Blocker[] = [];
  if (!a.regrettable)
    out.push({ field: "regrettable", message: "A regrettable assessment is required (§12.4)." });
  if (!a.preventable)
    out.push({ field: "preventable", message: "A preventable assessment is required (§12.4)." });
  if (a.preventable === "PREVENTABLE" && !a.preventionFactor) {
    out.push({
      field: "preventionFactor",
      message: "A prevention factor is required when the exit is assessed as preventable (AC-9.2).",
    });
  }
  if (a.preventable && a.preventable !== "PREVENTABLE" && a.preventionFactor) {
    out.push({
      field: "preventionFactor",
      message: `A prevention factor contradicts an exit assessed as ${a.preventable}. Clear the factor, or change the assessment.`,
    });
  }
  return out;
}

/** Changing the coded reasons after an assessment invalidates it (it judged other reasons). */
export function reasonsChanged(
  before: { primaryL1: string; primaryL2Code: string; secondaryL2Code: string | null } | null,
  after: { primaryL1: string; primaryL2Code: string | null; secondaryL2Code: string | null },
): boolean {
  if (!before) return false;
  return (
    before.primaryL1 !== after.primaryL1 ||
    before.primaryL2Code !== after.primaryL2Code ||
    before.secondaryL2Code !== after.secondaryL2Code
  );
}
