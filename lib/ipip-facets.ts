// The 30 IPIP-NEO facet machine-names, grouped by OCEAN domain (6 each). These
// are the five-factor-e library's own labels (adopted, not invented -- see
// prisma/data/ipip-neo-120.ts). This module is the single source of truth for the
// facet vocabulary shared by:
//   - role-profile validation (a competency may only map facets that exist),
//   - the AI Role 1 draft schema (the LLM may only return real facets),
//   - the authoring UI facet picker.
// tests/contracts/ipip-facets.test.ts asserts this list equals the distinct
// facets in the seeded AssessmentItemBank, so the two can never drift.
//
// CLIENT-SAFE: the domain keys mirror the Prisma `Big5Domain` enum VALUES exactly
// but are declared as plain strings here (NOT imported from the generated Prisma
// client) so the facet picker can import this from a client component without
// pulling the server-only Prisma client into the browser bundle.

export const BIG5_DOMAINS = [
  "OPENNESS",
  "CONSCIENTIOUSNESS",
  "EXTRAVERSION",
  "AGREEABLENESS",
  "NEUROTICISM",
] as const;
export type Big5DomainKey = (typeof BIG5_DOMAINS)[number];

export const IPIP_FACETS_BY_DOMAIN: Record<Big5DomainKey, readonly string[]> = {
  OPENNESS: [
    "imagination",
    "artistic_interests",
    "emotionality",
    "adventurousness",
    "intellect",
    "liberalism",
  ],
  CONSCIENTIOUSNESS: [
    "self_efficacy",
    "orderliness",
    "dutifulness",
    "achievement_striving",
    "self_discipline",
    "cautiousness",
  ],
  EXTRAVERSION: [
    "friendliness",
    "gregariousness",
    "assertiveness",
    "activity_level",
    "excitement_seeking",
    "cheerfulness",
  ],
  AGREEABLENESS: [
    "trust",
    "morality",
    "altruism",
    "cooperation",
    "modesty",
    "sympathy",
  ],
  NEUROTICISM: [
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
export function domainForFacet(facet: string): Big5DomainKey | null {
  for (const [domain, facets] of Object.entries(IPIP_FACETS_BY_DOMAIN)) {
    if (facets.includes(facet)) return domain as Big5DomainKey;
  }
  return null;
}
