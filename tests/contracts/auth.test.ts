// Contract tests for lib/auth.ts — the Credentials `authorize` flow and the
// jwt/session callbacks (role propagation). These live inside the NextAuth({...})
// config object and aren't individually exported, so we mock `next-auth` (and the
// provider/adapter/prisma/password graph) to CAPTURE the config object lib/auth.ts
// passes to NextAuth, then invoke the real closures. No change to lib/auth.ts.
//
// Runs DB-free under node:test's module mocks (requires --experimental-test-
// module-mocks, which the `test` npm script already passes). Without the flag,
// every case self-skips rather than failing.
//
//   node --experimental-test-module-mocks --import tsx \
//     --test tests/contracts/auth.test.ts

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const mockApi = mock as unknown as {
  module?: (
    specifier: string,
    options: { namedExports?: Record<string, unknown>; defaultExport?: unknown },
  ) => unknown;
};
const canMock = typeof mockApi.module === "function";

// --- mutable stubs the captured closures read through ----------------------
let findUniqueArgs: unknown = null;
let findUniqueResult: Record<string, unknown> | null = null;
let accountFindFirstResult: Record<string, unknown> | null = null;
let updateCalls: unknown[] = [];
let auditedUpdateCalls: unknown[] = [];
let compareResult = false;
let rehashNeeded = false;

// The NextAuth config lib/auth.ts builds (captured by the mocked NextAuth).
let config: {
  providers: Array<{
    authorize: (
      c: Record<string, unknown> | undefined,
    ) => Promise<Record<string, unknown> | null>;
  }>;
  callbacks: {
    signIn: (a: { user?: Record<string, unknown>; account?: Record<string, unknown> }) => Promise<boolean>;
    jwt: (a: { token: Record<string, unknown>; user?: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
    session: (a: { session: { user?: Record<string, unknown> }; token: Record<string, unknown> }) => { user?: Record<string, unknown> };
  };
};

before(async () => {
  if (!canMock) return;

  // Capture the config object passed to NextAuth(); return a dummy shape.
  mockApi.module!("next-auth", {
    defaultExport: (cfg: typeof config) => {
      config = cfg;
      return { handlers: {}, signIn: () => {}, signOut: () => {}, auth: () => {} };
    },
  });
  // Credentials(cfg) just returns cfg so providers[0].authorize is reachable.
  mockApi.module!("next-auth/providers/credentials", {
    defaultExport: (cfg: unknown) => cfg,
  });
  // MicrosoftEntraID(cfg) → cfg (only invoked when SSO env is set; unset here).
  mockApi.module!("next-auth/providers/microsoft-entra-id", {
    defaultExport: (cfg: unknown) => cfg,
  });
  mockApi.module!("@auth/prisma-adapter", {
    namedExports: { PrismaAdapter: () => ({}) },
  });
  // lib/password is the verify/hash/rehash seam auth.ts now depends on (ADR-039).
  // verifyPassword's boolean and needsRehash's flag are controllable per-test.
  mockApi.module!(import.meta.resolve("../../lib/password.ts"), {
    namedExports: {
      verifyPassword: async () => compareResult,
      needsRehash: () => rehashNeeded,
      hashPassword: async () => "$argon2id$rehashed",
    },
  });
  // prismaUnfiltered stub: record findUnique args + update calls.
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      // Audited client: the login-time argon2 rehash writes through this one so
      // the passwordHash change is recorded (ADR-039 / senior-review fix).
      prisma: {
        user: {
          update: async (args: unknown) => {
            auditedUpdateCalls.push(args);
            return {};
          },
        },
      },
      prismaUnfiltered: {
        user: {
          findUnique: async (args: unknown) => {
            findUniqueArgs = args;
            return findUniqueResult;
          },
          update: async (args: unknown) => {
            updateCalls.push(args);
            return {};
          },
        },
        account: {
          // Drives the Polis "is this a returning linked user?" lookup in signIn.
          findFirst: async () => accountFindFirstResult,
        },
      },
    },
  });

  authMod = (await import(import.meta.resolve("../../lib/auth.ts"))) as typeof authMod;
});

// Named exports under test for SSO gating (ADR-024). Pure helpers, env-driven.
let authMod: {
  ssoProviderPlan: (env?: Record<string, string | undefined>) => {
    configured: boolean;
    enforced: boolean;
    credentialsEnabled: boolean;
    ssoEnabled: boolean;
    entraEnabled: boolean;
    polisEnabled: boolean;
  };
  mapSsoRole: (claims: Record<string, unknown> | undefined) => string;
};

beforeEach(() => {
  findUniqueArgs = null;
  findUniqueResult = null;
  accountFindFirstResult = null;
  updateCalls = [];
  auditedUpdateCalls = [];
  compareResult = false;
  rehashNeeded = false;
});

const VALID_USER = {
  id: "u1",
  email: "user@example.com",
  name: "User",
  image: null,
  role: "ADMIN",
  passwordHash: "hashed",
  passwordChangedAt: null,
};

// --- authorize -------------------------------------------------------------

test("authorize: returns null when credentials are missing", { skip: !canMock }, async () => {
  const { authorize } = config.providers[0];
  assert.equal(await authorize(undefined), null);
  assert.equal(await authorize({ email: "a@b.com" }), null); // no password
  assert.equal(await authorize({ password: "x" }), null); // no email
});

test("authorize: returns null when the user does not exist", { skip: !canMock }, async () => {
  findUniqueResult = null;
  const out = await config.providers[0].authorize({
    email: "nobody@example.com",
    password: "whatever",
  });
  assert.equal(out, null);
});

test("authorize: returns null when the user has no passwordHash (e.g. OAuth-only)", { skip: !canMock }, async () => {
  findUniqueResult = { ...VALID_USER, passwordHash: null };
  const out = await config.providers[0].authorize({
    email: "user@example.com",
    password: "whatever",
  });
  assert.equal(out, null);
});

test("authorize: returns null when the password is wrong", { skip: !canMock }, async () => {
  findUniqueResult = { ...VALID_USER };
  compareResult = false;
  const out = await config.providers[0].authorize({
    email: "user@example.com",
    password: "wrong",
  });
  assert.equal(out, null);
  assert.equal(updateCalls.length, 0, "must not stamp lastLoginAt on a failed login");
});

test("authorize: valid login returns the user (with role) and stamps lastLoginAt", { skip: !canMock }, async () => {
  findUniqueResult = { ...VALID_USER };
  compareResult = true;
  const out = await config.providers[0].authorize({
    email: "user@example.com",
    password: "correct",
  });
  assert.deepEqual(out, {
    id: "u1",
    email: "user@example.com",
    name: "User",
    image: null,
    role: "ADMIN",
    passwordChangedAt: null,
  });
  // (assert.deepEqual above narrows `out` to the literal shape, so widen back to
  // index a key it intentionally must NOT carry.)
  assert.equal((out as Record<string, unknown>).passwordHash, undefined, "must NOT leak passwordHash to the session");
  assert.equal(updateCalls.length, 1, "should stamp lastLoginAt exactly once");
  const data = (updateCalls[0] as { data: { lastLoginAt: unknown; passwordHash?: string } }).data;
  assert.ok(data.lastLoginAt instanceof Date, "lastLoginAt should be a Date");
  assert.equal(data.passwordHash, undefined, "lastLoginAt write must not carry passwordHash");
  assert.equal(auditedUpdateCalls.length, 0, "no rehash write when the hash is already current");
});

test("authorize: silently rehashes a legacy hash to Argon2id on successful login (ADR-039)", { skip: !canMock }, async () => {
  findUniqueResult = { ...VALID_USER, passwordHash: "$2b$12$legacybcrypthash" };
  compareResult = true;
  rehashNeeded = true;
  const out = await config.providers[0].authorize({
    email: "user@example.com",
    password: "correct",
  });
  assert.ok(out, "login should still succeed");
  assert.equal(updateCalls.length, 1, "lastLoginAt still written on the unaudited client");
  // The rehash goes through the AUDITED client (separate write) so the passwordHash
  // change is recorded (scrubbed) — senior-review fix.
  assert.equal(auditedUpdateCalls.length, 1, "rehash writes via the audited prisma client");
  const data = (auditedUpdateCalls[0] as { data: { passwordHash?: string; lastLoginAt?: unknown } }).data;
  assert.equal(data.passwordHash, "$argon2id$rehashed", "legacy hash upgraded to Argon2id on login");
  assert.equal(data.lastLoginAt, undefined, "the rehash write is passwordHash-only");
  // A silent rehash is NOT a password change — it must not stamp passwordChangedAt
  // (that would revoke the user's other live sessions).
  assert.equal(
    (data as Record<string, unknown>).passwordChangedAt,
    undefined,
    "rehash must not bump passwordChangedAt"
  );
});

test("authorize: looks the user up by normalized (lowercased, trimmed) email + deletedAt:null", { skip: !canMock }, async () => {
  findUniqueResult = { ...VALID_USER };
  compareResult = true;
  await config.providers[0].authorize({
    email: "  USER@Example.COM  ",
    password: "correct",
  });
  const where = (findUniqueArgs as { where: { email: string; deletedAt: null } }).where;
  assert.equal(where.email, "user@example.com", "email must be lowercased + trimmed");
  assert.equal(where.deletedAt, null, "must exclude soft-deleted users from login");
});

// --- jwt callback ----------------------------------------------------------

test("jwt: copies id + role + password epoch from the user on sign-in", { skip: !canMock }, async () => {
  const token = await config.callbacks.jwt({
    token: {},
    user: { id: "u9", role: "EDITOR", passwordChangedAt: new Date(1000) },
  });
  assert.ok(token);
  assert.equal(token.id, "u9");
  assert.equal(token.role, "EDITOR");
  assert.equal(token.passwordChangedAt, 1000, "binds the token to the password epoch");
});

test("jwt: defaults password epoch to 0 when the user never changed it", { skip: !canMock }, async () => {
  const token = await config.callbacks.jwt({
    token: {},
    user: { id: "u9", role: "VIEWER", passwordChangedAt: null },
  });
  assert.equal(token?.passwordChangedAt, 0);
});

test("jwt: keeps the token on subsequent calls when the password is unchanged", { skip: !canMock }, async () => {
  // DB reports the same epoch the token carries -> token survives.
  findUniqueResult = { passwordChangedAt: new Date(500) };
  const token = await config.callbacks.jwt({
    token: { id: "u9", role: "ADMIN", passwordChangedAt: 500 },
    user: undefined,
  });
  assert.ok(token, "token should not be revoked");
  assert.equal(token.id, "u9");
  assert.equal(token.role, "ADMIN");
  const where = (findUniqueArgs as { where: { id: string } }).where;
  assert.equal(where.id, "u9", "revocation check looks the user up by token.id");
});

test("jwt: REVOKES the token when the password changed after it was issued", { skip: !canMock }, async () => {
  // Password reset stamped a newer epoch than the token's -> reject (return null).
  findUniqueResult = { passwordChangedAt: new Date(9999) };
  const token = await config.callbacks.jwt({
    token: { id: "u9", role: "ADMIN", passwordChangedAt: 500 },
    user: undefined,
  });
  assert.equal(token, null, "a stale pre-reset session must be torn down");
});

test("jwt: REVOKES the token when the user no longer exists", { skip: !canMock }, async () => {
  findUniqueResult = null;
  const token = await config.callbacks.jwt({
    token: { id: "gone", role: "ADMIN", passwordChangedAt: 0 },
    user: undefined,
  });
  assert.equal(token, null);
});

// --- session callback ------------------------------------------------------

test("session: projects id + role from the token onto session.user", { skip: !canMock }, () => {
  const session = config.callbacks.session({
    session: { user: { email: "user@example.com" } },
    token: { id: "u1", role: "VIEWER" },
  });
  assert.equal(session.user?.id, "u1");
  assert.equal(session.user?.role, "VIEWER");
});

test("session: tolerates a session with no user (no throw)", { skip: !canMock }, () => {
  const session = config.callbacks.session({
    session: {},
    token: { id: "u1", role: "VIEWER" },
  });
  assert.ok(session, "should return the session object even when user is absent");
});

// --- SSO provider gating (ADR-024) -----------------------------------------

test("ssoProviderPlan: no SSO env -> credentials only, SSO dormant", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({});
  assert.equal(plan.configured, false);
  assert.equal(plan.ssoEnabled, false);
  assert.equal(plan.credentialsEnabled, true, "password login stays on by default");
});

const FULL_SSO_ENV = {
  AUTH_MICROSOFT_ENTRA_ID_ID: "client-123",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "shh",
  AUTH_MICROSOFT_ENTRA_ID_ISSUER: "https://login.microsoftonline.com/tenant/v2.0",
};

test("ssoProviderPlan: id+secret+issuer, not enforced -> BOTH providers", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({ ...FULL_SSO_ENV });
  assert.equal(plan.configured, true);
  assert.equal(plan.ssoEnabled, true, "Entra registered once id+secret+issuer are set");
  assert.equal(plan.credentialsEnabled, true, "password login remains alongside SSO");
});

test("ssoProviderPlan: id without secret -> NOT configured (no broken button)", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({ AUTH_MICROSOFT_ENTRA_ID_ID: "client-123" });
  assert.equal(plan.configured, false, "a half-set config must not enable SSO");
  assert.equal(plan.ssoEnabled, false);
});

test("ssoProviderPlan: id+secret WITHOUT issuer -> NOT configured (no silent multi-tenant)", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({
    AUTH_MICROSOFT_ENTRA_ID_ID: "client-123",
    AUTH_MICROSOFT_ENTRA_ID_SECRET: "shh",
  });
  assert.equal(plan.configured, false, "missing issuer must keep SSO dormant (avoid any-tenant default)");
  assert.equal(plan.ssoEnabled, false);
});

test("ssoProviderPlan: configured AND enforced -> SSO ONLY (closes T-02)", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({ ...FULL_SSO_ENV, AUTH_ENFORCE_SSO: "true" });
  assert.equal(plan.ssoEnabled, true);
  assert.equal(plan.credentialsEnabled, false, "credentials removed so IdP MFA is mandatory");
});

// --- signIn callback: soft-deleted SSO users blocked (HIGH fix) -------------

test("signIn: denies an OAuth sign-in when the user row is soft-deleted", { skip: !canMock }, async () => {
  findUniqueResult = { deletedAt: new Date() };
  const ok = await config.callbacks.signIn({ user: { id: "u1" }, account: { type: "oauth" } });
  assert.equal(ok, false, "off-boarded SSO user must not be able to re-authenticate");
});

test("signIn: denies an OIDC sign-in when the user row is soft-deleted (Entra/Polis are 'oidc')", { skip: !canMock }, async () => {
  findUniqueResult = { deletedAt: new Date() };
  const ok = await config.callbacks.signIn({ user: { id: "u1" }, account: { type: "oidc" } });
  assert.equal(ok, false, "an off-boarded OIDC (Polis SCIM soft-delete) user must not re-authenticate");
});

test("signIn: allows an OAuth sign-in for a live user", { skip: !canMock }, async () => {
  findUniqueResult = { deletedAt: null };
  const ok = await config.callbacks.signIn({ user: { id: "u1" }, account: { type: "oauth" } });
  assert.equal(ok, true);
});

test("signIn: allows credentials sign-in without an extra deletedAt lookup", { skip: !canMock }, async () => {
  findUniqueArgs = null;
  const ok = await config.callbacks.signIn({ user: { id: "u1" }, account: { type: "credentials" } });
  assert.equal(ok, true);
  assert.equal(findUniqueArgs, null, "credentials path already filters deletedAt in authorize");
});

// --- signIn callback: Polis account-linking takeover guard (ADR-045 A1) ------
// allowDangerousEmailAccountLinking is ON for Polis so a SCIM-provisioned
// PASSWORDLESS row is claimable on first login; a colliding PASSWORD user must
// still hard-block (no takeover via a spoofable SSO email claim).

test("signIn: BLOCKS a FIRST Polis link to a row that already has a passwordHash (takeover guard)", { skip: !canMock }, async () => {
  findUniqueResult = { deletedAt: null, passwordHash: "$argon2id$real-password-user" };
  accountFindFirstResult = null; // no polis Account yet => this is the dangerous first-link moment
  const ok = await config.callbacks.signIn({
    user: { id: "u1" },
    account: { type: "oidc", provider: "polis" },
  });
  assert.equal(ok, false, "a real password user must not be taken over by a Polis email link");
});

test("signIn: ALLOWS a first Polis link to a passwordless (SCIM-provisioned) row", { skip: !canMock }, async () => {
  findUniqueResult = { deletedAt: null, passwordHash: null };
  accountFindFirstResult = null;
  const ok = await config.callbacks.signIn({
    user: { id: "u1" },
    account: { type: "oidc", provider: "polis" },
  });
  assert.equal(ok, true, "a SCIM passwordless row is claimable — the US-1/US-2 flagship flow");
});

test("signIn: ALLOWS a RETURNING linked Polis user even after a passwordHash is set (no SSO lockout)", { skip: !canMock }, async () => {
  findUniqueResult = { deletedAt: null, passwordHash: "$argon2id$set-later-via-forgot-password" };
  accountFindFirstResult = { id: "acct-1" }; // a polis Account already exists => returning login
  const ok = await config.callbacks.signIn({
    user: { id: "u1" },
    account: { type: "oidc", provider: "polis" },
  });
  assert.equal(ok, true, "a linked SSO user must not be locked out when a password is later set (senior-review High)");
});

test("signIn: the takeover guard is scoped to Polis (Entra passwordHash row is not blocked here)", { skip: !canMock }, async () => {
  findUniqueResult = { deletedAt: null, passwordHash: "$argon2id$x" };
  const ok = await config.callbacks.signIn({
    user: { id: "u1" },
    account: { type: "oidc", provider: "microsoft-entra-id" },
  });
  assert.equal(ok, true, "Entra keeps allowDangerousEmailAccountLinking OFF — its collisions block upstream, not here");
});

test("signIn: selects passwordHash alongside deletedAt for the guard", { skip: !canMock }, async () => {
  findUniqueResult = { deletedAt: null, passwordHash: null };
  await config.callbacks.signIn({ user: { id: "u1" }, account: { type: "oidc", provider: "polis" } });
  const sel = (findUniqueArgs as { select?: Record<string, boolean> } | null)?.select;
  assert.equal(sel?.deletedAt, true);
  assert.equal(sel?.passwordHash, true, "the guard needs passwordHash in the projection");
});

test("ssoProviderPlan: enforce flag alone (no Entra) does NOT lock out password login", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({ AUTH_ENFORCE_SSO: "true" });
  assert.equal(plan.configured, false);
  assert.equal(plan.ssoEnabled, false);
  assert.equal(plan.credentialsEnabled, true, "never strand a fork with no usable provider");
});

// --- SSO provider gating: Ory Polis (ADR-045) ------------------------------

const FULL_POLIS_ENV = {
  POLIS_ISSUER: "http://polis:5225",
  POLIS_CLIENT_ID: "polis-client",
  POLIS_CLIENT_SECRET: "polis-shh",
};

test("ssoProviderPlan: Polis issuer+id+secret -> configured via Polis (Entra absent)", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({ ...FULL_POLIS_ENV });
  assert.equal(plan.configured, true, "any SSO provider being configured => configured");
  assert.equal(plan.ssoEnabled, true);
  assert.equal(plan.polisEnabled, true, "Polis registers once issuer+id+secret are set");
  assert.equal(plan.entraEnabled, false, "Entra stays dormant with no Entra env");
  assert.equal(plan.credentialsEnabled, true, "password login remains alongside SSO");
});

test("ssoProviderPlan: Polis issuer without secret -> NOT configured (no broken button)", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({ POLIS_ISSUER: "http://polis:5225", POLIS_CLIENT_ID: "polis-client" });
  assert.equal(plan.polisEnabled, false, "a half-set Polis config must not register");
  assert.equal(plan.configured, false);
});

test("ssoProviderPlan: Polis configured AND enforced -> SSO ONLY (credentials removed)", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({ ...FULL_POLIS_ENV, AUTH_ENFORCE_SSO: "true" });
  assert.equal(plan.polisEnabled, true);
  assert.equal(plan.credentialsEnabled, false, "enforcement applies to whichever provider is configured");
});

test("ssoProviderPlan: Entra AND Polis both configured -> both enabled", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({ ...FULL_SSO_ENV, ...FULL_POLIS_ENV });
  assert.equal(plan.entraEnabled, true);
  assert.equal(plan.polisEnabled, true);
  assert.equal(plan.configured, true);
});

test("mapSsoRole: defaults to VIEWER (least privilege) for any claims", { skip: !canMock }, () => {
  assert.equal(authMod.mapSsoRole(undefined), "VIEWER");
  assert.equal(authMod.mapSsoRole({ groups: ["app-admins"] }), "VIEWER");
});

test("default build (no SSO env at import) registers exactly the credentials provider", { skip: !canMock }, () => {
  assert.equal(config.providers.length, 1, "SSO must stay dormant unless env opts in");
});
