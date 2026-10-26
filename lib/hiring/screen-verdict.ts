/**
 * The CV-screen verdict — Interview Hub `screen-verdict.ts`, pure: fit
 * against the role's pass threshold, then the declared expectation against
 * the band.
 */

export type ScreenVerdict = "SHORTLIST" | "OVER_BAND" | "REJECT";

export type VerdictResult = { verdict: ScreenVerdict | null; why: string };

/**
 * The screen verdict: fit against the role's pass threshold, then the declared
 * expectation against the band. Coarse by design — the band itself never
 * reaches a reader without comp rights; only the verdict word does.
 */
export function screenVerdict(input: {
  fit: number | null | undefined;
  expectation: number | null | undefined;
  bandMin: number | null | undefined;
  bandMax: number | null | undefined;
  fitThreshold: number;
}): VerdictResult {
  const { fit, expectation, bandMin, bandMax, fitThreshold } = input;
  if (fit == null || Number.isNaN(fit) || fit <= 0) {
    return { verdict: null, why: "Not screened yet." };
  }
  if (fit < fitThreshold) {
    return {
      verdict: "REJECT",
      why: `Fit ${Math.round(fit)} is below the ${fitThreshold} minimum for this role.`,
    };
  }
  const has = expectation != null && !Number.isNaN(expectation);
  if (has && bandMax != null && expectation > bandMax) {
    const overPct = Math.round(((expectation - bandMax) / bandMax) * 100);
    return {
      verdict: "OVER_BAND",
      why: `Competency fit is fine; expectation is ${overPct}% above the band max.`,
    };
  }
  if (has && bandMin != null && expectation < bandMin) {
    return {
      verdict: "SHORTLIST",
      why: "Meets the minimum on fit; expectation sits below the band floor — check the level.",
    };
  }
  if (has && bandMax != null && expectation >= bandMax * 0.95) {
    return { verdict: "SHORTLIST", why: "Meets the minimum on fit. At the top of band." };
  }
  return {
    verdict: "SHORTLIST",
    why: has
      ? "Meets the minimum on fit; expectation sits within the band."
      : "Meets the minimum on fit; no expectation declared.",
  };
}

export function isWithinBand(
  expectation: number | null | undefined,
  bandMin: number | null | undefined,
  bandMax: number | null | undefined,
): boolean {
  if (expectation == null || Number.isNaN(expectation)) return false;
  if (bandMin != null && expectation < bandMin) return false;
  return !(bandMax != null && expectation > bandMax);
}

export function yearsFromProfile(profileData: unknown): number | null {
  if (!profileData || typeof profileData !== "object") return null;
  const p = profileData as Record<string, unknown>;
  for (const key of ["yearsExperience", "yearsOfExperience", "totalYearsExperience"]) {
    const v = p[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/** "Acme · 6 yrs" under a screening row; null when neither is known. */
export function employerLine(
  employer: string | null | undefined,
  years: number | null,
): string | null {
  const parts: string[] = [];
  if (employer?.trim()) parts.push(employer.trim());
  if (years != null && years > 0) parts.push(`${Math.round(years)} yrs`);
  return parts.length ? parts.join(" · ") : null;
}
