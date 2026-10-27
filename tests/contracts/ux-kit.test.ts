import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { formatZonedDay } from "../../lib/format";

/** UX P1 phase 10 (docs/blueprints/ux-p1-kit.md): one filter kit, one table, one date style. */

const LIST_SCREENS = [
  "components/hiring/candidates/CandidateList.tsx",
  "components/hiring/requisitions/RequisitionList.tsx",
  "components/hiring/interviews/InterviewList.tsx",
  "components/hiring/offers/OfferList.tsx",
  "components/hiring/evaluations/EvaluationList.tsx",
  "components/hiring/requisitions/ScreeningView.tsx",
  "components/hiring/offers/CloseOutView.tsx",
  "components/hiring/pipeline/PipelineView.tsx",
  "components/jml/joiners/JoinerList.tsx",
  "components/jml/watch/CalendarScreen.tsx",
  "components/jml/watch/StatutoryScreen.tsx",
  "components/jml/dashboard/MyTasksScreen.tsx",
  "components/jml/dashboard/JmlDashboard.tsx",
];

test("list-screen filters use the shared kit, never a bare native select", () => {
  for (const f of LIST_SCREENS) {
    const src = readFileSync(f, "utf8");
    assert.ok(!src.includes("NativeSelect"), `${f} still filters with NativeSelect`);
    assert.match(src, /from "@\/components\/shared\/FilterBar"/, `${f} must use the shared kit`);
  }
});

test("one chip component: the hiring-private copy is gone", () => {
  assert.equal(existsSync("components/hiring/candidates/FilterChips.tsx"), false);
});

test("the offers list is the shared DataTable", () => {
  const src = readFileSync("components/hiring/offers/OfferList.tsx", "utf8");
  assert.match(src, /<DataTable<OfferListRow>/);
  assert.ok(!src.includes("<table"));
});

test("a Muscat start date is shown as its own day, in the shared medium style", () => {
  // 2026-12-01 00:00 in Muscat is 2026-11-30T20:00Z.
  const shown = formatZonedDay("2026-11-30T20:00:00.000Z");
  assert.match(shown, /1/);
  assert.ok(!shown.includes("30"), shown);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(shown), "not an ISO date");
  for (const f of [
    "components/hiring/EmployeeHiringTab.tsx",
    "components/jml/settings/EmployeeCodeSettings.tsx",
  ]) {
    assert.ok(!/toLocaleString\(\)|new Intl\.DateTimeFormat/.test(readFileSync(f, "utf8")), f);
  }
});
