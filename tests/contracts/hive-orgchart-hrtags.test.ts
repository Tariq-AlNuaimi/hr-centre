import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { orgDouble, pairsToDb, type HiveUnit } from "./_hive-org-double";

// Phase 4.5's two tools, against a stubbed Prisma.
//
// §4.4's binding note is the invariant these two files can most easily break:
// rotation groups, HR Tag coverage and the org chart are three independently
// editable structures that only HAPPEN to overlap. Operations is a rotation
// CONSTANT, an org directorate, and covered by Shahed & Afra — three facts, one
// word. A tool that resolves an HR pair by reading `OrgUnit` names, or an org
// chart that falls back to rotation labels, collapses them into one lookup
// table, and the collapse would look like a simplification right up to the day
// Alaa restructures one of the three.
//
// The fixture is built so that collapse FAILS rather than passing quietly: the
// same word means different things in each structure, and each company routes
// by a different mechanism.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

type Org = typeof import("../../lib/hive/tools/orgchart.ts");
type HrTags = typeof import("../../lib/hive/tools/hrtags.ts");
let org: Org;
let hrtags: HrTags;

const CTX = {
  companyId: null,
  orgUnitId: null,
  sessionId: null,
  source: "SIRAAJ" as const,
  identityVerified: false,
};

/** Rihal routes per-directorate; TP routes wholesale; Codeline has no chart. */
const COMPANIES = [
  {
    id: "c-rihal",
    name: "Rihal",
    units: [{ id: "u-ops" }, { id: "u-tech" }, { id: "u-str" }],
  },
  { id: "c-tp", name: "Transformation Pioneers", units: [{ id: "t-ops" }] },
  { id: "c-codeline", name: "Codeline", units: [] },
  // A FOURTH company with no chart and a name nothing hardcodes. §4.2's premise
  // is that Alaa adds a company without a developer, so "no chart yet" has to
  // come from the absence of units, not from recognising "Codeline".
  { id: "c-newco", name: "Newco Holdings", units: [] },
  // Rows exist, but every one of them points at a parent that is gone.
  { id: "c-orphan", name: "Orphanage", units: [{ id: "o-team" }] },
];

const UNITS: Record<string, unknown[]> = {
  "c-rihal": [
    {
      id: "u-ops",
      name: "Operations",
      kind: "DIRECTORATE",
      leaderName: "Tariq Al Nuaimi",
      leaderTitle: "Director",
      parentId: null,
    },
    {
      id: "u-tech",
      name: "Technology & Development",
      kind: "DIRECTORATE",
      leaderName: "Ahmed Al Hasani",
      leaderTitle: "Director",
      parentId: null,
    },
    {
      id: "u-sw",
      name: "Software",
      kind: "TEAM",
      leaderName: null,
      leaderTitle: null,
      parentId: "u-tech",
    },
    {
      id: "u-str",
      name: "Strategy",
      kind: "DIRECTORATE",
      leaderName: "Sadiq Damani",
      leaderTitle: "Director",
      parentId: null,
    },
    // Two teams of the same name under different directorates. §4.2 lets Alaa
    // create this, and taking the first would answer under the wrong parent.
    {
      id: "u-sup-ops",
      name: "Support",
      kind: "TEAM",
      leaderName: "Ops Lead",
      leaderTitle: "Lead",
      parentId: "u-ops",
    },
    {
      id: "u-sup-tech",
      name: "Support",
      kind: "TEAM",
      leaderName: "Tech Lead",
      leaderTitle: "Lead",
      parentId: "u-tech",
    },
  ],
  // TP's four peer departments are top-level rows, NOT nested under Operations.
  // §6.5 is explicit that their managers report to the Operation Manager but
  // that this must never surface in an employee-facing answer.
  "c-tp": [
    {
      id: "t-ops",
      name: "Operations",
      kind: "DEPARTMENT",
      leaderName: "Sultan Al Masroori",
      leaderTitle: "Operation Manager",
      parentId: null,
    },
    {
      id: "t-pcm",
      name: "Project & Change Management",
      kind: "DEPARTMENT",
      leaderName: "Abdulmalik Al Rawahi",
      leaderTitle: "Manager",
      parentId: null,
    },
  ],
  "c-codeline": [],
  "c-orphan": [
    {
      id: "o-team",
      name: "Stranded Team",
      kind: "TEAM",
      leaderName: null,
      leaderTitle: null,
      parentId: "o-gone",
    },
  ],
};

interface FixtureCoverage {
  label: string;
  aliases: string[];
  companyId: string | null;
  orgUnitId: string | null;
}
interface FixturePair {
  id: string;
  name: string;
  isDefault: boolean;
  members: {
    name: string;
    email: string;
    /** Nullable in the schema, so the card must survive it being absent. */
    phone: string | null;
    photoKey: string | null;
    /** HR's curated position. Deliberately DISAGREES with array position below,
     *  so ordering by insertion instead of by this column is detectable. */
    order: number;
    createdAt: Date;
  }[];
  coverage: FixtureCoverage[];
}

const PAIRS: FixturePair[] = [
  {
    id: "p-1",
    name: "Shahed Al Amri & Afra Al Hooti",
    isDefault: false,
    members: [
      {
        name: "Shahed Al Amri",
        email: "Shahed.Amri@rihal.om",
        phone: "+968 9178 8564",
        photoKey: null,
        order: 2,
        createdAt: new Date("2026-01-01"),
      },
      {
        name: "Afra Al Hooti",
        email: "Afra.Hooti@rihal.om",
        phone: "+968 7194 3347",
        photoKey: "photos/afra.jpg",
        order: 1,
        createdAt: new Date("2026-02-01"),
      },
    ],
    coverage: [
      {
        label: "Operations Directorate (Rihal)",
        aliases: ["OPS", "Operations", "Legal"],
        companyId: null,
        orgUnitId: "u-ops",
      },
      { label: "Codeline", aliases: ["CL"], companyId: "c-codeline", orgUnitId: null },
    ],
  },
  {
    id: "p-2",
    name: "Rahma Adam & Mohammed Al Amri",
    isDefault: false,
    members: [
      {
        name: "Rahma Adam",
        email: "Rahma.Adam@rihal.om",
        phone: "+968 9249 5377",
        photoKey: null,
        order: 1,
        createdAt: new Date("2026-01-01"),
      },
    ],
    coverage: [
      {
        label: "Technology & Development Directorate",
        aliases: ["Tech", "DevOps", "Software"],
        companyId: null,
        orgUnitId: "u-tech",
      },
      {
        // Linked to one of TP's OWN units, on a pair that is not TP's
        // company-wide pair. Company scoping cannot exclude this one, so it is
        // the step ORDER alone that keeps §6.6's "TP routes directly to Siham
        // & Alaa" true.
        label: "TP Operations",
        aliases: ["Operations"],
        companyId: null,
        orgUnitId: "t-ops",
      },
    ],
  },
  {
    id: "p-3",
    name: "Siham Al Hadhrami & Alaa Al Hinai",
    isDefault: true,
    members: [
      {
        name: "Siham Al Hadhrami",
        email: "Siham.Hadhrami@rihal.om",
        phone: "+968 9352 8698",
        photoKey: null,
        order: 1,
        createdAt: new Date("2026-01-01"),
      },
    ],
    coverage: [
      {
        label: "Transformation Pioneers (all)",
        aliases: ["TP"],
        companyId: "c-tp",
        orgUnitId: null,
      },
    ],
  },
  {
    // A pair with no members — configured but not staffed yet. It must never be
    // returned as an answer; naming nobody is worse than asking again.
    id: "p-empty",
    name: "Unstaffed Pair",
    isDefault: false,
    members: [],
    coverage: [
      {
        label: "Strategy Directorate (Rihal)",
        aliases: ["STR"],
        companyId: null,
        orgUnitId: "u-str",
      },
    ],
  },
];

let pairRows: FixturePair[] = PAIRS;

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        // HR Centre: core org delegates over the HIVE fixtures (ADR-079).
        ...orgDouble(COMPANIES, UNITS as Record<string, HiveUnit[]>),
        hrTagPair: {
          // Honour the query's nested `orderBy` for members. A mock that
          // returned them in fixture order would make ordering by `order` and
          // ordering by `createdAt` indistinguishable, and the test would pin
          // nothing.
          findMany: async ({ select }: { select: { members: { orderBy: unknown } } }) => {
            const by = select.members.orderBy;
            const keys = (Array.isArray(by) ? by : [by]).map(
              (o) => Object.keys(o as object)[0] as "order" | "createdAt",
            );
            return pairsToDb(pairRows).map((p) => ({
              ...p,
              members: [...p.members].sort((a, b) => {
                for (const k of keys) {
                  const d = k === "order" ? a.order - b.order : +a.createdAt - +b.createdAt;
                  if (d !== 0) return d;
                }
                return 0;
              }),
            }));
          },
        },
      },
    },
  });
  org = (await import(import.meta.resolve("../../lib/hive/tools/orgchart.ts"))) as Org;
  hrtags = (await import(import.meta.resolve("../../lib/hive/tools/hrtags.ts"))) as HrTags;
});

describe("§6.5 — the org chart is a drill-down, not a text dump", { skip: !canMock }, () => {
  test("with nothing said it asks which company", async () => {
    const result = await org.runOrgChart({}, CTX);
    assert.equal(result.status, "which_company");
    assert.deepEqual(result.options, [
      "Rihal",
      "Transformation Pioneers",
      "Codeline",
      "Newco Holdings",
      "Orphanage",
    ]);
  });

  test("a company returns only its TOP level, never the whole tree", async () => {
    const result = await org.runOrgChart({ company: "Rihal" }, CTX);
    assert.equal(result.status, "pick_unit");
    const names = (result.options as { unit: string }[]).map((o) => o.unit);
    assert.deepEqual(names, ["Operations", "Technology & Development", "Strategy"]);
    assert.ok(
      !names.includes("Software"),
      "REGRESSION: §6.5 says 'never one long text dump' — teams belong to the next level down",
    );
  });

  test("a company with no chart says so instead of guessing", async () => {
    // Derived from having no units, not from the name "Codeline" — §4.2's whole
    // premise is that a fourth company can be added without a developer.
    const result = await org.runOrgChart({ company: "Codeline" }, CTX);
    assert.equal(result.status, "no_chart");
    assert.match(String(result.detail), /do not guess/i);
    assert.match(String(result.detail), /HR Tag/, "§6.5 says direct them to their HR Tag");
  });

  test("a company Alaa adds tomorrow gets the same honest answer", async () => {
    // Nothing in the tool knows the word "Codeline". If it did, this would come
    // back as an empty top level or a crash rather than "no chart yet".
    const result = await org.runOrgChart({ company: "Newco Holdings" }, CTX);
    assert.equal(
      result.status,
      "no_chart",
      "REGRESSION: 'no chart yet' was derived from a company NAME, not from having no units",
    );
    assert.equal(result.company, "Newco Holdings");
  });

  test("drilling into a directorate returns its teams and its leader", async () => {
    const result = await org.runOrgChart(
      { company: "Rihal", unit: "Technology & Development" },
      CTX,
    );
    assert.equal(result.status, "ok");
    assert.equal(result.leader, "Ahmed Al Hasani");
    assert.deepEqual(result.teams, ["Software", "Support"]);
    assert.equal(result.parent, null);
  });

  test("a team knows what it sits under, so the model need not walk the tree", async () => {
    const result = await org.runOrgChart({ company: "Rihal", unit: "Software" }, CTX);
    assert.equal(result.parent, "Technology & Development");
    assert.deepEqual(result.teams, []);
  });

  test("TP's peer departments are peers, and no reporting line is exposed", async () => {
    // §6.5: "do not expose the structural/reporting-line distinction above;
    // that nuance is for correct internal data modeling, not for what the bot
    // says out loud."
    const result = await org.runOrgChart({ company: "Transformation Pioneers" }, CTX);
    const names = (result.options as { unit: string }[]).map((o) => o.unit);
    assert.deepEqual(names, ["Operations", "Project & Change Management"]);
    assert.doesNotMatch(JSON.stringify(result), /report/i, "no reporting line may reach the model");
    assert.match(String(result.detail), /Pioneers' departments/, "possessive, and the right noun");
  });

  test("what the employee SAYS beats §3.5's selector", async () => {
    // A Rihal employee asking what TP looks like must get TP, not their own
    // company answered confidently in its place.
    const result = await org.runOrgChart(
      { company: "Transformation Pioneers" },
      { ...CTX, companyId: "c-rihal" },
    );
    assert.equal(result.company, "Transformation Pioneers");
  });

  test("an unknown unit asks rather than resolving the closest name", async () => {
    const result = await org.runOrgChart({ company: "Rihal", unit: "Softwear" }, CTX);
    assert.equal(result.status, "unit_unknown");
    assert.match(String(result.detail), /rather than guessing/i);
  });
});

describe("§6.6 — HR Tag routing", { skip: !canMock }, () => {
  test("a card carries contact details and NOT what the pair covers", async () => {
    // §6.6: "Do NOT list which departments a pair covers on the card itself."
    const result = await hrtags.runHrTags({ directorate: "DevOps" }, CTX);
    assert.equal(result.status, "ok");
    assert.equal(result.pair, "Rahma Adam & Mohammed Al Amri");
    assert.equal(result.coverage, undefined);
    assert.doesNotMatch(
      JSON.stringify(result),
      /Directorate/,
      "REGRESSION: coverage labels leaked onto the card",
    );
  });

  test("a photo travels as a boolean, never as a blob key", async () => {
    const result = await hrtags.runHrTags({ company: "Codeline" }, CTX);
    const members = result.members as { name: string; hasPhoto: boolean }[];
    assert.equal(members.find((m) => m.name === "Afra Al Hooti")?.hasPhoto, true);
    assert.equal(members.find((m) => m.name === "Shahed Al Amri")?.hasPhoto, false);
    assert.doesNotMatch(JSON.stringify(result), /photos\//, "a blob key must not reach the model");
  });

  test("company-wide coverage beats a directorate alias — the TP/Operations trap", async () => {
    // "Operations" is an alias on Shahed & Afra's RIHAL Operations row. §6.6
    // says all of Transformation Pioneers routes to Siham & Alaa. Matching the
    // directorate first looks more responsive and sends a TP employee to the
    // pair that does not cover them.
    const result = await hrtags.runHrTags(
      { company: "Transformation Pioneers", directorate: "Operations" },
      CTX,
    );
    assert.equal(
      result.pair,
      "Siham Al Hadhrami & Alaa Al Hinai",
      "REGRESSION: a TP employee was routed by a Rihal directorate alias",
    );
    assert.equal(result.matchedOn, "company");
  });

  test("company-wide beats an in-company directorate row — order, not scoping", async () => {
    // "TP Operations" is linked to a TP unit and sits on Rahma's pair, so
    // company scoping cannot rule it out. §6.6 says all of Transformation
    // Pioneers routes to Siham & Alaa, so the wholesale step has to run first.
    const result = await hrtags.runHrTags(
      { company: "Transformation Pioneers", directorate: "Operations" },
      CTX,
    );
    assert.equal(
      result.pair,
      "Siham Al Hadhrami & Alaa Al Hinai",
      "REGRESSION: the directorate step ran before the company-wide step",
    );
    assert.equal(result.matchedOn, "company");
  });

  test("the same word still routes correctly for the company that DOES route by directorate", async () => {
    const result = await hrtags.runHrTags({ company: "Rihal", directorate: "Operations" }, CTX);
    assert.equal(result.pair, "Shahed Al Amri & Afra Al Hooti");
    assert.equal(result.matchedOn, "directorate");
  });

  test("§3.5's selector routes wholesale companies too", async () => {
    const result = await hrtags.runHrTags(
      { directorate: "Operations" },
      { ...CTX, companyId: "c-tp" },
    );
    assert.equal(result.pair, "Siham Al Hadhrami & Alaa Al Hinai");
  });

  test("Rihal alone asks for the directorate and names no pair yet", async () => {
    const result = await hrtags.runHrTags({ company: "Rihal" }, CTX);
    assert.equal(result.status, "which_directorate");
    assert.doesNotMatch(JSON.stringify(result.options), /Transformation/, "not another company's");
    assert.doesNotMatch(
      String(result.detail) + JSON.stringify(result.options),
      /Shahed|Rahma|Siham/,
      "naming a pair before the directorate is known is a guess",
    );
  });

  test("an unstaffed pair is never the answer", async () => {
    // Configured coverage, no members. Naming nobody is worse than asking.
    const result = await hrtags.runHrTags({ directorate: "STR" }, CTX);
    assert.notEqual(result.status, "ok");
    assert.doesNotMatch(JSON.stringify(result), /Unstaffed Pair/);
  });

  test("an alias covered by two pairs asks instead of picking one", async () => {
    // Coverage is admin-editable (§4.2), so this is a configuration Alaa can
    // create. Silently taking whichever sorts first routes a question to two
    // people who do not handle it.
    pairRows = [
      PAIRS[0],
      { ...PAIRS[1], coverage: [{ ...PAIRS[1].coverage[0], aliases: ["Legal"] }] },
    ];
    try {
      const result = await hrtags.runHrTags({ directorate: "Legal" }, CTX);
      assert.equal(result.status, "ambiguous_directorate");
      assert.equal((result.options as unknown[]).length, 2);
      assert.match(String(result.detail), /do not pick one/i);
    } finally {
      pairRows = PAIRS;
    }
  });

  test("an unknown directorate asks, and never says 'contact HR'", async () => {
    // AC-1.5: escalation must name the employee's specific pair, never a
    // generic "contact HR".
    const result = await hrtags.runHrTags({ directorate: "Wizarding" }, CTX);
    assert.equal(result.status, "directorate_unknown");
    assert.ok((result.options as unknown[]).length > 0, "it has to offer the real vocabulary");
  });

  test("with no pairs staffed at all it reports that, rather than inventing one", async () => {
    pairRows = [PAIRS[3]];
    try {
      const result = await hrtags.runHrTags({ directorate: "STR" }, CTX);
      assert.equal(result.error, "no_hr_tags");
    } finally {
      pairRows = PAIRS;
    }
  });
});

describe("§6.5/§6.6 — a named company resolves by name or not at all", { skip: !canMock }, () => {
  test("org chart: a typo'd company does not become the selector's company", async () => {
    // The `??` fallback turned a typo into a confident answer about a different
    // company, and made the "not one of the companies" message unreachable for
    // anyone who had used §3.5's selector.
    const result = await org.runOrgChart({ company: "Codelien" }, { ...CTX, companyId: "c-rihal" });
    assert.equal(
      result.status,
      "which_company",
      "REGRESSION: an unrecognised company name silently fell back to the selector",
    );
    assert.notEqual(result.company, "Rihal");
  });

  test("hr tags: same, and the company_unknown branch is reachable", async () => {
    const result = await hrtags.runHrTags(
      { company: "Codelien" },
      { ...CTX, companyId: "c-rihal" },
    );
    assert.equal(result.status, "company_unknown");
  });

  test("the selector still answers when they named nothing", async () => {
    const result = await org.runOrgChart({}, { ...CTX, companyId: "c-rihal" });
    assert.equal(result.company, "Rihal");
  });
});

describe("§6.5 — a chart with no top level is no chart", { skip: !canMock }, () => {
  test("orphaned children do not become an empty options list", async () => {
    // HIVE: deleting a directorate left its teams with a dangling `parentId`,
    // and the tool answered `pick_unit` with nothing to pick. In HR Centre's
    // core org a department whose directorate was retired is still a real
    // department with people in it, so it surfaces at the TOP level instead —
    // never an empty list, and never unreachable (ADR-079).
    const result = await org.runOrgChart({ company: "Orphanage" }, CTX);
    assert.equal(result.status, "pick_unit");
    assert.ok(
      Array.isArray(result.options) && result.options.length > 0,
      "REGRESSION: an orphaned unit left an empty options list",
    );
  });

  test("two units of the same name ask instead of answering under the wrong one", async () => {
    const result = await org.runOrgChart({ company: "Rihal", unit: "Support" }, CTX);
    assert.equal(result.status, "ambiguous_unit");
    const under = (result.options as { under: string }[]).map((o) => o.under);
    assert.deepEqual(under.sort(), ["Operations", "Technology & Development"]);
    assert.match(String(result.detail), /do not pick one/i);
  });
});

describe("§6.6 — coverage the tool can attribute to a company", { skip: !canMock }, () => {
  test("a company with no coverage is told so, not offered Rihal's directorates", async () => {
    // Every Rihal coverage row has `companyId: null`. Offering rows on that
    // basis handed a new company's employee "Operations Directorate (Rihal)"
    // and routed them to a Rihal pair.
    const result = await hrtags.runHrTags({ company: "Newco Holdings" }, CTX);
    assert.equal(result.status, "no_coverage");
    assert.doesNotMatch(JSON.stringify(result), /Rihal/, "another company's labels must not leak");
    assert.doesNotMatch(JSON.stringify(result), /Shahed|Rahma|Siham/, "and no pair is named");
  });

  test("the §3.5 selector's directorate answers without asking again", async () => {
    const result = await hrtags.runHrTags({}, { ...CTX, orgUnitId: "u-tech" });
    assert.equal(result.status, "ok");
    assert.equal(result.matchedOn, "selector");
    assert.equal(result.pair, "Rahma Adam & Mohammed Al Amri");
  });

  test("an unstaffed pair's directorate is still listed as a real one", async () => {
    // Hiding it tells an employee their own directorate does not exist.
    const result = await hrtags.runHrTags({ directorate: "Wizarding" }, CTX);
    assert.equal(result.status, "directorate_unknown");
    assert.ok(
      (result.options as string[]).includes("Strategy Directorate (Rihal)"),
      "REGRESSION: a directorate vanished from the list because its pair is unstaffed",
    );
  });

  test("a member with no phone does not put null on the card", async () => {
    pairRows = [{ ...PAIRS[1], members: [{ ...PAIRS[1].members[0], phone: null }] }];
    try {
      const result = await hrtags.runHrTags({ directorate: "DevOps" }, CTX);
      const members = result.members as { phone: string | null }[];
      assert.equal(members[0].phone, null, "null is what the column holds");
      assert.doesNotMatch(
        String(result.detail ?? ""),
        /null/,
        "and it must not be narrated as text",
      );
    } finally {
      pairRows = PAIRS;
    }
  });

  test("members come back in the curated order, not insertion order", async () => {
    const result = await hrtags.runHrTags({ company: "Codeline" }, CTX);
    const names = (result.members as { name: string }[]).map((m) => m.name);
    assert.deepEqual(
      names,
      ["Afra Al Hooti", "Shahed Al Amri"],
      "REGRESSION: members came back in insertion order, ignoring HR's curated `order`",
    );
  });
});

describe("§4.4's binding note — three structures, never one table", { skip: !canMock }, () => {
  test("the org chart never answers from HR Tag coverage", async () => {
    // "Technology & Development Directorate" is an HrTagCoverage label. It is
    // NOT an OrgUnit name (the unit is "Technology & Development"), so a tool
    // that fell back to coverage labels would resolve it — and that fallback is
    // the collapse §4.4 forbids.
    const result = await org.runOrgChart(
      { company: "Rihal", unit: "Technology & Development Directorate" },
      CTX,
    );
    assert.equal(
      result.status,
      "unit_unknown",
      "REGRESSION: the org chart resolved an HR Tag label — the three structures were collapsed",
    );
  });

  test("HR Tag routing never answers from an OrgUnit name", async () => {
    // "Software" is an OrgUnit under Technology & Development AND an alias on
    // Rahma's coverage row. It must resolve through the COVERAGE row: the two
    // are independently editable, and renaming the unit must not move routing.
    const viaCoverage = await hrtags.runHrTags({ directorate: "Software" }, CTX);
    assert.equal(viaCoverage.pair, "Rahma Adam & Mohammed Al Amri");

    // "Project & Change Management" is a real TP OrgUnit with NO coverage row.
    // Resolving it would mean routing came from the org chart.
    const viaOrgOnly = await hrtags.runHrTags({ directorate: "Project & Change Management" }, CTX);
    assert.notEqual(
      viaOrgOnly.status,
      "ok",
      "REGRESSION: an org-chart name resolved an HR pair — routing must come from coverage",
    );
  });
});
