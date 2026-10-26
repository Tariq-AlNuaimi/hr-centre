import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The two Phase-4 tool bodies, exercised against a stubbed Prisma.
//
// What is worth pinning here is not the lookup — it is the SHAPE of what the
// model is handed, because that shape is the only thing standing between a stale
// fact and a confident answer:
//
//   - §4.5: an expired offer must arrive LABELLED expired. The model cannot
//     present it as current without contradicting its own tool result.
//   - §4.4: "Codeline is not part of this rotation at all" is a different answer
//     from "I don't recognise your team", and conflating them hands a Codeline
//     employee a list of teams they are not on.
//   - §6.4: a female-only offer carries the redirect INSTRUCTION, not an enum —
//     "politely redirect and offer to show other discounts rather than dwelling
//     on the restriction" is behaviour, and a token cannot carry it.
//
// Every one of these makes MORE answers possible rather than fewer, so nothing
// else in the suite would go red if they regressed.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

type Discounts = typeof import("../../lib/hive/tools/discounts.ts");
type Rotation = typeof import("../../lib/hive/tools/rotation.ts");
let discounts: Discounts;
let rotation: Rotation;

const CTX = {
  companyId: null,
  orgUnitId: null,
  sessionId: null,
  source: "SIRAAJ" as const,
  identityVerified: false,
};
const on = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** One clearly live, one clearly lapsed, one with no end date (§6.4 has all three). */
const PARTNERS = [
  {
    name: "Minimo Cafe",
    offerSummary: "15% off drinks",
    eligibility: "ALL",
    validUntil: on("2099-01-01"),
    redemption: "Present your company ID card at the time of service.",
    onlineOnly: false,
    url: null,
  },
  {
    name: "Coat Fitters",
    offerSummary: "20% off accessories",
    eligibility: "ALL",
    validUntil: on("2020-01-01"),
    redemption: null,
    onlineOnly: false,
    url: null,
  },
  {
    name: "Alhut Alealamia Car Wash",
    offerSummary: "Discounted wash rates",
    eligibility: "ALL",
    validUntil: null,
    redemption: null,
    onlineOnly: false,
    url: null,
  },
  {
    name: "Backstage Salon",
    offerSummary: "20% off services above 10 OMR",
    eligibility: "FEMALE_ONLY",
    validUntil: on("2099-01-01"),
    redemption: null,
    onlineOnly: false,
    url: null,
  },
  {
    name: "Silaf",
    offerSummary: "10% off coffee items",
    eligibility: "ALL",
    validUntil: on("2099-01-01"),
    // The seed gives EVERY partner explicit redemption text. A fixture of nulls
    // let a derived exception list read green while emptying itself in prod.
    redemption: "Online only — register with your work email at checkout.",
    onlineOnly: true,
    url: "https://silaf.co",
  },
  {
    // A SECOND online-only partner. §6.4's prose names only Silaf, so the first
    // cut hardcoded "except Silaf" — this row is here so that shortcut cannot
    // come back without a test going red.
    name: "Alwadi Online",
    offerSummary: "12% off groceries",
    eligibility: "ALL",
    validUntil: null,
    redemption: "Online only — order with your work email.",
    onlineOnly: true,
    url: "https://alwadi.example",
  },
  {
    // An eligibility value the schema does not (yet) have. Falling back to ALL
    // here would invent an entitlement.
    name: "Unmapped Partner",
    offerSummary: "Something new",
    eligibility: "SOMETHING_NEW",
    validUntil: on("2099-01-01"),
    redemption: null,
    onlineOnly: false,
    url: null,
  },
];

/** Swapped by the truncation test; every other test runs against PARTNERS. */
let partnerRows: typeof PARTNERS = PARTNERS;

const COVERAGE = [
  {
    label: "Technology & Development",
    aliases: ["DevOps", "QA"],
    orgUnitId: "u-tech",
    group: { mode: "GROUP_2", deletedAt: null },
  },
  {
    label: "Operations",
    aliases: ["OPS"],
    orgUnitId: "u-ops",
    group: { mode: "CONSTANT", deletedAt: null },
  },
  {
    // A coverage row whose GROUP has been soft-deleted. It must not resolve —
    // nested reads are not covered by the soft-delete extension's top-level
    // `where` rewrite, so this is filtered by hand and could silently regress.
    label: "Ghost Directorate",
    aliases: [],
    orgUnitId: "u-ghost",
    group: { mode: "GROUP_1", deletedAt: on("2026-01-01") },
  },
];

const COMPANIES = [
  { id: "c-rihal", name: "Rihal", units: [{ id: "u-tech" }, { id: "u-ops" }] },
  { id: "c-codeline", name: "Codeline", units: [] },
];

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        discountPartner: {
          findMany: async ({ take }: { take?: number }) =>
            typeof take === "number" ? partnerRows.slice(0, take) : partnerRows,
        },
        // HR Centre stores the unit link as directorateId/departmentId.
        rotationCoverage: {
          findMany: async () =>
            COVERAGE.map(({ orgUnitId, ...c }) => ({
              ...c,
              entityId: null,
              directorateId: orgUnitId,
              departmentId: null,
            })),
        },
        // No stored config: the tool falls back to HIVE's anchor and weekend.
        rotationConfig: { findUnique: async () => null },
        orgEntity: {
          findFirst: async ({ where }: { where: Record<string, unknown> }) => {
            const named = (where.name as { equals?: string } | undefined)?.equals ?? "";
            const c =
              typeof where.id === "string"
                ? COMPANIES.find((x) => x.id === where.id)
                : COMPANIES.find((x) => x.name.toLowerCase() === String(named).toLowerCase());
            // HR Centre: a company's units are its directorates and departments.
            return c ? { id: c.id, name: c.name, directorates: c.units, departments: [] } : null;
          },
        },
      },
    },
  });
  discounts = (await import(import.meta.resolve("../../lib/hive/tools/discounts.ts"))) as Discounts;
  rotation = (await import(import.meta.resolve("../../lib/hive/tools/rotation.ts"))) as Rotation;
});

describe(
  "§4.5 — the model is handed the expiry verdict, not the raw date",
  { skip: !canMock },
  () => {
    test("a lapsed offer arrives labelled expired, with what to say about it", async () => {
      const result = await discounts.runDiscounts({}, CTX);
      const partners = result.partners as Record<string, unknown>[];
      const lapsed = partners.find((p) => p.partner === "Coat Fitters");
      assert.equal(
        lapsed?.status,
        "expired",
        "REGRESSION: §4.5 requires an expired offer to be flagged, not silently shown",
      );
      assert.match(
        String(lapsed?.note),
        /do not present it as current/i,
        "the instruction has to travel with the fact, or the model has only a date to interpret",
      );
      // §6.4 as AMENDED (A-1, 2026-09-01): the destination is the employee's own
      // HR Tag, not Admin@rihal.om. The invariant this has always been guarding
      // is unchanged and is the reason it is still asserted — a NAMED
      // destination rather than a vague "ask HR" — so both halves are checked:
      // the new one is named, and the superseded address has not crept back.
      assert.match(String(lapsed?.note), /HR Tag/, "§4.5 asks it to point at a NAMED destination");
      assert.match(String(lapsed?.note), /hr_tag/, "and to resolve which pair, not say 'ask HR'");
      assert.doesNotMatch(String(lapsed?.note), /Admin@rihal\.om/i, "superseded by amendment A-1");
    });

    test("a live offer is not flagged, so the label means something", async () => {
      const result = await discounts.runDiscounts({}, CTX);
      const partners = result.partners as Record<string, unknown>[];
      const live = partners.find((p) => p.partner === "Minimo Cafe");
      assert.equal(live?.status, "valid");
      assert.equal(live?.note, undefined);
    });

    test("'Not specified' is its own state and says not to claim it is running", async () => {
      const result = await discounts.runDiscounts({}, CTX);
      const partners = result.partners as Record<string, unknown>[];
      const unknown = partners.find((p) => p.partner === "Alhut Alealamia Car Wash");
      assert.equal(unknown?.status, "unspecified");
      assert.match(String(unknown?.note), /do not claim it is still running/i);
    });

    test("today is stated, so the verdict is checkable rather than asserted", async () => {
      const result = await discounts.runDiscounts({}, CTX);
      assert.match(String(result.today), /^\d{4}-\d{2}-\d{2}$/);
    });
  },
);

describe("§6.4 — eligibility carries the behaviour, not a token", { skip: !canMock }, () => {
  test("a female-only offer arrives with the redirect instruction", async () => {
    const result = await discounts.runDiscounts({ partner: "Backstage Salon" }, CTX);
    assert.match(String(result.eligibility), /female employees/i);
    assert.match(
      String(result.eligibility),
      /do not dwell on it/i,
      "§6.4: 'politely redirect and offer to show other discounts rather than dwelling on the restriction'",
    );
  });

  test("the redemption rule matches §6.4's general rules, Silaf included", async () => {
    const card = await discounts.runDiscounts({ partner: "Minimo Cafe" }, CTX);
    assert.match(String(card.howToRedeem), /company ID card/i);
    const online = await discounts.runDiscounts({ partner: "Silaf" }, CTX);
    assert.match(String(online.howToRedeem), /online only/i, "Silaf is §6.4's stated exception");
  });

  test("an unknown partner returns the real list rather than a near match", async () => {
    const result = await discounts.runDiscounts({ partner: "Starbucks" }, CTX);
    assert.equal(result.status, "partner_unknown");
    assert.equal((result.partners as unknown[]).length, PARTNERS.length);
  });

  test("a partial name is NOT resolved to one partner — it lists instead", async () => {
    // Folding is for EQUALITY, never similarity. Under a substring match "Salon"
    // resolves confidently to Backstage Salon and "Car" to the car wash, so an
    // employee who half-remembered a name gets ONE card presented as the answer
    // and never sees that others exist. The same match run the other way is
    // worse: any sentence containing a partner name swallows the question.
    for (const partial of ["Salon", "Car", "do we still get the silaf discount"]) {
      const result = await discounts.runDiscounts({ partner: partial }, CTX);
      assert.equal(
        result.status,
        "partner_unknown",
        `REGRESSION: "${partial}" was resolved to a near match instead of listing`,
      );
      assert.equal((result.partners as unknown[]).length, PARTNERS.length);
    }
  });

  test("a partner name matches folded — case and spacing vary in how people type", async () => {
    const result = await discounts.runDiscounts({ partner: "  minimo   cafe " }, CTX);
    assert.equal(result.partner, "Minimo Cafe");
  });
});

describe(
  "§6.4 — what the tool says about itself stays true as data changes",
  { skip: !canMock },
  () => {
    test("every eligibility value in the schema has wording — no silent 'open to all'", async () => {
      // The fallback below is a safety net, not the plan. This is the plan: read
      // the enum out of the schema so ADDING a fourth value fails here, at the
      // commit that adds it, rather than at a shop counter months later.
      const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
      const block = /enum DiscountEligibility \{([^}]*)\}/.exec(schema);
      assert.ok(block, "DiscountEligibility enum not found — did the model get renamed?");
      const values = block[1]
        .split("\n")
        .map((l) => l.replace(/\/\/.*$/, "").trim())
        .filter(Boolean);
      assert.ok(values.length >= 3, "sanity: the enum should have parsed to real values");
      for (const value of values) {
        assert.ok(
          discounts.ELIGIBILITY_NOTE[value],
          `REGRESSION: DiscountEligibility.${value} has no wording, so it falls back to "not sure" — add a line to ELIGIBILITY_NOTE`,
        );
      }
    });

    test("an unmapped eligibility does NOT become 'open to all employees'", async () => {
      // The natural-looking default (?? ELIGIBILITY_NOTE.ALL) invents an
      // entitlement, and nothing goes red until an employee is turned away.
      const note = discounts.ELIGIBILITY_NOTE["SOMETHING_NEW"];
      assert.equal(note, undefined, "sanity: this value is supposed to be unmapped");
      const card = await discounts.runDiscounts({ partner: "Unmapped Partner" }, CTX);
      assert.equal(card.partner, "Unmapped Partner");
      assert.doesNotMatch(String(card.eligibility), /open to all/i);
      assert.match(String(card.eligibility), /not sure/i);
      assert.match(String(card.eligibility), /HR Tag/, "it must say where to go instead");
      assert.doesNotMatch(
        String(card.eligibility),
        /Admin@rihal\.om/i,
        "superseded by amendment A-1",
      );
    });

    test("eligibility never instructs HIVE to ask who is asking (§5.1 is anonymous)", () => {
      for (const [key, note] of Object.entries(discounts.ELIGIBILITY_NOTE)) {
        if (key === "ALL") continue;
        assert.match(
          note,
          /never ask/i,
          `${key} tells the model to act on eligibility without saying it cannot know — the most direct way to comply is to ask the employee's gender`,
        );
      }
    });

    test("the general rule names the online-only partners it actually has", async () => {
      // Hardcoding "except Silaf" would contradict a second online-only partner's
      // own howToRedeem — HIVE sending someone to a counter that does not exist.
      const result = await discounts.runDiscounts({}, CTX);
      assert.match(String(result.generalRules), /Silaf/);
      assert.match(String(result.generalRules), /Alwadi Online/);
      assert.match(String(result.generalRules), /are online only/, "plural, since there are two");
      assert.doesNotMatch(
        String(result.generalRules),
        /Minimo/,
        "in-person partners are not exceptions",
      );
    });

    test("a truncated list says so instead of denying a partner exists", async () => {
      // 101 partners, so the 101st is past the cap. Without a truncation flag the
      // tool tells the model "these are the current offers — do not guess", and
      // the model turns a real partner into a confident "we do not have that".
      partnerRows = Array.from({ length: 101 }, (_, i) => ({
        ...PARTNERS[0],
        name: `Partner ${String(i + 1).padStart(3, "0")}`,
      }));
      try {
        const result = await discounts.runDiscounts({ partner: "Partner 101" }, CTX);
        assert.equal(result.status, "partner_unknown");
        assert.equal(result.truncated, true);
        assert.equal(
          (result.partners as unknown[]).length,
          100,
          "the extra row is a probe for truncation, not something to show",
        );
        assert.match(
          String(result.detail),
          /could not find it rather than that it does not exist/i,
        );
        assert.doesNotMatch(String(result.detail), /do not guess at a near match/i);
      } finally {
        partnerRows = PARTNERS;
      }
    });

    test("an untruncated list is flagged untruncated, so the flag means something", async () => {
      const result = await discounts.runDiscounts({}, CTX);
      assert.equal(result.truncated, false);
    });
  },
);

describe("§4.4 — the rotation tool's three distinct answers", { skip: !canMock }, () => {
  test("a known team gets a presence and a week type", async () => {
    const result = await rotation.runRotation({ team: "DevOps", date: "2026-03-31" }, CTX);
    assert.equal(result.status, "ok");
    assert.equal(result.team, "Technology & Development");
    assert.equal(result.presence, "office");
    assert.equal(result.weekType, "A");
    assert.equal(result.rotates, true);
  });

  test("the CONSTANT is marked as not rotating, so it is not described as on a rotation", async () => {
    const result = await rotation.runRotation({ team: "OPS", date: "2026-03-31" }, CTX);
    assert.equal(result.rotates, false);
    assert.match(String(result.detail), /does not rotate/i);
  });

  test("a company outside the rotation is NOT 'team unknown'", async () => {
    // §4.4: "Codeline — not part of this rotation at all." The first cut gave
    // this the same answer as an unrecognised team, so a Codeline employee was
    // handed a list of teams they are not on and asked to pick one.
    const byName = await rotation.runRotation({ team: "Codeline" }, CTX);
    assert.equal(byName.status, "not_in_rotation");
    assert.equal(byName.company, "Codeline");
    assert.equal(byName.knownTeams, undefined, "must not offer teams they are not on");

    const bySelector = await rotation.runRotation({}, { ...CTX, companyId: "c-codeline" });
    assert.equal(bySelector.status, "not_in_rotation");
  });

  test("an unrecognised team asks, and offers the real vocabulary", async () => {
    const result = await rotation.runRotation({ team: "the moon" }, CTX);
    assert.equal(result.status, "team_unknown");
    assert.deepEqual(result.knownTeams, ["Technology & Development", "Operations"]);
  });

  test("coverage under a soft-deleted GROUP does not resolve", async () => {
    // Nested reads are not covered by the soft-delete extension's top-level
    // `where` rewrite. "Ghost Directorate" is in the fixture precisely so this
    // hand-written filter cannot quietly disappear.
    const result = await rotation.runRotation({ team: "Ghost Directorate" }, CTX);
    assert.notEqual(result.status, "ok", "a deleted group must not answer");
  });

  test("the §3.5 selector's orgUnitId resolves when no team was said", async () => {
    // This path was dead until the seed linked `RotationCoverage.orgUnitId`.
    const result = await rotation.runRotation(
      { date: "2026-03-31" },
      { ...CTX, orgUnitId: "u-tech" },
    );
    assert.equal(result.status, "ok");
    assert.equal(result.team, "Technology & Development");
  });
});
