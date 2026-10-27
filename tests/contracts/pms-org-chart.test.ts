import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildOrgChart, type OrgNode } from "../../lib/pms/org-chart";
import { matchOrgChart } from "../../lib/pms/org-chart-search";

/**
 * §4.2's reporting tree, arranged as an org chart.
 *
 * The shape this replaces was one recursive indented list of everyone, and its
 * only test was rendering it and looking. These pin the arrangement itself —
 * especially the cases a spreadsheet-fed org actually produces: a line that
 * crosses a department, a C-Level with no department, and a manager cycle.
 */

const person = (over: Partial<OrgNode> & { id: string; name: string }): OrgNode => ({
  roleTrack: "INDIVIDUAL",
  status: "ACTIVE",
  managerId: null,
  department: { id: "d1", name: "Engineering" },
  entity: { id: "e1", code: "RIHAL" },
  ...over,
});

test("entity, then department, then the reporting line inside it", () => {
  const chart = buildOrgChart([
    person({ id: "head", name: "Dept Head", roleTrack: "DIRECTOR" }),
    person({ id: "a", name: "Alice", managerId: "head" }),
    person({ id: "b", name: "Bob", managerId: "head" }),
    person({ id: "c", name: "Carol", managerId: "a" }),
  ]);

  assert.equal(chart.length, 1);
  assert.equal(chart[0].code, "RIHAL");
  assert.equal(chart[0].headcount, 4);
  assert.equal(chart[0].departments.length, 1);

  const dept = chart[0].departments[0];
  assert.equal(dept.name, "Engineering");
  assert.equal(dept.headcount, 4);
  assert.equal(dept.tops.length, 1, "only the person whose manager is outside is a top");
  assert.equal(dept.tops[0].name, "Dept Head");
  assert.deepEqual(
    dept.tops[0].reports.map((r) => r.name),
    ["Alice", "Bob"],
    "reports sort by name",
  );
  assert.deepEqual(
    dept.tops[0].reports[0].reports.map((r) => r.name),
    ["Carol"],
  );
  assert.equal(dept.tops[0].descendantCount, 3, "everyone beneath, at any depth");
});

test("a line that crosses a department is NAMED, not dropped", () => {
  // §12.1's roll-up and §12.3's transfer both produce this, so it is the normal
  // case rather than a corner. The old shape nested the report under their
  // manager and told the reader the wrong department.
  const chart = buildOrgChart([
    person({ id: "cto", name: "Cto", roleTrack: "C_LEVEL", department: null }),
    person({
      id: "mgr",
      name: "Finance Lead",
      managerId: "cto",
      department: { id: "d2", name: "Finance" },
    }),
    // Reports to the Finance Lead but sits in Engineering.
    person({ id: "eng", name: "Engineer", managerId: "mgr" }),
  ]);

  const [entity] = chart;
  const engineering = entity.departments.find((d) => d.name === "Engineering");
  assert.ok(engineering, "they appear under their OWN department");
  assert.equal(engineering.tops.length, 1);
  assert.equal(engineering.tops[0].name, "Engineer");
  assert.equal(
    engineering.tops[0].reportsToName,
    "Finance Lead",
    "the crossing is stated on the row",
  );

  const finance = entity.departments.find((d) => d.name === "Finance");
  assert.equal(finance?.tops[0].reports.length, 0, "and NOT nested under the manager");
});

test("a report in the same department carries no crossing note", () => {
  const chart = buildOrgChart([
    person({ id: "head", name: "Head" }),
    person({ id: "a", name: "Alice", managerId: "head" }),
  ]);
  assert.equal(chart[0].departments[0].tops[0].reports[0].reportsToName, null);
});

test("§1.2 the C-Level group comes first and is its own group", () => {
  const chart = buildOrgChart([
    person({ id: "z", name: "Zara", department: { id: "d9", name: "Zoology" } }),
    person({ id: "a", name: "Aaron", department: { id: "d1", name: "Accounts" } }),
    person({ id: "ceo", name: "Ceo", roleTrack: "C_LEVEL", department: null }),
  ]);

  const names = chart[0].departments.map((d) => d.name);
  assert.deepEqual(names, [null, "Accounts", "Zoology"], "C-Level first, then alphabetical");
  assert.equal(chart[0].departments[0].id, null);
  assert.equal(chart[0].departments[0].tops[0].name, "Ceo");
});

test("entities are separate groups, sorted by code", () => {
  const chart = buildOrgChart([
    person({ id: "b", name: "Bee", entity: { id: "e2", code: "ZED" } }),
    person({ id: "a", name: "Ay", entity: { id: "e1", code: "ALPHA" } }),
  ]);
  assert.deepEqual(
    chart.map((e) => e.code),
    ["ALPHA", "ZED"],
  );
  assert.equal(chart[0].headcount, 1);
});

test("the same department name in two entities stays two groups", () => {
  // Grouped by entity AND department id, or two unrelated Engineering teams
  // merge into one line that reports to nobody sensible.
  const chart = buildOrgChart([
    person({ id: "a", name: "Ay", entity: { id: "e1", code: "ALPHA" } }),
    person({
      id: "b",
      name: "Bee",
      entity: { id: "e2", code: "ZED" },
      department: { id: "d2", name: "Engineering" },
    }),
  ]);
  assert.equal(chart.length, 2);
  assert.equal(chart[0].departments.length, 1);
  assert.equal(chart[1].departments.length, 1);
});

test("a manager outside the visible set makes their report a top", () => {
  // A manager viewing their own subtree: their own manager is not visible, and
  // they must still appear rather than vanishing for lack of a parent.
  const chart = buildOrgChart([person({ id: "me", name: "Me", managerId: "invisible-boss" })]);
  assert.equal(chart[0].departments[0].tops[0].name, "Me");
  assert.equal(
    chart[0].departments[0].tops[0].reportsToName,
    null,
    "a manager we cannot see is not named — §4.2 scoping is not leaked",
  );
});

test("a manager cycle truncates the branch instead of hanging the page", () => {
  // Nothing in the database prevents A -> B -> A: the manager edge is a plain
  // self-relation and the import writes it from a spreadsheet. An infinite
  // recursion would take out the whole page, not one row.
  const chart = buildOrgChart([
    person({ id: "a", name: "Ay", managerId: "b" }),
    person({ id: "b", name: "Bee", managerId: "a" }),
  ]);
  const rendered: string[] = [];
  const walk = (p: { name: string; reports: { name: string; reports: unknown[] }[] }) => {
    rendered.push(p.name);
    for (const r of p.reports) walk(r as never);
  };
  for (const top of chart[0].departments[0].tops) walk(top as never);
  assert.ok(rendered.length > 0, "something renders");
  assert.ok(rendered.length < 10, "and it terminates");
});

test("a leaver's status reaches the row", () => {
  const chart = buildOrgChart([person({ id: "x", name: "Ex", status: "LEAVER" })]);
  assert.equal(chart[0].departments[0].tops[0].status, "LEAVER");
  assert.equal(chart[0].departments[0].tops[0].roleTrack, "INDIVIDUAL");
});

test("an empty set produces no entities, not an empty shell", () => {
  assert.deepEqual(buildOrgChart([]), []);
});

test("search returns the matches AND the path to them", () => {
  // A match six levels down is useless if its branch is collapsed, so the
  // ancestors come back with it and one pass drives both the filter and the
  // expansion.
  const chart = buildOrgChart([
    person({ id: "head", name: "Head" }),
    person({ id: "a", name: "Alice", managerId: "head" }),
    person({ id: "c", name: "Carol", managerId: "a" }),
    person({ id: "b", name: "Bob", managerId: "head" }),
  ]);

  const { matched, onPath } = matchOrgChart(chart, "carol");
  assert.deepEqual([...matched], ["c"]);
  assert.ok(onPath.has("head"), "the department head is on the path");
  assert.ok(onPath.has("a"), "and so is Alice");
  assert.ok(onPath.has("e1"), "the entity opens");
  assert.ok(onPath.has("e1::d1"), "and the department opens");
  assert.ok(!onPath.has("b"), "an unrelated branch stays shut");
});

test("search is case-insensitive and matches a fragment", () => {
  const chart = buildOrgChart([person({ id: "a", name: "Aisha Al Rawahi" })]);
  assert.equal(matchOrgChart(chart, "RAWAHI").matched.size, 1);
  assert.equal(matchOrgChart(chart, "aisha").matched.size, 1);
  assert.equal(matchOrgChart(chart, "nobody").matched.size, 0);
});

test("an empty search matches nothing, so the chart renders whole", () => {
  const chart = buildOrgChart([person({ id: "a", name: "Ay" })]);
  for (const q of ["", "   "]) {
    const { matched, onPath } = matchOrgChart(chart, q);
    assert.equal(matched.size, 0);
    assert.equal(onPath.size, 0);
  }
});

// ---------------------------------------------------------------------------
// The half that rots: that the page actually uses this, and keeps its rules.
// ---------------------------------------------------------------------------

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the page keeps §4.2's scoping and carries no compensation column", () => {
  const page = stripComments(readFileSync("app/[locale]/(dashboard)/org/page.tsx", "utf8"));
  assert.match(page, /visibleEmployeeIds\(/, "visibility is unchanged");
  assert.match(page, /ORG_TREE_NODE_SELECT/, "and so is the column set");
  assert.match(page, /buildOrgChart\(/, "the page uses the shared arrangement");
  assert.doesNotMatch(page, /basicSalary/);
});

test("binned people are hidden by the soft-delete extension, not by a hand filter", () => {
  // `Employee` is in SOFT_DELETE_MODELS, so every read through `prisma`
  // already injects `deletedAt: null`. A hand-written filter here would be a
  // second answer to a question the extension already answers — and the one
  // that goes stale.
  const ext = readFileSync("lib/prisma/soft-delete-extension.ts", "utf8");
  assert.match(ext, /SOFT_DELETE_MODELS = new Set\(\[[^\]]*"Employee"/);
  const page = stripComments(readFileSync("app/[locale]/(dashboard)/org/page.tsx", "utf8"));
  assert.doesNotMatch(page, /deletedAt/, "the page must not re-filter");
  assert.doesNotMatch(page, /prismaUnfiltered/, "and must not bypass the extension");
});

test("every chart string exists in both locales", () => {
  const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
  const ar = JSON.parse(readFileSync("messages/ar.json", "utf8"));
  const keys = Object.keys(en.pms.org);
  assert.ok(keys.includes("search"), "the search box is labelled");
  for (const key of keys) {
    assert.ok(ar.pms.org[key] !== undefined, `ar is missing pms.org.${key}`);
  }
});
