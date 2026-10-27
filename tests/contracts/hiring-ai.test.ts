import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { decideAiBudget, estimateSpend } from "../../lib/hiring/ai/budget";
import { sealedKeyOf } from "../../lib/hiring/ai/config";
import { AiError, aiErrorMessage } from "../../lib/hiring/ai/engine";
import { redactProfileProxies, redactPromptPii } from "../../lib/hiring/ai/redact";
import { fitFields, weightsGuidance } from "../../lib/hiring/ai/skills";
import { detectFileKind, extractJson, isRawOnly } from "../../lib/hiring/ai/text";
import { APPROVAL_ROLES } from "../../lib/hiring/access";
import { SCRUB_FIELDS } from "../../lib/prisma/audit-extension";
import { checkBaseUrl, isBlockedHost } from "../../lib/validations/hiring/ai-egress";
import {
  APPROVAL_ROLE_VALUES,
  aiProviderSchema,
  generalSettingsSchema,
  scoringWeightsSchema,
} from "../../lib/validations/hiring/ai";

test("egress: https public hosts only; private, loopback, metadata and obfuscated IPs refused", () => {
  assert.equal(checkBaseUrl("https://api.anthropic.com"), null);
  assert.equal(checkBaseUrl("https://litellm.example.com/v1"), null);
  for (const bad of [
    "http://api.example.com",
    "https://localhost:4000",
    "https://127.0.0.1",
    "https://10.1.2.3",
    "https://172.20.0.1",
    "https://192.168.1.1",
    "https://169.254.169.254",
    "https://100.64.0.1",
    "https://[::1]",
    "https://[fd00::1]",
    "https://2130706433",
    "https://0x7f.1",
    "https://metadata.google.internal",
    "not a url",
  ]) {
    assert.notEqual(checkBaseUrl(bad), null, bad);
  }
  assert.ok(isBlockedHost("::ffff:10.0.0.1"));
  assert.equal(isBlockedHost("8.8.8.8"), false);
  assert.equal(
    aiProviderSchema.safeParse({ provider: "openai", baseUrl: "http://x.com", model: "m" }).success,
    false,
  );
  assert.equal(
    aiProviderSchema.safeParse({ provider: "openai", baseUrl: "", model: "m" }).success,
    true,
  );
});

test("redaction: contact details and the candidate's name never leave; short numbers survive", () => {
  const out = redactPromptPii(
    "Ali Al-Harthy (ali@x.com, +968 9123 4567) asked for 1500 OMR. Ali said quality matters.",
    ["Ali Al-Harthy"],
  );
  assert.doesNotMatch(out, /ali@x\.com|9123|Al-Harthy/);
  assert.match(out, /\[CANDIDATE\] said quality matters/);
  assert.match(out, /1500 OMR/);
});

test("profile proxies (nationality, age, address, school, photo, dates) are stripped; durations kept", () => {
  const p = redactProfileProxies({
    nationality: "Omani",
    dateOfBirth: "1990-01-01",
    address: "Muscat",
    photoUrl: "https://x/y.png",
    education: [{ degree: "BSc", university: "SQU", graduationYear: 2012 }],
    experience: [
      {
        title: "Engineer",
        company: "Acme",
        startDate: "2015-01",
        endDate: "2020-01",
        description: "Since 2015",
      },
    ],
  }) as Record<string, unknown>;
  const s = JSON.stringify(p);
  for (const leak of ["Omani", "1990", "Muscat", "y.png", "SQU", "2012", "2015"])
    assert.ok(!s.includes(leak), leak);
  assert.equal((p.experience as { durationMonths: number }[])[0].durationMonths, 60);
  assert.deepEqual(redactProfileProxies(null), {});
});

test("budget: kill-switch first, then token cap, then spend cap; 0 = no cap", () => {
  const base = {
    killSwitch: false,
    todayTokens: 0,
    todaySpend: 0,
    dailyTokenCap: 0,
    dailySpendCap: 0,
  };
  assert.deepEqual(decideAiBudget(base), { allowed: true });
  assert.equal(
    (decideAiBudget({ ...base, killSwitch: true }) as { code: string }).code,
    "kill_switch",
  );
  assert.equal(
    (decideAiBudget({ ...base, todayTokens: 10, dailyTokenCap: 10 }) as { code: string }).code,
    "budget_exceeded",
  );
  assert.equal(
    (decideAiBudget({ ...base, todaySpend: 5, dailySpendCap: 5 }) as { code: string }).code,
    "budget_exceeded",
  );
  assert.equal(estimateSpend(1000, 1000, null, 1), null);
  assert.equal(estimateSpend(2000, 1000, 0.5, 1), 2);
});

test("replies: JSON pulled out of prose and fences; garbage is raw; fit 0–100 only", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! {"a":2} hope that helps'), { a: 2 });
  assert.ok(isRawOnly(extractJson("no json here")));
  assert.equal(fitFields({ overall: 140 }).overall, null);
  assert.equal(fitFields({ overall: -1 }).overall, null);
  assert.equal(fitFields({ overall: 72.6 }).overall, 73);
  assert.deepEqual(fitFields({ scores: { a: 3, b: 9, c: "x" } }).scores, { a: 3 });
  assert.match(
    weightsGuidance({ skills: 40, experience: 30, education: 10, culture: 10, language: 10 }),
    /never admit protected/,
  );
});

test("errors are secret-free and typed; a non-AiError is a plain 502", () => {
  for (const code of [
    "kill_switch",
    "budget_exceeded",
    "timeout",
    "auth",
    "rate_limited",
    "upstream",
    "network",
    "egress",
  ] as const) {
    const m = aiErrorMessage(new AiError(code, "sk-secret-in-detail"));
    assert.doesNotMatch(m.message, /sk-secret/);
    assert.ok(m.status >= 400);
  }
  assert.equal(aiErrorMessage(new Error("x")).status, 502);
});

test("files are identified by their bytes", () => {
  assert.equal(detectFileKind(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "x.docx"), "pdf");
  assert.equal(detectFileKind(new Uint8Array([0x50, 0x4b, 3, 4]), "cv.docx"), "docx");
  assert.equal(detectFileKind(new Uint8Array([1, 2, 3]), "cv.pdf"), "unknown");
});

test("settings: the key is stored nested so the audit scrub redacts it; AI output is scrubbed", () => {
  assert.equal(sealedKeyOf({ apiKey: "encv1:abc" }), "encv1:abc");
  assert.equal(sealedKeyOf("encv1:abc"), null);
  for (const f of ["apiKey", "aiOutput", "aiAnalysis", "transcript", "aiRationale"])
    assert.ok(SCRUB_FIELDS.has(f), f);
  assert.deepEqual([...APPROVAL_ROLE_VALUES], APPROVAL_ROLES);
  assert.equal(
    scoringWeightsSchema.safeParse({
      skills: 50,
      experience: 30,
      education: 10,
      culture: 10,
      language: 10,
    }).success,
    false,
  );
  assert.equal(
    generalSettingsSchema.safeParse({ section: "panel", value: { mode: "open" } }).success,
    false,
  );
});

const read = (f: string) => readFileSync(f, "utf8");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("the engine: no SDK, egress checked before fetch, redirects never followed, metered", () => {
  const src = read("lib/hiring/ai/engine.ts");
  assert.doesNotMatch(src, /@anthropic-ai|from "openai"/);
  assert.ok(src.indexOf("assertEgressAllowed(") < src.indexOf("await fetch("));
  assert.match(src, /redirect: "manual"/);
  assert.match(src, /hiringAiUsage\.create/);
  assert.doesNotMatch(src, /console\.(log|error|warn)\(.*apiKey/);
});

test("authz: running needs manage on the record; judgments wait for the panel reveal; CV parse never scores", () => {
  const ins = read("lib/hiring/ai/insights.ts");
  assert.match(ins, /subjectFor\(actor, kind, entityId, "hiring\.manage"\)/);
  assert.match(ins, /judgmentVisible/);
  const parse = read("lib/hiring/ai/parse.ts");
  assert.doesNotMatch(parse, /overallScore|fitScores/);
  assert.doesNotMatch(read("lib/hiring/ai/skills.ts"), /minSalary|maxSalary|salaryExpectation/);
});

test("every hiring AI and settings route is rate-limited and behind withAuth", () => {
  const files = [...walk("app/api/hiring/ai"), ...walk("app/api/hiring/settings")].filter((f) =>
    f.endsWith("route.ts"),
  );
  assert.ok(files.length >= 8);
  for (const f of files) {
    const src = read(f);
    assert.match(src, /withRateLimit\(\s*withAuth\(/, f);
  }
});
