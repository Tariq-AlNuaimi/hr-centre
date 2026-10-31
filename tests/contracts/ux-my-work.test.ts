import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROVIDER_LIMIT,
  byDue,
  collectWorkItems,
  dueGroup,
  type WorkItem,
  type WorkProvider,
} from "../../lib/core/work-items";

/** UX review P0 (docs/blueprints/ux-p0.md, US-1): one "My work" list on Home. */

const src = (p: string) => readFileSync(p, "utf8");
const NOW = Date.parse("2026-10-27T12:00:00Z");
const item = (key: string, dueAt: string | null): WorkItem => ({
  key,
  module: "hiring",
  kind: "hiringScorecard",
  params: { name: "X" },
  dueAt,
  href: "/hiring",
});

test("items group Overdue / This week / Later (no deadline goes to Later)", () => {
  assert.equal(dueGroup("2026-10-26T00:00:00Z", NOW), "overdue");
  assert.equal(dueGroup("2026-10-30T00:00:00Z", NOW), "thisWeek");
  assert.equal(dueGroup("2026-11-20T00:00:00Z", NOW), "later");
  assert.equal(dueGroup(null, NOW), "later");
  assert.equal(dueGroup("not a date", NOW), "later");
});

test("earliest due first, undated last", () => {
  const sorted = [item("c", null), item("b", "2026-11-01"), item("a", "2026-10-01")].sort(byDue);
  assert.deepEqual(
    sorted.map((i) => i.key),
    ["a", "b", "c"],
  );
});

test("a failing provider is named, not dropped; each provider is capped", async () => {
  const many: WorkProvider = {
    module: "hiring",
    collect: async () => ({
      items: Array.from({ length: 30 }, (_, i) => item(`h${i}`, null)),
      total: 30,
    }),
  };
  const broken: WorkProvider = {
    module: "jml",
    collect: async () => {
      throw new Error("boom");
    },
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const r = await collectWorkItems({ user: { id: "u1" } } as never, [many, broken]);
    assert.deepEqual(r.failed, ["jml"]);
    assert.equal(r.items.length, PROVIDER_LIMIT);
    assert.equal(r.totals.hiring, 30, "the true total is kept so the UI can say it is capped");
  } finally {
    console.warn = warn;
  }
});

test("the route is authenticated, rate-limited, takes no viewer parameter, and wires every module", () => {
  const route = src("app/api/work-items/route.ts");
  assert.match(route, /withRateLimit\(\s*withAuth\(/);
  assert.match(route, /collectWorkItems\(session, PROVIDERS\)/);
  for (const p of ["jmlWorkProvider", "hiringWorkProvider", "ticketWorkProvider"]) {
    assert.match(route, new RegExp(`\\b${p}\\b`));
  }
});

test("providers apply their module's own permission rules", () => {
  const jml = src("lib/jml/work-items.ts");
  // Task routing: owned tasks plus the desk / line-manager tasks routed to the viewer.
  assert.match(jml, /await myTaskWhere\(actor\)/, "tasks: assignment (own + routed) is the filter");
  assert.match(
    src("lib/jml/routing/worker.ts"),
    /\{ OR: \[\{ ownerUserId: actor\.userId \}, routed\] \}/,
  );
  assert.match(jml, /caseScopeWhere\(actor, "jml\.decideApprovals"\)/, "approvals: in scope only");
  const hiring = src("lib/hiring/work-items.ts");
  assert.match(hiring, /requisitionScopeWhere\(actor, "hiring\.view"\)/);
  assert.match(hiring, /requisitionRefusal\(actor, delegators, round/);
  assert.match(hiring, /offerDecisionRefusal\(/);
  assert.match(hiring, /panelists: \{ some: \{ userId: actor\.userId \} \}/);
  assert.match(src("lib/hive/services/work-items.ts"), /ticketTasksFor\(session\.user\.id\)/);
  assert.match(src("lib/hive/services/work-items.ts"), /shortPreview\(r\.question\)/);
});

test("every item kind a provider emits has a sentence in both bundles", () => {
  const kinds = new Set<string>();
  for (const f of ["lib/jml/work-items.ts", "lib/hiring/work-items.ts"]) {
    for (const m of src(f).matchAll(/kind: "([a-zA-Z]+)",/g)) kinds.add(m[1]);
  }
  for (const m of src("lib/hive/services/work-items.ts").matchAll(/row\("([a-zA-Z]+)"/g))
    kinds.add(m[1]);
  assert.ok(kinds.size >= 9, `found ${[...kinds].join(", ")}`);
  for (const loc of ["en", "ar"]) {
    const m = JSON.parse(src(`messages/${loc}.json`)) as { work: { kind: Record<string, string> } };
    for (const k of kinds) assert.ok(m.work.kind[k], `${loc}: work.kind.${k}`);
  }
});

test("Home renders the one list, and the subtitle claims only what it lists", () => {
  const home = src("app/[locale]/(dashboard)/page.tsx");
  assert.match(home, /<MyWork \/>/);
  assert.doesNotMatch(home, /TicketTasks/);
  const en = JSON.parse(src("messages/en.json")) as { work: Record<string, unknown> };
  assert.match(String(en.work.subtitle), /performance, joiners and leavers, hiring and HR tickets/);
  const ui = src("components/home/MyWork.tsx");
  assert.match(ui, /row\.blocked \? null :/, "a blocked task has no action button");
  assert.match(ui, /t\("failed"/, "a failed module is named");
});
