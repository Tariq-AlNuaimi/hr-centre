import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CANDIDATE_STEPS, candidateFacingStage } from "../../lib/hiring/candidate-status-rules";
import { isPublicPath } from "../../i18n/route-decision";

/** P2-11 — candidate status page (docs/blueprints/p2-candidate-status.md). */

const s = (stage: Parameters<typeof candidateFacingStage>[0]["stage"], extra = {}) =>
  candidateFacingStage({ stage, rejectionNoticeSentAt: null, stallCauseStage: null, ...extra });

test("AC-1.1 internal stages map onto five candidate-facing steps", () => {
  assert.deepEqual([...CANDIDATE_STEPS], ["RECEIVED", "REVIEW", "INTERVIEWS", "FINAL", "OFFER"]);
  assert.deepEqual(s("NEW_APPLICATION"), { step: "RECEIVED", outcome: null });
  assert.deepEqual(s("SHORTLISTED"), { step: "REVIEW", outcome: null });
  assert.deepEqual(s("SECOND_INTERVIEW"), { step: "INTERVIEWS", outcome: null });
  assert.deepEqual(s("REFERENCE_CHECK"), { step: "FINAL", outcome: null });
  assert.deepEqual(
    s("OFFER_DRAFTED"),
    { step: "FINAL", outcome: null },
    "a draft offer is internal",
  );
  assert.deepEqual(s("OFFER_EXTENDED"), { step: "OFFER", outcome: null });
  assert.deepEqual(s("HIRED"), { step: "OFFER", outcome: "HIRED" });
});

test("AC-1.2 a rejection shows only after the human notice was sent", () => {
  assert.deepEqual(s("REJECTED", { stallCauseStage: "FIRST_INTERVIEW" }), {
    step: "INTERVIEWS",
    outcome: null,
  });
  assert.deepEqual(
    s("REJECTED", { stallCauseStage: "FIRST_INTERVIEW", rejectionNoticeSentAt: new Date() }),
    { step: "INTERVIEWS", outcome: "NOT_PROGRESSING" },
  );
  assert.equal(s("WITHDRAWN").outcome, "WITHDRAWN");
});

test("AC-1.3 the page carries no internal note, reason, score or interviewer", () => {
  const src = readFileSync("lib/hiring/candidate-status.ts", "utf8");
  const select = src.slice(src.indexOf("prisma.hiringCandidate.findFirst"));
  assert.doesNotMatch(
    select.slice(0, 600),
    /rejectionReason|rejectionNotes|notes|score|panel|email: true/,
  );
  assert.match(src, /erasedAt: null/);
});

test("AC-2.1 the confirmation links to it; erasure revokes it", () => {
  const careers = readFileSync("lib/hiring/careers.ts", "utf8");
  assert.match(careers, /issueCandidateStatusLink\(candidate\.id\)/);
  assert.match(careers, /return \{ applied: true, statusPath \}/);
  assert.match(readFileSync("components/hiring/careers/ApplyPanel.tsx", "utf8"), /statusPath/);
  assert.match(
    readFileSync("lib/hiring/erasure.ts", "utf8"),
    /revokeMagicLinks\(CANDIDATE_STATUS_PURPOSE, c\.id\)/,
  );
});

test("AC-3.1 public under /careers, rate-limited, one invalid page", () => {
  assert.equal(isPublicPath(`/careers/status/${"a".repeat(43)}`), true);
  const page = readFileSync("app/[locale]/(careers)/careers/status/[token]/page.tsx", "utf8");
  assert.match(page, /rateLimit\(/);
  assert.match(page, /robots: \{ index: false, follow: false, nocache: true \}/);
  assert.match(page, /export const dynamic = "force-dynamic"/);
});
