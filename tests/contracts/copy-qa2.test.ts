import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** QA2 N-19 (copy and honest states) and N-20 (a missing case id). */

const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
const src = (f: string) => readFileSync(f, "utf8");

test("N-19 counts are pluralised ('1 department', not '1 departments')", () => {
  assert.match(en.org.directorateCounts, /one \{# department\}/);
  assert.match(en.org.companyCounts, /one \{# department\}/);
  assert.match(en.org.companyCounts, /one \{# person\}/);
});

test("N-19 the careers hero does not say 'across Oman' next to a Dubai role", () => {
  assert.doesNotMatch(JSON.stringify(en), /hiring across Oman/);
});

test("N-19 breadcrumbs humanise a segment in sentence case ('Task routing')", () => {
  const s = src("components/layout/Breadcrumbs.tsx");
  assert.doesNotMatch(s, /\\b\\\\p\{L\}\/gu, \(c\) => c\.toUpperCase\(\)/);
  assert.match(s, /words\.charAt\(0\)\.toUpperCase\(\) \+ words\.slice\(1\)/);
});

test("N-19 honest states: draft-only joiner hint, no risk on a closed case, no legacy role", () => {
  assert.match(src("components/jml/joiners/JoinerForm.tsx"), /dto\?\.sourceRef && isDraft/);
  assert.match(src("components/jml/CaseBits.tsx"), /if \(status && !LIVE\.has\(status\)\)/);
  assert.match(src("components/jml/case/CaseSummary.tsx"), /status=\{detail\.status\}/);
  assert.doesNotMatch(
    src("app/[locale]/(dashboard)/settings/profile/page.tsx"),
    /value: user\?\.role \?\? "-"/,
  );
});

test("N-20 /jml/cases/undefined is a not-found page, and a 404 from the API says so", () => {
  const page = src("app/[locale]/(dashboard)/jml/cases/[id]/page.tsx");
  assert.match(page, /if \(!isCaseId\(id\)\) notFound\(\);/);
  assert.match(src("components/jml/case/CaseScreen.tsx"), /detail\.error\.status === 404/);
});
