import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateInvite,
  generateInviteToken,
  hashInviteToken,
} from "../../lib/hiring/agency-invites";
import { isPublicApiPath, isPublicPath, routeDecision } from "../../i18n/route-decision";
import {
  agencyInviteCreateSchema,
  agencySubmitSchema,
  applySchema,
  inviteTokenSchema,
} from "../../lib/validations/hiring/public";

const base = {
  expiresAt: new Date(Date.now() + 86_400_000),
  revokedAt: null,
  maxSubmissions: 2,
  requisitionId: null,
  requisition: null,
};

test("invite gate: revoked, expired and unpostable are all 'invalid'; the cap is its own state", () => {
  assert.equal(evaluateInvite(null, 0), "invalid");
  assert.equal(evaluateInvite(base, 0), "valid");
  assert.equal(evaluateInvite({ ...base, revokedAt: new Date() }, 0), "invalid");
  assert.equal(evaluateInvite({ ...base, expiresAt: new Date(Date.now() - 1) }, 0), "invalid");
  assert.equal(
    evaluateInvite(
      { ...base, requisitionId: "r", requisition: { status: "CLOSED", jdApprovedAt: new Date() } },
      0,
    ),
    "invalid",
  );
  assert.equal(
    evaluateInvite(
      { ...base, requisitionId: "r", requisition: { status: "OPEN", jdApprovedAt: null } },
      0,
    ),
    "invalid",
  );
  assert.equal(
    evaluateInvite(
      { ...base, requisitionId: "r", requisition: { status: "OPEN", jdApprovedAt: new Date() } },
      0,
    ),
    "valid",
  );
  assert.equal(evaluateInvite(base, 2), "cap-reached");
});

test("tokens: 256-bit base64url, only the SHA-256 is stored, shape-checked before any lookup", () => {
  const t = generateInviteToken();
  assert.equal(t.length, 43);
  assert.ok(inviteTokenSchema.safeParse(t).success);
  assert.match(hashInviteToken(t), /^[0-9a-f]{64}$/);
  assert.notEqual(hashInviteToken(t), t);
  assert.equal(inviteTokenSchema.safeParse("short").success, false);
  assert.equal(inviteTokenSchema.safeParse(`${"a".repeat(43)}/x`).success, false);
});

test("D2: consent is enforced at the boundary for careers AND agency", () => {
  const app = { requisitionId: "r", name: "A", email: "a@x.com" };
  assert.equal(applySchema.safeParse(app).success, false);
  assert.equal(applySchema.safeParse({ ...app, consent: false }).success, false);
  assert.equal(applySchema.safeParse({ ...app, consent: true }).success, true);
  const sub = { candidateName: "B", candidateEmail: "b@x.com" };
  assert.equal(agencySubmitSchema.safeParse(sub).success, false);
  assert.equal(agencySubmitSchema.safeParse({ ...sub, consent: "on" }).success, true);
  assert.equal(
    agencySubmitSchema.safeParse({ ...sub, consent: "on", salaryExpectation: "-5" }).success,
    false,
  );
  assert.equal(
    agencyInviteCreateSchema.safeParse({ agencyName: "X", expiresInDays: 91 }).success,
    false,
  );
  assert.equal(
    agencyInviteCreateSchema.safeParse({ agencyName: "X", maxSubmissions: 201 }).success,
    false,
  );
});

test("routing: the public surfaces are exact, and nothing beside them opens up", () => {
  for (const p of ["/careers", "/en/careers", "/en/agency/abc"]) assert.ok(isPublicPath(p), p);
  assert.ok(isPublicApiPath("/api/careers"));
  assert.ok(isPublicApiPath("/api/careers/apply"));
  assert.equal(isPublicApiPath("/api/careers/other"), false);
  assert.deepEqual(routeDecision("/api/agency/abc/submit", false), { kind: "pass" });
  assert.deepEqual(routeDecision("/api/agency/abc/submit/x", false), { kind: "apiUnauthorized" });
  assert.deepEqual(routeDecision("/api/agency/abc", false), { kind: "apiUnauthorized" });
  assert.deepEqual(routeDecision("/api/hiring/agency-invites", false), { kind: "apiUnauthorized" });
  assert.deepEqual(routeDecision("/en/hiring/sourcing", false), {
    kind: "redirectLogin",
    locale: "en",
  });
  assert.deepEqual(
    routeDecision("/en/careers", true),
    { kind: "intl" },
    "a signed-in HR user may open the board",
  );
});

test("the board and the apply path never carry pay; writes are no-store and noindex", () => {
  const careers = readFileSync("lib/hiring/careers.ts", "utf8");
  const listSelect = careers.slice(
    careers.indexOf("export const listOpenRoles"),
    careers.indexOf("export async function advertisedRequisition"),
  );
  assert.doesNotMatch(listSelect, /salary|band/i);
  for (const f of ["app/api/careers/apply/route.ts", "app/api/agency/[token]/submit/route.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /withRateLimit\(/, `${f} is rate-limited`);
    assert.match(src, /no-store/, `${f} is no-store`);
    assert.match(src, /noindex/, `${f} is noindex`);
  }
  const page = readFileSync("app/[locale]/(careers)/agency/[token]/page.tsx", "utf8");
  assert.match(page, /index: false/);
  assert.match(page, /force-dynamic/);
});

test("agency submissions: name from the invite, cap rechecked under Serializable, PDF by its bytes", () => {
  const src =
    readFileSync("lib/hiring/agency-invites.ts", "utf8") +
    readFileSync("lib/hiring/agency-invite-admin.ts", "utf8");
  assert.match(src, /agencyName: invite\.agencyName/);
  assert.match(src, /isolationLevel: "Serializable"/);
  assert.match(src, /sniffType\(bytes\) !== "application\/pdf"/);
  assert.match(src, /tokenHash: hashInviteToken\(token\)/);
  assert.doesNotMatch(src, /tokenHash: token\b/);
});
