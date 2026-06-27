// Client-safe mirror of the IPIP facet vocabulary (lib/ipip-facets.ts).
//
// WHY A MIRROR: lib/ipip-facets.ts imports `Big5Domain` as a *value* from the
// generated Prisma client, which pulls Node-only code into any client bundle that
// imports it (Turbopack errors on `node:module` in the browser chunk). The facet
// picker is a client component, so it needs the same vocabulary without that Prisma
// import. The backend is locked, so we cannot refactor lib/ — instead we re-declare
// the list here with plain string domain keys that match the Big5Domain enum names
// (so the `roleProfiles.domains.*` i18n keys still resolve).
//
// DRIFT GUARD: tests/contracts/ipip-facets.test.ts already pins the canonical list
// to the seeded item bank. Keep DOMAIN_FACETS identical to IPIP_FACETS_BY_DOMAIN
// (same 30 names, same grouping); if the canonical list changes, update this too.

export type Big5DomainKey =
  | "OPENNESS"
  | "CONSCIENTIOUSNESS"
  | "EXTRAVERSION"
  | "AGREEABLENESS"
  | "NEUROTICISM";

export const DOMAIN_FACETS: Record<Big5DomainKey, readonly string[]> = {
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
  AGREEABLENESS: ["trust", "morality", "altruism", "cooperation", "modesty", "sympathy"],
  NEUROTICISM: [
    "anxiety",
    "anger",
    "depression",
    "self_consciousness",
    "immoderation",
    "vulnerability",
  ],
};

export const DOMAIN_KEYS = Object.keys(DOMAIN_FACETS) as Big5DomainKey[];

/** Flat set of all 30 facet machine-names, for client-side validation. */
export const FACET_NAMES: ReadonlySet<string> = new Set(
  Object.values(DOMAIN_FACETS).flat()
);
