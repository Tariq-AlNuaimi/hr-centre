import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  boardStepForStage,
  classifyStageMove,
  isPhaseCross,
  isRegression,
  stageTransitionError,
  stepEntryStage,
  stepForStage,
} from "../../lib/hiring/stage-rules";
import {
  GATE_CODE,
  gateVerdict,
  mayCrossGates,
  packageGateBlocks,
  skippedGates,
} from "../../lib/hiring/stage-gates";
import {
  computeHoldExpiry,
  furthestStageReached,
  noticeState,
  noticeTemplateFor,
  shouldHoldNotice,
} from "../../lib/hiring/notice-rules";
import {
  employerLine,
  isWithinBand,
  screenVerdict,
  yearsFromProfile,
} from "../../lib/hiring/screen-verdict";
import {
  bandMidpoint,
  currentPackageFrom,
  isOmani,
  pricingBasisFor,
  referrerToPersist,
  resolveInterviewCountBounds,
  reviewedPayslips,
} from "../../lib/hiring/candidate-rules";
import {
  advanceableCount,
  blocksAdvance,
  computeValidUntil,
  effectiveStatus,
  isResultValid,
  percentileBand,
  reuseDecision,
} from "../../lib/hiring/assessment-rules";
import { sniffType } from "../../lib/hiring/candidate-files";
import {
  BULK_ID_CAP,
  bulkActionSchema,
  candidateListQuerySchema,
  createCandidateSchema,
  stallCauseSchema,
  stageMoveSchema,
} from "../../lib/validations/hiring/candidate";
import { DEFAULT_CALENDAR } from "../../lib/working-time/calendar";

/**
 * Hiring slice 3 — candidates (docs/blueprints/hiring.md AC3.1–AC3.4):
 * Interview Hub's stage-phases, stage-gates, rejection-notices, screen-verdict,
 * package-confirmation and assessment-rules invariants, plus the route floor.
 */

test("stage machine: same-stage and terminal→terminal are illegal; everything else is reachable", () => {
  assert.ok(stageTransitionError("SHORTLISTED", "SHORTLISTED"));
  assert.ok(stageTransitionError("REJECTED", "WITHDRAWN"));
  assert.equal(stageTransitionError("REJECTED", "CV_SCREENED"), null);
  assert.equal(stageTransitionError("NEW_APPLICATION", "HIRED"), null);
});

test("governed moves: reject past first interview, regressions, phase crosses", () => {
  assert.equal(classifyStageMove("FIRST_INTERVIEW", "REJECTED"), "candidate.reject");
  assert.equal(classifyStageMove("SHORTLISTED", "REJECTED"), null);
  assert.equal(classifyStageMove("ASSESSMENT", "SHORTLISTED"), "stage.regress");
  assert.ok(isRegression("REJECTED", "CV_SCREENED"), "reopening is a regression");
  assert.ok(isPhaseCross("ASSESSMENT", "FIRST_INTERVIEW"));
  assert.equal(isPhaseCross("FIRST_INTERVIEW", "SECOND_INTERVIEW"), false);
  assert.equal(classifyStageMove("NEW_APPLICATION", "CV_SCREENED"), null);
});

test("spine: steps, entry stages, and an offer-less card sits at Decide", () => {
  assert.equal(stepForStage("NEW_APPLICATION"), 1);
  assert.equal(stepForStage("ASSESSMENT"), 2);
  assert.equal(stepForStage("DECISION_PENDING"), 5);
  assert.equal(stepForStage("REJECTED"), 0);
  assert.equal(stepForStage("nonsense"), 0);
  assert.equal(stepEntryStage(3), "FIRST_INTERVIEW");
  assert.equal(stepEntryStage(6), "OFFER_DRAFTED");
  assert.equal(boardStepForStage("OFFER_EXTENDED", false), 5);
  assert.equal(boardStepForStage("OFFER_EXTENDED", true), 6);
  assert.equal(boardStepForStage("HIRED", false), 5);
});

test("gates: forward jumps over unvisited mandatory steps are named; visited ones are not", () => {
  assert.deepEqual(skippedGates("NEW_APPLICATION", "SHORTLISTED", []), ["CV_SCREENED"]);
  assert.deepEqual(skippedGates("CV_SCREENED", "SHORTLISTED", ["CV_SCREENED"]), []);
  assert.deepEqual(skippedGates("NEW_APPLICATION", "OFFER_EXTENDED", []), [
    "CV_SCREENED",
    "FIRST_INTERVIEW",
    "DECISION_PENDING",
    "OFFER_DRAFTED",
  ]);
  assert.deepEqual(skippedGates("SHORTLISTED", "CV_SCREENED", []), [], "backwards never gates");
  assert.deepEqual(skippedGates("FIRST_INTERVIEW", "REJECTED", []), [], "terminal never gates");
  assert.equal(mayCrossGates("CV_SCREENED", "SHORTLISTED"), false);
  assert.equal(mayCrossGates("REJECTED", "SHORTLISTED"), true);
});

test("gates: a reopened candidate resumes from the furthest stage they reached", () => {
  const visited = [
    "NEW_APPLICATION",
    "CV_SCREENED",
    "SHORTLISTED",
    "FIRST_INTERVIEW",
    "REJECTED",
  ] as const;
  assert.deepEqual(skippedGates("REJECTED", "SECOND_INTERVIEW", visited), []);
  assert.deepEqual(skippedGates("REJECTED", "OFFER_DRAFTED", visited), ["DECISION_PENDING"]);
});

test("package gate: drafting an offer needs confirmation OR an attributed decline", () => {
  const none = { packageConfirmedAt: null, packageDeclinedAt: null };
  assert.equal(packageGateBlocks("OFFER_DRAFTED", none), true);
  assert.equal(
    packageGateBlocks("OFFER_DRAFTED", { ...none, packageDeclinedAt: new Date() }),
    false,
  );
  assert.equal(
    packageGateBlocks("OFFER_DRAFTED", { ...none, packageConfirmedAt: new Date() }),
    false,
  );
  assert.equal(packageGateBlocks("OFFER_EXTENDED", none), false);
});

test("gate verdict: forbidden → confirm → reason, and the history records what was skipped", () => {
  const gaps = ["CV_SCREENED"] as const;
  const no = gateVerdict({
    gaps,
    packageBlocked: false,
    mayOverride: false,
    overrideGates: true,
    reason: "x",
  });
  assert.equal(no.ok, false);
  assert.equal(!no.ok && no.code, GATE_CODE.forbidden);
  const confirm = gateVerdict({ gaps, packageBlocked: false, mayOverride: true });
  assert.equal(!confirm.ok && confirm.code, GATE_CODE.confirmRequired);
  const reason = gateVerdict({
    gaps,
    packageBlocked: true,
    mayOverride: true,
    overrideGates: true,
    reason: "  ",
  });
  assert.equal(!reason.ok && reason.code, GATE_CODE.reasonRequired);
  const ok = gateVerdict({
    gaps,
    packageBlocked: true,
    mayOverride: true,
    overrideGates: true,
    reason: "Internal transfer",
  });
  assert.ok(ok.ok);
  assert.match(
    ok.ok ? (ok.historyReason ?? "") : "",
    /^\[Skipped CV screening \(step 5\) and package confirmation/,
  );
  const clean = gateVerdict({
    gaps: [],
    packageBlocked: false,
    mayOverride: false,
    reason: " moved ",
  });
  assert.deepEqual(clean, { ok: true, historyReason: "moved" });
});

test("rejection hold: five working days on the Sun–Thu calendar, holidays skipped, time kept", () => {
  // Thursday 2026-10-29 10:00 Muscat (06:00Z) → Fri/Sat skipped → Thursday 2026-11-05.
  const thu = new Date("2026-10-29T06:00:00.000Z");
  assert.equal(computeHoldExpiry(thu, DEFAULT_CALENDAR).toISOString(), "2026-11-05T06:00:00.000Z");
  const withHoliday = { ...DEFAULT_CALENDAR, holidays: new Set(["2026-11-01"]) };
  assert.equal(computeHoldExpiry(thu, withHoliday).toISOString(), "2026-11-08T06:00:00.000Z");
  // 23:30 Muscat on Thursday is still Thursday locally even though it is 19:30Z.
  const late = new Date("2026-10-29T19:30:00.000Z");
  assert.equal(computeHoldExpiry(late, DEFAULT_CALENDAR).toISOString(), "2026-11-05T19:30:00.000Z");
});

test("notice state, template and the hold decision", () => {
  const now = new Date("2026-10-27T00:00:00Z");
  assert.equal(noticeState({ noticeSentAt: now, now }).status, "sent");
  assert.equal(noticeState({ holdUntil: new Date("2026-10-30"), now }).status, "held");
  assert.deepEqual(noticeState({ holdUntil: new Date("2026-10-20"), now }), {
    status: "ready",
    holdUntil: null,
    expired: true,
  });
  assert.equal(noticeTemplateFor("FIRST_INTERVIEW"), "interviewed");
  assert.equal(noticeTemplateFor("SHORTLISTED"), "screening");
  const reached = furthestStageReached("REJECTED", [
    { fromStage: "FINAL_INTERVIEW", toStage: "REJECTED" },
  ]);
  assert.equal(reached, "FINAL_INTERVIEW");
  assert.equal(shouldHoldNotice({ reached, preferredCandidatePending: true }), true);
  assert.equal(shouldHoldNotice({ reached, preferredCandidatePending: false }), false);
  assert.equal(
    shouldHoldNotice({ reached: "SHORTLISTED", preferredCandidatePending: true }),
    false,
  );
});

test("screen verdict: 0 is 'not scored', threshold, over band, under band, top of band", () => {
  const base = { bandMin: 1000, bandMax: 2000, fitThreshold: 60 };
  assert.equal(screenVerdict({ ...base, fit: 0, expectation: 1500 }).verdict, null);
  assert.equal(screenVerdict({ ...base, fit: null, expectation: 1500 }).verdict, null);
  assert.equal(screenVerdict({ ...base, fit: 59, expectation: 1500 }).verdict, "REJECT");
  const over = screenVerdict({ ...base, fit: 80, expectation: 2500 });
  assert.equal(over.verdict, "OVER_BAND");
  assert.match(over.why, /25% above/);
  assert.match(screenVerdict({ ...base, fit: 80, expectation: 900 }).why, /below the band floor/);
  assert.match(screenVerdict({ ...base, fit: 80, expectation: 1950 }).why, /top of band/);
  assert.match(screenVerdict({ ...base, fit: 80, expectation: null }).why, /no expectation/);
  assert.equal(isWithinBand(1500, 1000, 2000), true);
  assert.equal(isWithinBand(null, 1000, 2000), false);
  assert.equal(isWithinBand(2500, 1000, 2000), false);
  assert.equal(employerLine(" Acme ", 6.4), "Acme · 6 yrs");
  assert.equal(employerLine(null, null), null);
  assert.equal(yearsFromProfile({ yearsOfExperience: 7 }), 7);
  assert.equal(yearsFromProfile("nope"), null);
});

test("package: only READ payslips count; basis; midpoint", () => {
  const docs = [
    { kind: "PAYSLIP", statedAmount: 1000, reviewedAt: new Date() },
    { kind: "PAYSLIP", statedAmount: 2000, reviewedAt: new Date() },
    { kind: "PAYSLIP", statedAmount: 9000, reviewedAt: null },
    { kind: "BANK_STATEMENT", statedAmount: 5000, reviewedAt: new Date() },
  ];
  assert.equal(currentPackageFrom(docs), 1500);
  assert.equal(currentPackageFrom([]), null);
  assert.equal(reviewedPayslips(docs), 2);
  assert.equal(pricingBasisFor("CONFIRMED"), "BAND_VERDICT_AND_EVIDENCE");
  assert.equal(pricingBasisFor("DECLINED"), "BAND_AND_VERDICT");
  assert.equal(bandMidpoint(1000, 2000), 1500);
  assert.equal(bandMidpoint(2000, 1000), null);
});

test("referral, interview-count bounds, Omani", () => {
  assert.equal(referrerToPersist("REFERRAL", "u1"), "u1");
  assert.equal(referrerToPersist("AGENCY", "u1"), null);
  assert.equal(resolveInterviewCountBounds(), null);
  assert.equal(resolveInterviewCountBounds(0), null);
  assert.deepEqual(resolveInterviewCountBounds(0, 2), { gte: 1, lte: 2, includeZero: true });
  assert.deepEqual(resolveInterviewCountBounds(2), { gte: 2, includeZero: false });
  assert.equal(isOmani("Omani"), true);
  assert.equal(isOmani("Indian"), false);
});

test("assessment: reuse within validity, pending left alone, cut-off holds, expiry derived", () => {
  const now = new Date("2026-10-27T00:00:00Z");
  const valid = { status: "COMPLETED" as const, score: 70, validUntil: new Date("2027-01-01") };
  assert.equal(isResultValid(valid, now), true);
  assert.equal(reuseDecision(valid, now, 12).action, "reuse");
  assert.equal(
    reuseDecision({ ...valid, validUntil: new Date("2026-01-01") }, now, 12).action,
    "invite",
  );
  assert.equal(
    reuseDecision({ status: "INVITED", score: null, validUntil: null }, now, 12).action,
    "already-pending",
  );
  assert.equal(reuseDecision(null, now, 12).action, "invite");
  assert.equal(
    computeValidUntil(new Date("2026-01-31T00:00:00Z"), 1)?.toISOString(),
    "2026-02-28T00:00:00.000Z",
  );
  assert.equal(computeValidUntil(now, 0), null);
  assert.equal(blocksAdvance(50, { resultsUse: "ADVISORY", passThreshold: 60 }), false);
  assert.equal(blocksAdvance(50, { resultsUse: "HARD_CUTOFF", passThreshold: 60 }), true);
  assert.equal(effectiveStatus("INVITED", new Date("2026-10-01"), now), "EXPIRED");
  assert.equal(effectiveStatus("COMPLETED", new Date("2026-10-01"), now), "COMPLETED");
  assert.equal(percentileBand(95, 40, 60), "TOP_DECILE");
  assert.equal(percentileBand(50, 40, 60), "BELOW");
  assert.equal(
    advanceableCount(
      [
        { status: "COMPLETED", score: 80 },
        { status: "COMPLETED", score: 40 },
        { status: "INVITED", score: null },
      ],
      { resultsUse: "HARD_CUTOFF", passThreshold: 60 },
    ),
    1,
  );
});

test("files are what their bytes say", () => {
  assert.equal(sniffType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), "application/pdf");
  assert.equal(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), "image/png");
  assert.equal(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(sniffType(webp), "image/webp");
  assert.equal(sniffType(new TextEncoder().encode("<html>")), null);
});

test("boundary: a new candidate cannot be given a stage; caps and refinements hold", () => {
  const c = createCandidateSchema.parse({ name: "A", email: "A@X.COM", stage: "HIRED" });
  assert.equal("stage" in c, false);
  assert.equal(c.email, "a@x.com");
  assert.equal(createCandidateSchema.safeParse({ name: "A", phone: "abc" }).success, false);
  assert.equal(createCandidateSchema.safeParse({ name: "A", nec: "12;drop" }).success, false);
  assert.equal(stallCauseSchema.safeParse({ cause: "OTHER" }).success, false);
  assert.equal(stallCauseSchema.safeParse({ cause: null, note: "x" }).success, false);
  assert.equal(stageMoveSchema.safeParse({ stage: "DECISION_PENDING" }).success, true);
  const ids = Array.from({ length: BULK_ID_CAP + 1 }, (_, i) => `c${i}`);
  assert.equal(
    bulkActionSchema.safeParse({ action: "stage_move", candidateIds: ids, stage: "SHORTLISTED" })
      .success,
    false,
  );
  assert.equal(
    bulkActionSchema.safeParse({ action: "email", candidateIds: ["a"] }).success,
    false,
    "no bulk email",
  );
  assert.equal(
    candidateListQuerySchema.safeParse({ stage: "DECISION_PENDING" }).success,
    true,
    "D9",
  );
  assert.equal(candidateListQuerySchema.safeParse({ scoreMin: 80, scoreMax: 20 }).success, false);
  assert.equal(candidateListQuerySchema.parse({ pageSize: "100" }).pageSize, 100);
  assert.equal(candidateListQuerySchema.safeParse({ pageSize: "101" }).success, false);
});

/** Every route file under a directory. */
function routes(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) routes(p, out);
    else if (e === "route.ts") out.push(p);
  }
  return out;
}

test("route floor: every slice-3 handler is rate-limited, authenticated and scope-resolved", () => {
  const files = [
    ...routes("app/api/hiring/candidates"),
    "app/api/hiring/requisitions/[id]/screening/route.ts",
    "app/api/hiring/requisitions/[id]/assessment/route.ts",
    "app/api/hiring/settings/assessment/route.ts",
  ];
  assert.ok(files.length >= 14);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const handlers = src.match(/export const (GET|POST|PUT|PATCH|DELETE) = /g) ?? [];
    assert.ok(handlers.length > 0, f);
    const wrapped = src.match(/withRateLimit\(\s*withAuth\(\s*hiringRoute\(/g) ?? [];
    assert.equal(
      wrapped.length,
      handlers.length,
      `${f}: every handler is withRateLimit(withAuth(hiringRoute(…)))`,
    );
  }
});

test("restricted files: CV needs PII rights, evidence needs comp rights, 404 otherwise", () => {
  const cv = readFileSync("app/api/hiring/candidates/[id]/cv/route.ts", "utf8");
  assert.match(cv, /hiring\.viewPii/);
  const doc = readFileSync("app/api/hiring/candidates/[id]/documents/[docId]/route.ts", "utf8");
  assert.match(doc, /seesCandidateComp/);
  assert.doesNotMatch(doc, /forbidden\(/, "no 403 oracle on evidence");
});
