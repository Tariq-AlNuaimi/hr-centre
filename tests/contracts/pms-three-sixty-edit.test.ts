import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  discardBlockedReason,
  discardDestroysAnswers,
  raterChangeBlockedReason,
  statusChangeBlockedReason,
  windowChangeBlockedReason,
} from "../../lib/pms/three-sixty-edit";
import { raterEligibilityRefusal } from "../../lib/pms/three-sixty-raters";

/**
 * §9.4/§9.7 — editing a 360 cycle after it was created.
 *
 * The rules are pure functions so the SCREEN and the ROUTE can ask the same
 * question. These tests pin the rules; the source assertions at the bottom pin
 * that both sides actually ask them, which is the half that rots.
 */

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const base = {
  performanceYearStatus: "OPEN" as const,
  currentOpensAt: day("2026-03-01"),
  currentDeadline: day("2026-03-31"),
  now: day("2026-03-10"),
};

test("§9.7 a live deadline can be EXTENDED", () => {
  // The operator's actual ask, and the thing the draft-only rule forbade.
  assert.equal(
    windowChangeBlockedReason({
      ...base,
      cycleStatus: "ACTIVE",
      nextOpensAt: base.currentOpensAt,
      nextDeadline: day("2026-04-07"),
    }),
    null,
  );
});

test("§5.4 a live deadline cannot be brought forward", () => {
  // Extending cannot invalidate an answer already given; pulling one in locks
  // raters out of a form they are part-way through.
  const blocked = windowChangeBlockedReason({
    ...base,
    cycleStatus: "ACTIVE",
    nextOpensAt: base.currentOpensAt,
    nextDeadline: day("2026-03-20"),
  });
  assert.ok(blocked);
  assert.match(blocked.reason, /extended but not brought forward/);
  assert.match(blocked.reason, /Close the cycle instead/);
  assert.equal(blocked.status, 409);
});

test("§9.7 an opening date that has passed is frozen; a future one still moves", () => {
  const frozen = windowChangeBlockedReason({
    ...base,
    cycleStatus: "ACTIVE",
    nextOpensAt: day("2026-03-05"),
    nextDeadline: base.currentDeadline,
  });
  assert.ok(frozen, "the cycle opened on the 1st and now is the 10th");
  assert.match(frozen.reason, /already opened/);

  // Same cycle, not yet open: nobody can have started, so it moves.
  assert.equal(
    windowChangeBlockedReason({
      ...base,
      cycleStatus: "ACTIVE",
      now: day("2026-02-20"),
      nextOpensAt: day("2026-03-05"),
      nextDeadline: base.currentDeadline,
    }),
    null,
  );
});

test("a draft window moves in both directions", () => {
  assert.equal(
    windowChangeBlockedReason({
      ...base,
      cycleStatus: "DRAFT",
      nextOpensAt: day("2026-02-01"),
      nextDeadline: day("2026-02-28"),
    }),
    null,
  );
});

test("§2 a closed performance year refuses every window change", () => {
  const blocked = windowChangeBlockedReason({
    ...base,
    cycleStatus: "ACTIVE",
    performanceYearStatus: "CLOSED",
    nextOpensAt: base.currentOpensAt,
    nextDeadline: day("2026-04-30"),
  });
  assert.ok(blocked);
  assert.match(blocked.reason, /closed performance year/);
});

test("§9.8 an active cycle can be CLOSED — the transition nothing could make", () => {
  // `CLOSED` was in the enum and the rater refusal was written, but no code
  // path ever wrote the column: a cycle reached ACTIVE and stayed there.
  assert.equal(
    statusChangeBlockedReason({
      current: "ACTIVE",
      next: "CLOSED",
      performanceYearStatus: "OPEN",
      submittedCount: 7,
    }),
    null,
  );
});

test("an active cycle goes back to draft only while NOTHING is submitted", () => {
  assert.equal(
    statusChangeBlockedReason({
      current: "ACTIVE",
      next: "DRAFT",
      performanceYearStatus: "OPEN",
      submittedCount: 0,
    }),
    null,
  );

  // A draft can be regenerated, and that wipes every assignment — so going
  // back to draft must not be able to destroy a submitted assessment.
  const blocked = statusChangeBlockedReason({
    current: "ACTIVE",
    next: "DRAFT",
    performanceYearStatus: "OPEN",
    submittedCount: 2,
  });
  assert.ok(blocked);
  assert.match(blocked.reason, /2 assessment\(s\) have already been submitted/);
  assert.match(blocked.reason, /Close the cycle instead/);
});

test("a closed cycle can be reopened — a close is not a dead end", () => {
  assert.equal(
    statusChangeBlockedReason({
      current: "CLOSED",
      next: "ACTIVE",
      performanceYearStatus: "OPEN",
      submittedCount: 3,
    }),
    null,
  );
});

test("closed straight to draft is refused as two decisions at once", () => {
  const blocked = statusChangeBlockedReason({
    current: "CLOSED",
    next: "DRAFT",
    performanceYearStatus: "OPEN",
    submittedCount: 0,
  });
  assert.ok(blocked);
  assert.match(blocked.reason, /Reopen this cycle first/);
});

test("§9.7's launch stays with the activate route, which holds the exactly-three gate", () => {
  const blocked = statusChangeBlockedReason({
    current: "DRAFT",
    next: "ACTIVE",
    performanceYearStatus: "OPEN",
    submittedCount: 0,
  });
  assert.ok(blocked);
  assert.match(blocked.reason, /Use Activate/);
  assert.match(blocked.reason, /exactly\s+three raters/);
});

test("a no-op status change is refused rather than written twice", () => {
  const blocked = statusChangeBlockedReason({
    current: "CLOSED",
    next: "CLOSED",
    performanceYearStatus: "OPEN",
    submittedCount: 0,
  });
  assert.ok(blocked);
  assert.match(blocked.reason, /already closed/);
});

test("§9.4 an unsubmitted rater can be replaced on a LIVE cycle", () => {
  // The gap §9.6's "before launch" left, and the one the §12.1 departure
  // dialog was already promising to fill.
  for (const assignmentStatus of ["NOT_STARTED", "IN_PROGRESS"] as const) {
    assert.equal(
      raterChangeBlockedReason({
        cycleStatus: "ACTIVE",
        performanceYearStatus: "OPEN",
        assignmentStatus,
      }),
      null,
      `${assignmentStatus} must be replaceable`,
    );
  }
});

test("a SUBMITTED assessment's rater can NEVER be changed", () => {
  // Not "with a reason" — never. Pointing someone else's answers at a new name
  // is a falsified assessment, and §9.3's scores reach pay through §8.5.
  const blocked = raterChangeBlockedReason({
    cycleStatus: "ACTIVE",
    performanceYearStatus: "OPEN",
    assignmentStatus: "SUBMITTED",
  });
  assert.ok(blocked);
  assert.match(blocked.reason, /answers belong to the person who gave them/);
  assert.match(blocked.reason, /Discard it with a reason instead/);
});

test("discarding a SUBMITTED assessment requires a reason; an unsubmitted one does not", () => {
  const shared = { cycleStatus: "ACTIVE", performanceYearStatus: "OPEN" } as const;

  const noReason = discardBlockedReason({
    ...shared,
    assignmentStatus: "SUBMITTED",
    reason: "   ",
  });
  assert.ok(noReason, "whitespace is not a reason");
  assert.match(noReason.reason, /a reason is required/);
  assert.equal(noReason.status, 422);

  assert.equal(
    discardBlockedReason({
      ...shared,
      assignmentStatus: "SUBMITTED",
      reason: "Rater left the company",
    }),
    null,
  );
  assert.equal(
    discardBlockedReason({ ...shared, assignmentStatus: "NOT_STARTED", reason: null }),
    null,
    "nothing is destroyed, so nothing to justify",
  );
});

test("whether a discard destroys answers is asked in ONE place", () => {
  // The confirmation HR reads and the audit row the route writes both ask this,
  // so they cannot disagree about whether anything was lost.
  assert.equal(discardDestroysAnswers("SUBMITTED"), true);
  assert.equal(discardDestroysAnswers("IN_PROGRESS"), false);
  assert.equal(discardDestroysAnswers("NOT_STARTED"), false);
});

test("§8.3/§12.1/§7.1 rater eligibility is one shared rule", () => {
  const person = (over: Partial<Parameters<typeof raterEligibilityRefusal>[0]["raters"][0]>) => ({
    id: "r1",
    managerId: null,
    roleTrack: "INDIVIDUAL" as never,
    departmentId: "d1",
    status: "ACTIVE",
    ...over,
  });

  assert.equal(raterEligibilityRefusal({ raters: [person({})], rateeId: "e1" }), null);

  const self = raterEligibilityRefusal({ raters: [person({ id: "e1" })], rateeId: "e1" });
  assert.match(self?.reason ?? "", /Nobody assesses themselves/);

  const cLevel = raterEligibilityRefusal({
    raters: [person({ roleTrack: "C_LEVEL" as never })],
    rateeId: "e1",
  });
  assert.match(cLevel?.reason ?? "", /C-Level are excused/);

  const leaver = raterEligibilityRefusal({
    raters: [person({ status: "LEAVER" })],
    rateeId: "e1",
  });
  assert.match(leaver?.reason ?? "", /have left/);
});

// ---------------------------------------------------------------------------
// The half that rots: that both sides actually ask the shared question.
// ---------------------------------------------------------------------------

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (p: string) => stripComments(readFileSync(p, "utf8"));

test("every route stands behind the shared rules, not its own copy", () => {
  const window = read("app/api/three-sixty/route.ts");
  assert.match(window, /windowChangeBlockedReason\(/);
  // The old draft-only lock must be gone, or extending stays impossible
  // whatever the new rules say.
  assert.doesNotMatch(window, /status: "DRAFT" \},\s*\n\s*data: \{ opensAt/);

  const status = read("app/api/three-sixty/status/route.ts");
  assert.match(status, /statusChangeBlockedReason\(/);

  const assignment = read("app/api/three-sixty/assignments/[assignmentId]/route.ts");
  assert.match(assignment, /raterChangeBlockedReason\(/);
  assert.match(assignment, /discardBlockedReason\(/);
  assert.match(assignment, /raterEligibilityRefusal\(/);
});

test("the pre-launch writer and the per-assignment writer share the rater rules", () => {
  // §9.4's eligibility was inline in one route; a second copy in the other
  // would not be a wrong number on a screen but a person asked to assess
  // somebody they may not assess.
  const bulk = read("app/api/three-sixty/assignments/route.ts");
  assert.match(bulk, /raterEligibilityRefusal\(/);
  assert.match(bulk, /THREE_SIXTY_CANDIDATE_SELECT/);
  assert.doesNotMatch(bulk, /C-Level are excused from 360 work entirely/, "no hand-written copy");
  assert.doesNotMatch(bulk, /of those raters have left/, "no hand-written copy");
});

test("a submitted assessment's answers reach the audit row BEFORE they are deleted", () => {
  // `AssignmentResponse` cascades with the assignment, so this is the only
  // moment they exist to be recorded. A destructive act whose trail does not
  // say what it destroyed is not a trail.
  const src = read("app/api/three-sixty/assignments/[assignmentId]/route.ts");
  const readAnswers = src.indexOf("assignmentResponse.findMany");
  const auditRow = src.indexOf('action: "DELETE"');
  const del = src.indexOf("assignment.delete(");
  assert.ok(readAnswers > 0 && auditRow > 0 && del > 0);
  assert.ok(readAnswers < auditRow, "answers are read before the audit row is built");
  assert.ok(auditRow < del, "the audit row is written before the delete");
});

test("the screen refuses exactly what the routes refuse", () => {
  // A control the API then rejects is the failure mode being designed out —
  // and this screen already had its inverse, a §12.1 dialog promising a
  // reassignment no writer accepted.
  const window = read("components/pms/ThreeSixtyWindow.tsx");
  assert.match(window, /pullsDeadlineIn/, "the editor must disable a backwards deadline");
  assert.match(window, /hasOpened/, "and freeze a start date that has passed");

  const editor = read("components/pms/ThreeSixtyRaterEditor.tsx");
  assert.match(editor, /submittedLocked/, "a submitted row says why it is locked");
  assert.match(
    editor,
    /status === "SUBMITTED" && reason\.trim\(\) === ""/,
    "and the discard button mirrors the mandatory reason",
  );
});

test("the window editor is no longer hidden on a live cycle", () => {
  const page = read("app/[locale]/(dashboard)/three-sixty/page.tsx");
  assert.doesNotMatch(
    page,
    /threeSixty\.status === "DRAFT" && cycleId && capabilities\.hr/,
    "the draft-only render gate is what made the deadline unextendable",
  );
  assert.match(page, /ThreeSixtyCycleActions/);
});

test("every new string exists in both locales", () => {
  const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
  const ar = JSON.parse(readFileSync("messages/ar.json", "utf8"));
  const flat = (o: Record<string, unknown>, p = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === "object"
        ? flat(v as Record<string, unknown>, p ? `${p}.${k}` : k)
        : [p ? `${p}.${k}` : k],
    );
  const enKeys = new Set(flat(en));
  const arKeys = new Set(flat(ar));
  for (const ns of ["pms.threeSixtyActions", "pms.raterEditor"]) {
    const some = [...enKeys].filter((k) => k.startsWith(`${ns}.`));
    assert.ok(some.length > 0, `${ns} must exist`);
    for (const key of some) assert.ok(arKeys.has(key), `ar is missing ${key}`);
  }
});
