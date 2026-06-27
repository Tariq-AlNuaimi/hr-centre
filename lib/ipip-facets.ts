// The 30 IPIP-NEO facet machine-names, grouped by OCEAN domain (6 each). These
// are the five-factor-e library's own labels (adopted, not invented -- see
// prisma/data/ipip-neo-120.ts). This module is the single source of truth for the
// facet vocabulary shared by:
//   - role-profile validation (a competency may only map facets that exist),
//   - the AI Role 1 draft schema (the LLM may only return real facets),
//   - the authoring UI facet picker.
// tests/contracts/ipip-facets.test.ts asserts this list equals the distinct
// facets in the seeded AssessmentItemBank, so the two can never drift.

import { Big5Domain } from "../generated/prisma/client";

export const IPIP_FACETS_BY_DOMAIN: Record<Big5Domain, readonly string[]> = {
  [Big5Domain.OPENNESS]: [
    "imagination",
    "artistic_interests",
    "emotionality",
    "adventurousness",
    "intellect",
    "liberalism",
  ],
  [Big5Domain.CONSCIENTIOUSNESS]: [
    "self_efficacy",
    "orderliness",
    "dutifulness",
    "achievement_striving",
    "self_discipline",
    "cautiousness",
  ],
  [Big5Domain.EXTRAVERSION]: [
    "friendliness",
    "gregariousness",
    "assertiveness",
    "activity_level",
    "excitement_seeking",
    "cheerfulness",
  ],
  [Big5Domain.AGREEABLENESS]: [
    "trust",
    "morality",
    "altruism",
    "cooperation",
    "modesty",
    "sympathy",
  ],
  [Big5Domain.NEUROTICISM]: [
    "anxiety",
    "anger",
    "depression",
    "self_consciousness",
    "immoderation",
    "vulnerability",
  ],
};

// Flat, sorted list of all 30 facet machine-names.
export const IPIP_FACETS: readonly string[] = Object.values(IPIP_FACETS_BY_DOMAIN)
  .flat()
  .sort();

const FACET_SET = new Set(IPIP_FACETS);

/** Whether a string is one of the 30 canonical IPIP-NEO facet machine-names. */
export function isIpipFacet(facet: string): boolean {
  return FACET_SET.has(facet);
}

/** The OCEAN domain a facet belongs to, or null if it is not a known facet. */
export function domainForFacet(facet: string): Big5Domain | null {
  for (const [domain, facets] of Object.entries(IPIP_FACETS_BY_DOMAIN)) {
    if (facets.includes(facet)) return domain as Big5Domain;
  }
  return null;
}
