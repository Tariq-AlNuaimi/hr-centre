import { test } from "node:test";
import assert from "node:assert/strict";
import { IPIP_NEO_120 } from "../../prisma/data/ipip-neo-120";
import { STARTER_ROLE_PROFILES } from "../../prisma/data/starter-role-profiles";
import {
  IPIP_FACETS,
  IPIP_FACETS_BY_DOMAIN,
  isIpipFacet,
  domainForFacet,
} from "../../lib/ipip-facets";

// lib/ipip-facets is the single source of truth for the facet vocabulary used by
// role-profile validation, the AI draft schema, and the UI picker. These lock it
// to the actual seeded instrument so the two can never drift (a competency could
// otherwise map a facet the bank can't measure).

test("IPIP_FACETS exactly equals the distinct facets in the seeded item bank", () => {
  const bankFacets = new Set(IPIP_NEO_120.map((i) => i.facet));
  const listFacets = new Set(IPIP_FACETS);
  assert.equal(listFacets.size, 30, "expected 30 facets");
  assert.deepEqual(
    [...listFacets].sort(),
    [...bankFacets].sort(),
    "lib/ipip-facets has drifted from the IPIP-NEO-120 dataset"
  );
});

test("each facet's domain grouping matches the item bank's domain for that facet", () => {
  const bankDomainByFacet = new Map(IPIP_NEO_120.map((i) => [i.facet, i.domain]));
  for (const [domain, facets] of Object.entries(IPIP_FACETS_BY_DOMAIN)) {
    assert.equal(facets.length, 6, `${domain} must have 6 facets`);
    for (const f of facets) {
      assert.equal(bankDomainByFacet.get(f), domain, `${f} should be in ${domain}`);
      assert.equal(domainForFacet(f), domain);
    }
  }
});

test("isIpipFacet accepts real facets and rejects unknowns", () => {
  assert.equal(isIpipFacet("achievement_striving"), true);
  assert.equal(isIpipFacet("telepathy"), false);
  assert.equal(isIpipFacet(""), false);
});

test("every starter-profile competency maps only real IPIP facets", () => {
  for (const profile of STARTER_ROLE_PROFILES) {
    assert.ok(profile.competencies.length > 0, `${profile.familyKey} has competencies`);
    for (const c of profile.competencies) {
      assert.ok(c.facets.length > 0, `${c.name} maps at least one facet`);
      for (const f of c.facets) {
        assert.equal(isIpipFacet(f), true, `${c.name} maps unknown facet "${f}"`);
      }
      assert.ok(
        c.targetPercentile >= 1 && c.targetPercentile <= 99,
        `${c.name} band in range`
      );
      assert.ok(c.weight > 0, `${c.name} weight > 0`);
    }
  }
});
