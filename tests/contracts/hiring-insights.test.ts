import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  acceptanceRate,
  avgDays,
  FUNNEL_STAGES,
  MIN_CELL,
  pct,
  suppressSmallCells,
  WITHHELD,
} from "../../lib/hiring/analytics-rules";
import { generalSettingsSchema } from "../../lib/validations/hiring/ai";

const read = (f: string) => readFileSync(f, "utf8");

test("DEI: no bucket under five is ever shown on its own", () => {
  const out = suppressSmallCells([
    { value: "A", count: 12 },
    { value: "B", count: 4 },
    { value: "C", count: 1 },
    { value: "D", count: 5 },
  ]);
  assert.equal(MIN_CELL, 5);
  assert.deepEqual(out, [
    { value: "A", count: 12 },
    { value: "D", count: 5 },
    { value: WITHHELD, count: 5 },
  ]);
  for (const r of out) if (r.value !== WITHHELD) assert.ok(r.count >= MIN_CELL);
  assert.deepEqual(suppressSmallCells([]), []);
});

test("averages and rates are honest about nothing to average", () => {
  assert.equal(avgDays([]), null);
  assert.equal(avgDays([86_400_000 * 10, 86_400_000 * 20]), 15);
  assert.equal(avgDays([-5]), null);
  assert.equal(pct(1, 0), null);
  assert.equal(pct(2, 3), 66.7);
  assert.equal(acceptanceRate(0, 0), null);
  assert.equal(acceptanceRate(3, 1), 75);
  assert.equal(FUNNEL_STAGES.at(-1), "HIRED");
  assert.ok(!(FUNNEL_STAGES as readonly string[]).includes("REJECTED"));
});

test("D12: every insight is built from the reader's scope; Omanization needs manage, DEI needs viewDei", () => {
  const src = read("lib/hiring/analytics.ts");
  assert.match(src, /requisitionScopeWhere\(actor, permission\)/);
  assert.match(src, /scopes\(actor, "hiring\.view"\)/);
  assert.match(src, /scopes\(actor, "hiring\.manage"\)/);
  assert.match(src, /holdsAnywhere\(actor, "hiring\.viewDei"\)/);
  assert.match(src, /suppressSmallCells/);
  assert.doesNotMatch(src, /salary|Enc\b|email|phone/i);
});

test("D6: erasure covers what Interview Hub left behind, and redacts the audit values", () => {
  const src = read("lib/hiring/erasure.ts");
  for (const f of [
    "salaryExpectationEnc: null",
    "necEnc: null",
    "preferredNote: null",
    "stallNote: null",
    "agencySubmissionNote: null",
    "packageDeclinedReason: null",
    "cvBlobPathname: null",
    "deiGender: null",
    "profileData: Prisma.DbNull",
    "hiringNegotiationNote.delete",
    "hiringCandidateDocument.delete",
    "termsSnapshotEnc: ERASED",
    "salaryEnc: null",
    "hiringAiInsight.delete",
    "deleteStoredFile(f)",
    "auditLog.updateMany",
  ]) {
    assert.ok(src.includes(f), f);
  }
  assert.match(src, /employeeId[\s\S]*409/);
});

test("retention cron: internal wrapper, bearer CRON_SECRET, silent when unset, scheduled daily", () => {
  const route = read("app/api/internal/hiring-retention/route.ts");
  assert.match(
    route,
    /withInternalAuth\("CRON_SECRET", sweep, \{ bearer: true, skipWhenUnconfigured: true \}\)/,
  );
  const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
  assert.ok(vercel.crons.some((c) => c.path === "/api/internal/hiring-retention"));
  assert.match(read("lib/hiring/retention.ts"), /employeeId: null/);
});

test("DSAR is org-wide erase rights only, no-store", () => {
  const src = read("app/api/hiring/candidates/[id]/dsar/route.ts");
  assert.equal((src.match(/canErase\(actor\)/g) ?? []).length, 2);
  assert.match(src, /no-store/);
  assert.match(read("lib/hiring/access.ts"), /hasGroup\(actor\.grants, "hiring\.erase"\)/);
});

test("Tawteen targets are whole percents per company", () => {
  assert.ok(
    generalSettingsSchema.safeParse({ section: "tawteen", value: { targets: { RIHAL: 60 } } })
      .success,
  );
  assert.equal(
    generalSettingsSchema.safeParse({ section: "tawteen", value: { targets: { RIHAL: 101 } } })
      .success,
    false,
  );
  assert.equal(
    generalSettingsSchema.safeParse({ section: "tawteen", value: { targets: { RIHAL: 60.5 } } })
      .success,
    false,
  );
});
