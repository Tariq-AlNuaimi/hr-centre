import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { computeChain, totalMonthlyComp } from "../../lib/hiring/approval-chain";
import {
  bandVerdict,
  buildCompBreakdown,
  diffOfferTerms,
  nextVersionNumber,
  restartsApproval,
  summarizeVersion,
  withSupersession,
} from "../../lib/hiring/offer-package";
import {
  nextOfferStep,
  offerDecisionRefusal,
  offerTransitionError,
  offerTransitions,
  sameMuscatDay,
} from "../../lib/hiring/offer-rules";
import { DEFAULT_OFFER_TEMPLATE, renderTemplate } from "../../lib/hiring/offer-letter";
import {
  acceptanceSchema,
  createOfferSchema,
  offerDecisionSchema,
  reviseOfferSchema,
} from "../../lib/validations/hiring/offer";

test("status machine: approval and acceptance have their own paths; terminals are final", () => {
  assert.deepEqual([...offerTransitions("DRAFTING")], ["PENDING_APPROVAL", "WITHDRAWN"]);
  assert.match(offerTransitionError("PENDING_APPROVAL", "APPROVED")!, /approval chain/);
  assert.match(offerTransitionError("SENT", "ACCEPTED")!, /acceptance/);
  assert.match(offerTransitionError("SENT", "PENDING_APPROVAL")!, /revised offer/);
  assert.equal(offerTransitionError("APPROVED", "SENT"), null);
  assert.ok(offerTransitionError("ACCEPTED", "WITHDRAWN"));
});

test("chain: floor HR Manager → Operations Director; COO on TOTAL monthly ≥ threshold", () => {
  const roles = (total: number) => computeChain("RIHAL", total).map((s) => s.role);
  assert.deepEqual(roles(2000), ["HR_MANAGER", "OPERATIONS_DIRECTOR"]);
  assert.equal(totalMonthlyComp(2000, { housing: 500 }), 2500);
  assert.deepEqual(roles(totalMonthlyComp(2000, { housing: 500 })!), [
    "HR_MANAGER",
    "OPERATIONS_DIRECTOR",
    "COO",
  ]);
  const override = computeChain("CL", 100, { overrides: { CL: ["DEPARTMENT_HEAD"] } }).map(
    (s) => s.role,
  );
  assert.deepEqual(
    override,
    ["DEPARTMENT_HEAD", "HR_MANAGER", "OPERATIONS_DIRECTOR"],
    "an override only adds",
  );
});

test("decisions: SoD, referrer, D17 (no two steps by one person), qualification", () => {
  const base = {
    actorId: "a",
    submitterId: "s",
    referrerId: null,
    qualified: true,
    priorApproverIds: [] as string[],
  };
  assert.equal(offerDecisionRefusal(base), null);
  assert.match(offerDecisionRefusal({ ...base, submitterId: "a" })!, /segregation/);
  assert.match(offerDecisionRefusal({ ...base, referrerId: "a" })!, /referred/);
  assert.match(offerDecisionRefusal({ ...base, priorApproverIds: ["a"] })!, /earlier step/);
  assert.match(offerDecisionRefusal({ ...base, qualified: false })!, /role/);
  assert.ok(offerDecisionRefusal({ ...base, submitterId: null }));
  const chain = [
    { sequence: 1, role: "HR_MANAGER" },
    { sequence: 2, role: "OPERATIONS_DIRECTOR" },
  ];
  assert.equal(
    nextOfferStep(chain, [{ sequence: 1, approverId: "x", action: "APPROVED" }])?.sequence,
    2,
  );
  assert.equal(
    nextOfferStep(chain, [{ sequence: 1, approverId: "x", action: "SENT_BACK" }])?.sequence,
    1,
  );
});

test("package: breakdown, total, band verdict on BASIC, never 'within' unverified", () => {
  const b = buildCompBreakdown(2000, { transport: 100, housing: 500, zero: 0 });
  assert.deepEqual(
    b.rows.map((r) => r.key),
    ["basic", "housing", "transport"],
  );
  assert.equal(b.totalMonthly, 2600);
  assert.equal(bandVerdict(2000, 1500, 2200), "WITHIN");
  assert.equal(bandVerdict(2300, 1500, 2200), "ABOVE");
  assert.equal(bandVerdict(2000, null, null), "NO_BAND");
  assert.equal(bandVerdict(null, 1, 2), "NO_SALARY");
});

test("revisions: PATCH diff, pay restarts approval, logistics do not; versions number and supersede", () => {
  const prev = {
    salary: 2000,
    allowances: { housing: 500 },
    startDate: "2026-12-01T00:00:00.000Z",
    probationMonths: 3,
  };
  assert.deepEqual(diffOfferTerms(prev, { startDate: "2026-12-15T00:00:00.000Z" }), ["startDate"]);
  assert.deepEqual(
    diffOfferTerms(prev, { allowances: { housing: 500, zero: 0 } }),
    [],
    "zero allowances are not a change",
  );
  assert.equal(restartsApproval(["startDate"]), false);
  assert.equal(restartsApproval(["startDate", "allowances"]), true);
  assert.equal(summarizeVersion(1, []), "Extended — original offer");
  assert.equal(summarizeVersion(3, ["salary", "startDate"]), "Basic salary and Start date revised");
  assert.equal(nextVersionNumber([{ versionNumber: 1 }, { versionNumber: 3 }]), 4);
  assert.deepEqual(
    withSupersession([{ versionNumber: 2 }, { versionNumber: 1 }]).map((v) => [
      v.versionNumber,
      v.current,
    ]),
    [
      [1, false],
      [2, true],
    ],
  );
});

test("acceptance: the joining date is the offered start date in Muscat", () => {
  assert.equal(
    sameMuscatDay(new Date("2026-12-01T00:00:00+04:00"), new Date("2026-11-30T20:00:00Z")),
    true,
  );
  assert.equal(
    sameMuscatDay(new Date("2026-12-02T00:00:00+04:00"), new Date("2026-11-30T20:00:00Z")),
    false,
  );
});

test("D11: the letter says monthly; unknown tokens stay visible", () => {
  assert.doesNotMatch(DEFAULT_OFFER_TEMPLATE, /annual/i);
  assert.match(DEFAULT_OFFER_TEMPLATE, /monthly/i);
  const out = renderTemplate("Hi [candidate], [salary] [unknown]", {
    candidate: "Aisha",
    salary: "OMR 2,000",
    startDate: "",
    position: "",
    grade: "",
    company: "",
  });
  assert.equal(out, "Hi Aisha, OMR 2,000 [unknown]");
});

test("boundary: offers need a start date; revision changes something; reasons and pay bounds", () => {
  assert.equal(createOfferSchema.safeParse({ candidateId: "c" }).success, false);
  assert.equal(
    createOfferSchema.safeParse({ candidateId: "c", startDate: "2026-12-01", salary: -1 }).success,
    false,
  );
  assert.equal(reviseOfferSchema.safeParse({ candidateNote: "hi" }).success, false);
  assert.equal(reviseOfferSchema.safeParse({ startDate: "2026-12-15" }).success, true);
  assert.equal(offerDecisionSchema.safeParse({ action: "APPROVE" }).success, false);
  assert.equal(acceptanceSchema.safeParse({}).success, false);
});

function routes(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) routes(p, out);
    else if (e === "route.ts") out.push(p);
  }
  return out;
}

test("route floor: every slice-5 handler is rate-limited, authenticated and scope-resolved", () => {
  const files = [
    ...routes("app/api/hiring/offers"),
    "app/api/hiring/close-out/route.ts",
    "app/api/hiring/candidates/[id]/negotiations/route.ts",
    "app/api/hiring/settings/offer-letter/route.ts",
  ];
  assert.ok(files.length >= 12);
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

test("pay seam: offerJson fails closed; the letter and signed letter need comp; export has no pay column", () => {
  const offers = readFileSync("lib/hiring/offers.ts", "utf8");
  assert.match(offers, /pay reached a reader without comp access/);
  for (const f of [
    "app/api/hiring/offers/[id]/letter/route.ts",
    "app/api/hiring/offers/[id]/signed/route.ts",
  ]) {
    assert.match(readFileSync(f, "utf8"), /!l\.comp/, `${f} must check comp`);
  }
  const exp = readFileSync("app/api/hiring/offers/export/route.ts", "utf8");
  assert.doesNotMatch(exp, /salary|allowance/i);
});

test("D4: acceptance moves the candidate to OFFER_ACCEPTED, never straight to pre-onboarding", () => {
  const src = readFileSync("lib/hiring/offer-acceptance.ts", "utf8");
  assert.match(src, /toStage: "OFFER_ACCEPTED"/);
  assert.doesNotMatch(src, /PRE_ONBOARDING/);
});
