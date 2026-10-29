import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { feedOwnerWhere } from "../../lib/core/notify/store";
import { PREVIEW_CHARS, shortPreview } from "../../lib/core/notify/user-notify";

/**
 * UX review P0 (docs/blueprints/ux-p0.md, US-6): bell notices for Hiring and
 * HR tickets, addressed to a login, carrying no Restricted data.
 */

const src = (p: string) => readFileSync(p, "utf8");

test("the feed is the viewer's own: employee record and login, from the session only", () => {
  assert.deepEqual(feedOwnerWhere("e1", "u1"), {
    OR: [{ recipientEmployeeId: "e1" }, { recipientUserId: "u1" }],
  });
  assert.deepEqual(feedOwnerWhere(null, "u1"), { recipientUserId: "u1" });
  for (const f of [
    "app/api/notifications/route.ts",
    "app/api/notifications/read/route.ts",
    "app/api/notifications/dismiss/route.ts",
  ]) {
    assert.match(src(f), /feedOwnerWhere\(actor\.employeeId, session\.user\.id\)/, f);
    assert.doesNotMatch(src(f), /recipientEmployeeId: actor\.employeeId/, f);
  }
});

test("a notification has exactly one recipient (database CHECK)", () => {
  const dir = readdirSync("prisma/migrations").find((d) => d.endsWith("_ux_p0_user_notifications"));
  assert.ok(dir, "migration exists");
  const sql = src(`prisma/migrations/${dir}/migration.sql`);
  assert.match(
    sql,
    /CHECK \(\("recipient_employee_id" IS NULL\) <> \("recipient_user_id" IS NULL\)\)/,
  );
  assert.doesNotMatch(sql, /DROP TABLE|DROP INDEX|DROP CONSTRAINT/, "no unrelated drift");
});

test("a ticket question is previewed, never quoted in full", () => {
  const long = "word ".repeat(100);
  const p = shortPreview(long);
  assert.ok(p.length <= PREVIEW_CHARS);
  assert.ok(p.endsWith("…"));
  assert.equal(shortPreview("  short\nquestion "), "short question");
  const notify = src("lib/hive/services/ticket-notify.ts");
  const body = notify.slice(
    notify.indexOf("function inAppBody"),
    notify.indexOf("/** The message for one hand-off"),
  );
  assert.match(body, /shortPreview\(t\.question\)/);
  assert.doesNotMatch(body.replace("shortPreview(t.question)", ""), /t\.question/);
});

test("no notice is built from Restricted data (pay, ID numbers, protected attributes)", () => {
  for (const f of ["lib/hiring/notify.ts", "lib/core/notify/user-notify.ts"]) {
    const code = src(f)
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    assert.doesNotMatch(
      code,
      /salary|allowance|Enc\b|nationalId|\bnec\b|nationality|gender|ethnicity|basicSalary/i,
      f,
    );
  }
});

test("every hand-off writes its notice where the event happens", () => {
  assert.match(
    src("lib/hiring/requisition-status.ts"),
    /notifyNextRequisitionStep\(req, subject\)/,
  );
  assert.match(
    src("lib/hiring/requisition-write.ts"),
    /if \(note\) await notifyNextRequisitionStep/,
  );
  assert.match(
    src("lib/hiring/offer-write.ts"),
    /to === "PENDING_APPROVAL" && routed\)[\s\S]*notifyApprovalStep/,
  );
  assert.match(src("lib/hiring/offer-approvals.ts"), /await notifyAfterDecision\(/);
  assert.match(src("lib/hiring/offer-versions.ts"), /notifyApprovalStep\(/);
  assert.match(src("lib/hiring/jd.ts"), /await notifyJdSubmitted\(/);
  assert.equal(
    (src("lib/hiring/interview-write.ts").match(/notifyScorecardDue\(/g) ?? []).length,
    3,
  );
  assert.match(src("lib/hive/services/escalation-queue.ts"), /notifyTicket\("returned", id\)/);
  const notify = src("lib/hive/services/ticket-notify.ts");
  for (const k of ["TICKET_TO_DRAFT", "TICKET_TO_APPROVE", "TICKET_RETURNED"])
    assert.match(notify, new RegExp(k));
});

test("every notification kind has a heading in both bundles", () => {
  const schema = src("prisma/schema.prisma");
  const block = /enum NotificationKind \{([\s\S]*?)\}/.exec(schema)?.[1] ?? "";
  const kinds = [...block.matchAll(/^\s*([A-Z_]+)\b/gm)].map((m) => m[1]);
  for (const loc of ["en", "ar"]) {
    const m = JSON.parse(src(`messages/${loc}.json`)) as {
      pms: { notifications: { kind: Record<string, string> } };
    };
    for (const k of kinds) assert.ok(m.pms.notifications.kind[k], `${loc}: ${k}`);
  }
});
