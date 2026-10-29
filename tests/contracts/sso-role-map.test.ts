import { test } from "node:test";
import assert from "node:assert/strict";
import { mapSsoRole } from "../../lib/sso/role-map";

/**
 * ADR-069's SSO seam. The property under test is the DEFAULT: an IdP that says
 * nothing useful must grant nothing. Every other case is a promotion that has to
 * be earned by explicit group membership.
 */

const withGroups = (admin?: string, editor?: string) => {
  process.env.SSO_ADMIN_GROUPS = admin ?? "";
  process.env.SSO_EDITOR_GROUPS = editor ?? "";
};

test("no claims at all lands on VIEWER", () => {
  withGroups("app-admins", "app-editors");
  assert.equal(mapSsoRole(undefined), "VIEWER");
  assert.equal(mapSsoRole({}), "VIEWER");
});

test("a misconfigured IdP grants nothing, however it is misconfigured", () => {
  withGroups("app-admins", "app-editors");
  // Groups claim missing, empty, wrong type, or full of names nobody listed.
  assert.equal(mapSsoRole({ groups: [] }), "VIEWER");
  assert.equal(mapSsoRole({ groups: null }), "VIEWER");
  assert.equal(mapSsoRole({ groups: 42 }), "VIEWER");
  assert.equal(mapSsoRole({ groups: ["some-unrelated-group"] }), "VIEWER");
  assert.equal(mapSsoRole({ unexpectedClaim: ["app-admins"] }), "VIEWER");
});

test("an unconfigured allowlist cannot promote anyone", () => {
  // The env vars are the allowlist. Empty allowlist + a user claiming to be in
  // "app-admins" must still be a VIEWER — otherwise a fork that forgot to set
  // the vars would hand ADMIN to anyone whose IdP emits that group name.
  withGroups("", "");
  assert.equal(mapSsoRole({ groups: ["app-admins", "app-editors"] }), "VIEWER");
});

test("explicit ADMIN membership promotes; everything else does not", () => {
  withGroups("app-admins", "app-editors");
  assert.equal(mapSsoRole({ groups: ["app-admins"] }), "ADMIN");
  assert.equal(mapSsoRole({ groups: ["app-editors", "app-admins"] }), "ADMIN");
});

test("ADR-070 — SSO_EDITOR_GROUPS cannot promote anyone", () => {
  // The seam used to return EDITOR for this. ADR-070 established that EDITOR
  // gates nothing (`withEditorAuth` is never called) and narrowed the API so it
  // cannot be granted there; JIT provisioning bypasses `createUserSchema`
  // entirely, so it was the last way to mint one.
  //
  // This asserts a REFUSAL rather than deleting the old case, because the
  // difference that matters is behavioural, not textual: a future edit that
  // restores the branch — or a fork that copies the template recipe's
  // three-value version back over this file — fails here instead of quietly
  // reintroducing a stored value that looks like a privilege and is not.
  withGroups("app-admins", "app-editors");
  assert.equal(mapSsoRole({ groups: ["app-editors"] }), "VIEWER");
  // And the variable is genuinely unread: set it to match EVERY group the user
  // claims, and the answer is still VIEWER.
  withGroups("", "app-editors,app-admins");
  assert.equal(mapSsoRole({ groups: ["app-editors", "app-admins"] }), "VIEWER");
});

test("the three claim shapes IdPs actually emit are all read", () => {
  withGroups("app-admins");
  assert.equal(mapSsoRole({ groups: ["app-admins"] }), "ADMIN", "Okta / generic OIDC");
  assert.equal(mapSsoRole({ roles: ["app-admins"] }), "ADMIN", "Entra app roles");
  assert.equal(
    mapSsoRole({
      "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups": ["app-admins"],
    }),
    "ADMIN",
    "Entra SAML-style claim URI",
  );
  // A single group emitted as a bare string, which some tenants do. Treating it
  // as "no groups" would silently demote a real administrator.
  assert.equal(mapSsoRole({ groups: "app-admins" }), "ADMIN", "bare string");
});

test("SSO cannot grant §4.1 HR authority — only the platform role", () => {
  // The seam returns the PLATFORM Role enum and nothing else. HR authority lives
  // on role assignments and is granted at /admin/roles by a human; a directory
  // group edited by IT must never be able to mint an HR Super Admin.
  withGroups("app-admins", "app-editors");
  for (const claims of [{ groups: ["app-admins"] }, { groups: ["app-editors"] }, {}]) {
    // Two values, not three, since ADR-070 — and never a `pmsRoles` value.
    assert.ok(
      ["ADMIN", "VIEWER"].includes(mapSsoRole(claims)),
      "the seam may only ever return a platform Role",
    );
  }
});
