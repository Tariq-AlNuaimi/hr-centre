import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateTemporaryPassword, loginStateOf } from "../../lib/people/logins";
import { forcedChangeDecision } from "../../lib/people/force-change";
import { changePasswordSchema, issueLoginSchema } from "../../lib/validations/login";

/** HR Centre foundation F-d — logins until SSO (blueprint §4, AC-F4.1–AC-F4.3). */

test("temporary passwords are long, unambiguous and never repeat", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const p = generateTemporaryPassword();
    assert.match(p, /^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/);
    assert.doesNotMatch(p, /[0O1lI]/, "no look-alike characters");
    seen.add(p);
  }
  assert.equal(seen.size, 200);
});

test("login state reads the account, not just the link", () => {
  assert.equal(loginStateOf(null), "NONE");
  const base = { deletedAt: null, passwordHash: null, mustChangePassword: false };
  assert.equal(loginStateOf(base), "NO_PASSWORD");
  assert.equal(loginStateOf({ ...base, passwordHash: "h", mustChangePassword: true }), "TEMPORARY");
  assert.equal(loginStateOf({ ...base, passwordHash: "h" }), "ACTIVE");
  assert.equal(loginStateOf({ ...base, passwordHash: "h", deletedAt: new Date() }), "REVOKED");
});

test("AC-F4.2: with a temporary password, every page leads to change-password", () => {
  assert.deepEqual(forcedChangeDecision("/en/people", false, "en"), { kind: "pass" });
  assert.deepEqual(forcedChangeDecision("/en/people", true, "en"), {
    kind: "redirect",
    to: "/en/change-password",
  });
  assert.deepEqual(forcedChangeDecision("/en", true, "en"), {
    kind: "redirect",
    to: "/en/change-password",
  });
  assert.deepEqual(forcedChangeDecision("/en/change-password", true, "en"), { kind: "pass" });
  assert.deepEqual(forcedChangeDecision("/api/employees", true, "en"), { kind: "apiForbidden" });
  assert.deepEqual(forcedChangeDecision("/api/logins/change-password", true, "en"), {
    kind: "pass",
  });
  assert.deepEqual(forcedChangeDecision("/api/auth/session", true, "en"), { kind: "pass" });
  assert.deepEqual(forcedChangeDecision("/api/logins/abc", true, "en"), { kind: "apiForbidden" });
  assert.deepEqual(forcedChangeDecision("/_next/static/x.js", true, "en"), { kind: "pass" });
});

test("the gate is wired: middleware applies it and the session carries the flag", () => {
  assert.match(readFileSync("middleware.ts", "utf8"), /forcedChangeDecision\(/);
  const auth = readFileSync("lib/auth.ts", "utf8");
  assert.match(
    auth,
    /token\.mustChangePassword = current\.mustChangePassword/,
    "re-read per request",
  );
  assert.match(auth, /session\.user\.mustChangePassword/);
});

test("AC-F4.1: the temporary password response is never cached", () => {
  assert.match(readFileSync("app/api/logins/[employeeId]/route.ts", "utf8"), /no-store/);
});

test("password change rules", () => {
  assert.equal(
    changePasswordSchema.safeParse({ currentPassword: "x", newPassword: "short" }).success,
    false,
  );
  assert.equal(
    changePasswordSchema.safeParse({ currentPassword: "abcdefghijk", newPassword: "abcdefghijk" })
      .success,
    false,
    "must differ from the temporary one",
  );
  assert.equal(
    changePasswordSchema.safeParse({ currentPassword: "temp", newPassword: "a-much-better-one" })
      .success,
    true,
  );
  assert.equal(issueLoginSchema.safeParse({ action: "delete" }).success, false);
});
