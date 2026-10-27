import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { markdownToPlainText } from "../../lib/hiring/careers";
import { stageOnScheduling } from "../../lib/hiring/interview-write";

/** QA 2026-10-27 regressions in Hiring (D-06, D-07, D-08, D-11, D-14). */

test("D-06: the careers board summary is plain text, not raw Markdown", () => {
  const md =
    "## About the role\n\nWe build **things** for _clients_.\n\n- Design APIs\n- Ship `code`\n1. Read [the docs](https://x.example)";
  const text = markdownToPlainText(md);
  assert.equal(
    text,
    "About the role. We build things for clients. Design APIs. Ship code. Read the docs.",
  );
  assert.doesNotMatch(text, /[#*`[\]]/);
  assert.equal(markdownToPlainText("snake_case_name stays"), "snake_case_name stays.");
});

test("D-07: posting/withdrawing expires the careers cache now, not stale-while-revalidate", () => {
  for (const f of ["lib/hiring/postings.ts", "lib/hiring/jd.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /revalidateTag\(CAREERS_TAG, "max"\)/, f);
    assert.match(src, /revalidateTag\(CAREERS_TAG, \{ expire: 0 \}\)/, f);
  }
});

test("D-08: scheduling an interview moves a screened candidate into the first interview", () => {
  assert.equal(stageOnScheduling("SHORTLISTED"), "FIRST_INTERVIEW");
  assert.equal(stageOnScheduling("ASSESSMENT"), "FIRST_INTERVIEW");
  assert.equal(stageOnScheduling("CV_SCREENED"), "FIRST_INTERVIEW");
  assert.equal(stageOnScheduling("NEW_APPLICATION"), null, "not CV-screened: a person moves them");
  assert.equal(stageOnScheduling("FIRST_INTERVIEW"), null);
  assert.equal(stageOnScheduling("SECOND_INTERVIEW"), null, "never moves a candidate backwards");
  assert.equal(stageOnScheduling("REJECTED"), null);
});

test("D-11: a requisition always has an owner on record (the requester by default)", () => {
  const src = readFileSync("lib/hiring/requisition-write.ts", "utf8");
  assert.match(src, /ownerId: actor\.userId,/);
  assert.match(src, /ownerId: data\.ownerId \?\? actor\.userId/);
});

test("D-14: acting on an approval, a JD sign-off or a scorecard marks its notice done", () => {
  assert.match(
    readFileSync("lib/hiring/requisition-status.ts", "utf8"),
    /resolveUserNotices\(`hiring:requisition:\$\{req\.id\}:`\)/,
  );
  assert.match(
    readFileSync("lib/hiring/offer-approvals.ts", "utf8"),
    /resolveUserNotices\(`hiring:offer:\$\{o\.id\}:`\)/,
  );
  assert.match(readFileSync("lib/hiring/jd.ts", "utf8"), /resolveUserNotices\(\s*`hiring:jd:/);
  assert.match(
    readFileSync("lib/hiring/panel.ts", "utf8"),
    /if \(body\.submit\) await resolveUserNotices\(`hiring:scorecard:\$\{l\.iv\.id\}:`, \[actor\.userId\]\)/,
  );
  // The notify keys these prefixes resolve.
  const notify = readFileSync("lib/hiring/notify.ts", "utf8");
  assert.match(notify, /key: `hiring:\$\{params\.what\}:\$\{params\.id\}:/);
  assert.match(notify, /key: `hiring:jd:\$\{params\.requisitionId\}:v\$\{params\.version\}`/);
  assert.match(notify, /key: `hiring:scorecard:\$\{params\.interviewId\}`/);
});
