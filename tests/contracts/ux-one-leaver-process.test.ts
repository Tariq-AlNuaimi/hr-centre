import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { markLeaverSchema, recordTransferSchema } from "../../lib/validations/edge-cases";
import { prefilledEmployee } from "../../components/jml/prefill";

/**
 * UX review P0 (docs/blueprints/ux-p0.md, US-2): one leaver / mover process.
 * The record and Performance's page open a Joiners & leavers case; the direct
 * routes are an HR Super Admin correction that must state why.
 */

const src = (p: string) => readFileSync(p, "utf8");

test("the direct routes refuse a departure or transfer without a stated reason", () => {
  const leaver = { employeeId: "e1", lastWorkingDay: "2026-10-01" };
  assert.equal(markLeaverSchema.safeParse(leaver).success, false);
  assert.equal(markLeaverSchema.safeParse({ ...leaver, bypassReason: "too short" }).success, false);
  assert.equal(
    markLeaverSchema.safeParse({ ...leaver, bypassReason: "Historical leaver from 2025" }).success,
    true,
  );
  const transfer = {
    employeeId: "e1",
    cycleId: "c1",
    transferDate: "2026-06-01",
    newDepartmentId: "d1",
  };
  assert.equal(recordTransferSchema.safeParse(transfer).success, false);
  assert.equal(
    recordTransferSchema.safeParse({
      ...transfer,
      bypassReason: "Import put them in the wrong team",
    }).success,
    true,
  );
});

test("only an HR Super Admin may use them, and the reason reaches the audit row", () => {
  const leavers = src("app/api/leavers/route.ts");
  const post = leavers.slice(
    leavers.indexOf("export const POST"),
    leavers.indexOf("export const GET"),
  );
  assert.match(post, /if \(!isHrSuperAdmin\(actor\)\)/);
  assert.match(post, /note: `Recorded without the exit process: \$\{bypassReason\}/);
  const transfers = src("app/api/transfers/route.ts");
  assert.match(transfers, /if \(!isHrSuperAdmin\(actor\)\)/);
  assert.match(transfers, /note: `Recorded without the mover process: \$\{bypassReason\}`/);
  assert.match(src("lib/pms/transfer-apply.ts"), /\.\.\.\(p\.note \? \{ note: p\.note \} : \{\}\)/);
});

test("the person record opens a pre-filled leaver case; the direct path is admin-only", () => {
  const page = src("app/[locale]/(dashboard)/people/[id]/page.tsx");
  assert.match(page, /\/jml\/leavers\/new\?/);
  assert.match(page, /canFor\(actor, "jml\.manageLeavers", subject\)/);
  // UX P1 R10: the direct path is the Actions menu's separated correction, HR Super Admin only.
  assert.match(page, /departure:\s*isHrSuperAdmin\(actor\)/);
  assert.match(
    src("components/people/RecordActions.tsx"),
    /\{departure \? \(\s*<RecordDepartureDialog/,
  );
});

test("Performance's page starts JML cases and keeps the recorders behind the admin gate", () => {
  const page = src("app/[locale]/(dashboard)/admin/edge-cases/page.tsx");
  assert.match(page, /\/jml\/leavers\/new/);
  assert.match(page, /\/jml\/movers\/new/);
  const gate = page.indexOf("capabilities.configure ? (");
  assert.ok(gate > 0 && page.indexOf("<LeaverRecorder") > gate, "recorder only inside the gate");
  const en = JSON.parse(src("messages/en.json")) as { nav: Record<string, string> };
  assert.equal(en.nav.edgeCases, "Roll-ups & split years");
});

test("closing a JML leaver case still applies the Performance consequences", () => {
  assert.match(src("lib/jml/leave/closure.ts"), /applyLeaverDeparture/);
  assert.match(src("lib/jml/leave/departure.ts"), /applyDeparture\(tx,/);
  assert.match(src("lib/jml/move/apply.ts"), /splitAndMove\(tx,/);
});

test("a pre-filled employee is read defensively", () => {
  assert.deepEqual(prefilledEmployee({ employeeId: "abc_1", name: "Noura" }), {
    id: "abc_1",
    name: "Noura",
  });
  assert.equal(prefilledEmployee({}), null);
  assert.equal(prefilledEmployee({ employeeId: ["a", "b"] }), null);
  assert.equal(prefilledEmployee({ employeeId: "x'; drop" }), null);
  assert.deepEqual(prefilledEmployee({ employeeId: "e1" }), { id: "e1", name: "e1" });
});
